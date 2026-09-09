//! Exportación a MP4 con el sidecar `ffmpeg`: recorta cada clip, los
//! concatena, mezcla la pista de audio y codifica (por hardware si se puede).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Proceso ffmpeg en curso (para poder cancelarlo) y carpeta temporal de las capas de texto.
#[derive(Default)]
pub struct ExportState {
    child: Mutex<Option<CommandChild>>,
    cancelled: AtomicBool,
    overlay_dir: Mutex<Option<PathBuf>>,
}

/// Secuencia PNG con alfa (textos animados) que se superpone al vídeo desde `start`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOverlay {
    /// Patrón de archivos tipo `/tmp/.../0/%05d.png`.
    pub pattern: String,
    pub fps: f64,
    pub start: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    pub path: String,
    #[serde(rename = "in")]
    pub in_sec: f64,
    pub out: f64,
    /// Posición en el timeline (s). Solo importa en la pista de audio.
    pub start: f64,
    pub has_audio: bool,
    /// Transición hacia el clip siguiente (pista principal).
    #[serde(default)]
    pub transition: Option<ExportTransition>,
    /// Filtros de color de ffmpeg ya montados por el frontend (validados abajo).
    #[serde(default)]
    pub filters: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTransition {
    /// Nombre del filtro `xfade` (validado contra una lista cerrada).
    pub xfade: String,
    pub duration: f64,
}

const XFADE_NAMES: &[&str] = &[
    "fade", "dissolve", "fadeblack", "fadewhite", "slideleft", "slideright", "slideup", "slidedown",
    "smoothleft", "smoothright", "wipeleft", "wiperight", "wipeup", "wipedown", "zoomin", "hblur",
    "circleopen", "circleclose", "pixelize", "squeezeh", "squeezev", "radial", "distance",
];

impl ExportClip {
    pub(crate) fn duration(&self) -> f64 {
        (self.out - self.in_sec).max(0.0)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    pub output: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Clips de la pista principal, en orden y sin huecos.
    pub video: Vec<ExportClip>,
    /// Clips de la pista de audio, con su posición en `start`.
    pub audio: Vec<ExportClip>,
    /// "auto" (hardware si lo hay) o "x264".
    pub encoder: String,
    #[serde(default)]
    pub overlays: Vec<ExportOverlay>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub percent: f64,
    pub out_time: f64,
    pub speed: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output: String,
    pub encoder: String,
    pub seconds: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Encoder {
    VideoToolbox,
    X264,
}

impl Encoder {
    fn name(self) -> &'static str {
        match self {
            Encoder::VideoToolbox => "h264_videotoolbox",
            Encoder::X264 => "libx264",
        }
    }
}

enum RunError {
    Cancelled,
    Failed(String),
}

/// Solo permitimos los filtros que genera el frontend: nombres conocidos y
/// caracteres seguros, para que nada pueda inyectar otra cosa en el grafo.
fn safe_filters(raw: &Option<String>) -> Option<String> {
    const ALLOWED: &[&str] = &[
        "hue", "eq", "colorchannelmixer", "colorbalance", "gblur", "vignette", "negate",
    ];
    let f = raw.as_deref()?.trim();
    if f.is_empty() || f.len() > 500 {
        return None;
    }
    if !f
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '=' | ':' | ',' | '.' | '-' | '_'))
    {
        return None;
    }
    if f.split(',').all(|part| {
        let name = part.split('=').next().unwrap_or("");
        ALLOWED.contains(&name)
    }) {
        Some(f.to_string())
    } else {
        None
    }
}

pub(crate) fn sec(v: f64) -> String {
    format!("{v:.4}")
}

/// Duración de la pista principal descontando los solapes de las transiciones.
fn video_length(clips: &[ExportClip]) -> f64 {
    let mut len = 0.0;
    for (i, c) in clips.iter().enumerate() {
        len += c.duration();
        if let (Some(t), Some(next)) = (&c.transition, clips.get(i + 1)) {
            if XFADE_NAMES.contains(&t.xfade.as_str()) {
                len -= t.duration.max(0.0).min(c.duration() / 2.0).min(next.duration() / 2.0);
            }
        }
    }
    len
}

fn total_duration(plan: &ExportPlan) -> f64 {
    let video = video_length(&plan.video);
    plan.audio
        .iter()
        .map(|c| c.start + c.duration())
        .fold(video, f64::max)
}

fn build_args(plan: &ExportPlan, encoder: Encoder) -> Vec<String> {
    let n = plan.video.len();
    let (w, h) = (plan.width, plan.height);
    let fps = format!("{:.3}", plan.fps);
    let total = total_duration(plan);

    let mut args: Vec<String> = [
        "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y",
    ]
    .map(String::from)
    .to_vec();

    // Un input por clip, con búsqueda en el input (-ss antes de -i): rápida y exacta.
    for c in plan.video.iter().chain(&plan.audio) {
        args.extend([
            "-ss".into(),
            sec(c.in_sec),
            "-t".into(),
            sec(c.duration()),
            "-i".into(),
            c.path.clone(),
        ]);
    }
    // Capas de texto: secuencias PNG con alfa.
    for ov in &plan.overlays {
        args.extend([
            "-framerate".into(),
            format!("{:.3}", ov.fps),
            "-i".into(),
            ov.pattern.clone(),
        ]);
    }

    let mut filters: Vec<String> = Vec::new();
    for (i, c) in plan.video.iter().enumerate() {
        // Todos los segmentos al mismo tamaño/fps/formato para poder concatenarlos.
        let fx = safe_filters(&c.filters).map(|f| format!(",{f}")).unwrap_or_default();
        filters.push(format!(
            "[{i}:v]setpts=PTS-STARTPTS,\
             scale={w}:{h}:force_original_aspect_ratio=decrease:flags=bicubic,\
             pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps}{fx},format=yuv420p[v{i}]"
        ));
        if c.has_audio {
            filters.push(format!(
                "[{i}:a]asetpts=PTS-STARTPTS,aresample=48000:async=1,\
                 aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}]"
            ));
        } else {
            // Vídeo mudo: silencio de la misma duración.
            filters.push(format!(
                "anullsrc=r=48000:cl=stereo,atrim=0:{}[a{i}]",
                sec(c.duration())
            ));
        }
    }
    // Encadenamos los clips: corte seco = concat; con transición = xfade (vídeo) + acrossfade (audio).
    let mut vcur = String::from("v0");
    let mut acur = String::from("a0");
    let mut cur_len = plan.video[0].duration();
    for i in 1..n {
        let prev = &plan.video[i - 1];
        let c = &plan.video[i];
        match &prev.transition {
            Some(t) if t.duration > 0.0 && XFADE_NAMES.contains(&t.xfade.as_str()) => {
                let d = t.duration.min(prev.duration() / 2.0).min(c.duration() / 2.0);
                let offset = (cur_len - d).max(0.0);
                filters.push(format!(
                    "[{vcur}][v{i}]xfade=transition={}:duration={}:offset={}[vx{i}]",
                    t.xfade,
                    sec(d),
                    sec(offset)
                ));
                filters.push(format!("[{acur}][a{i}]acrossfade=d={}:c1=tri:c2=tri[ax{i}]", sec(d)));
                cur_len += c.duration() - d;
            }
            _ => {
                filters.push(format!("[{vcur}][v{i}]concat=n=2:v=1:a=0[vx{i}]"));
                filters.push(format!("[{acur}][a{i}]concat=n=2:v=0:a=1[ax{i}]"));
                cur_len += c.duration();
            }
        }
        vcur = format!("vx{i}");
        acur = format!("ax{i}");
    }
    filters.push(format!("[{vcur}]null[vcat]"));
    filters.push(format!("[{acur}]anull[acat]"));
    let video_len = cur_len;

    // Si la pista de audio dura más que el vídeo, rellenamos con negro.
    if total > video_len + 0.01 {
        filters.push(format!(
            "[vcat]tpad=stop_duration={}:color=black[vpad]",
            sec(total - video_len)
        ));
    } else {
        filters.push("[vcat]null[vpad]".into());
    }
    // Superponemos cada capa de texto desplazada a su instante; antes y después, pasa el vídeo tal cual.
    let mut last = String::from("vpad");
    let first_overlay_input = plan.video.len() + plan.audio.len();
    for (k, ov) in plan.overlays.iter().enumerate() {
        let idx = first_overlay_input + k;
        filters.push(format!("[{idx}:v]setpts=PTS-STARTPTS+{}/TB[ov{k}]", sec(ov.start)));
        filters.push(format!("[{last}][ov{k}]overlay=eof_action=pass:format=auto[vo{k}]"));
        last = format!("vo{k}");
    }
    filters.push(format!("[{last}]format=yuv420p[vout]"));

    if plan.audio.is_empty() {
        filters.push("[acat]anull[aout]".into());
    } else {
        let mut mix = String::from("[acat]");
        for (j, c) in plan.audio.iter().enumerate() {
            let k = n + j;
            let ms = (c.start * 1000.0).round() as u64;
            filters.push(format!(
                "[{k}:a]asetpts=PTS-STARTPTS,aresample=48000,\
                 aformat=sample_fmts=fltp:channel_layouts=stereo,adelay={ms}:all=1[m{j}]"
            ));
            mix.push_str(&format!("[m{j}]"));
        }
        filters.push(format!(
            "{mix}amix=inputs={}:duration=longest:normalize=0[aout]",
            plan.audio.len() + 1
        ));
    }

    args.extend([
        "-filter_complex".into(),
        filters.join(";"),
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[aout]".into(),
    ]);

    match encoder {
        Encoder::VideoToolbox => {
            // Bitrate proporcional a píxeles × fps (1080p30 ≈ 12 Mb/s).
            let kbps = ((w * h) as f64 * plan.fps * 0.19 / 1000.0).clamp(2000.0, 60000.0) as u32;
            let bitrate = format!("{kbps}k");
            args.extend(
                ["-c:v", "h264_videotoolbox", "-b:v", &bitrate, "-profile:v", "high", "-allow_sw", "1"]
                    .map(String::from),
            );
        }
        Encoder::X264 => args.extend(
            ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high"]
                .map(String::from),
        ),
    }
    let total_s = sec(total);
    args.extend(
        ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", &total_s]
            .map(String::from),
    );
    args.push(plan.output.clone());
    args
}

/// Ejecuta ffmpeg y va emitiendo `export:progress` al frontend.
async fn run(
    app: &AppHandle,
    state: &ExportState,
    args: Vec<String>,
    total: f64,
) -> Result<(), RunError> {
    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| RunError::Failed(format!("No se encontró el sidecar ffmpeg: {e}")))?
        .args(args)
        .spawn()
        .map_err(|e| RunError::Failed(format!("No se pudo ejecutar ffmpeg: {e}")))?;
    *state.child.lock().unwrap() = Some(child);

    let mut stderr = String::new();
    let mut speed: Option<f64> = None;
    let mut code: Option<i32> = None;
    let mut saw_us = false;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                // `-progress pipe:1` escribe bloques clave=valor; out_time_us es lo que nos interesa
                // (out_time_ms también son microsegundos, por un error histórico de ffmpeg).
                let line = String::from_utf8_lossy(&line);
                let line = line.trim();
                if let Some(v) = line.strip_prefix("speed=") {
                    speed = v.trim().trim_end_matches('x').parse().ok();
                    continue;
                }
                let value = if let Some(v) = line.strip_prefix("out_time_us=") {
                    saw_us = true;
                    Some(v)
                } else if !saw_us {
                    line.strip_prefix("out_time_ms=")
                } else {
                    None
                };
                if let Some(us) = value.and_then(|v| v.trim().parse::<i64>().ok()) {
                    let out_time = us.max(0) as f64 / 1e6;
                    let percent = if total > 0.0 {
                        (out_time / total * 100.0).clamp(0.0, 100.0)
                    } else {
                        0.0
                    };
                    let _ = app.emit("export:progress", ExportProgress { percent, out_time, speed });
                }
            }
            CommandEvent::Stderr(line) => {
                stderr.push_str(&String::from_utf8_lossy(&line));
                stderr.push('\n');
            }
            CommandEvent::Error(e) => {
                stderr.push_str(&e);
                stderr.push('\n');
            }
            CommandEvent::Terminated(payload) => {
                code = payload.code;
                break;
            }
            _ => {}
        }
    }
    state.child.lock().unwrap().take();

    if state.cancelled.swap(false, Ordering::SeqCst) {
        return Err(RunError::Cancelled);
    }
    if code == Some(0) {
        return Ok(());
    }
    let lines: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = lines[lines.len().saturating_sub(6)..].join("\n");
    Err(RunError::Failed(if tail.is_empty() {
        format!("ffmpeg terminó con código {code:?}")
    } else {
        tail
    }))
}

#[tauri::command]
pub async fn export_video(
    app: AppHandle,
    state: State<'_, ExportState>,
    plan: ExportPlan,
) -> Result<ExportResult, String> {
    if plan.video.is_empty() {
        return Err("No hay clips de vídeo en el timeline".into());
    }
    if plan.width < 2 || plan.height < 2 || plan.fps <= 0.0 {
        return Err("Resolución o fps no válidos".into());
    }
    let mut plan = plan;
    // yuv420p exige dimensiones pares.
    plan.width -= plan.width % 2;
    plan.height -= plan.height % 2;
    let total = total_duration(&plan);
    let state = state.inner();
    state.cancelled.store(false, Ordering::SeqCst);

    let started = Instant::now();
    let mut encoder = if plan.encoder == "x264" || !cfg!(target_os = "macos") {
        Encoder::X264
    } else {
        Encoder::VideoToolbox
    };
    let mut result = run(&app, state, build_args(&plan, encoder), total).await;

    // Si el codificador por hardware falla, reintentamos por software.
    if matches!(result, Err(RunError::Failed(_))) && encoder == Encoder::VideoToolbox {
        encoder = Encoder::X264;
        result = run(&app, state, build_args(&plan, encoder), total).await;
    }

    match result {
        Ok(()) => Ok(ExportResult {
            output: plan.output,
            encoder: encoder.name().into(),
            seconds: started.elapsed().as_secs_f64(),
        }),
        Err(RunError::Cancelled) => {
            let _ = std::fs::remove_file(&plan.output);
            Err("Exportación cancelada".into())
        }
        Err(RunError::Failed(msg)) => {
            let _ = std::fs::remove_file(&plan.output);
            Err(msg)
        }
    }
}

fn header_u32(request: &Request<'_>, name: &str) -> Result<u32, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| format!("Falta la cabecera {name}"))
}

/// Crea la carpeta temporal donde el frontend irá dejando los frames de texto.
#[tauri::command]
pub fn export_overlay_begin(state: State<'_, ExportState>) -> Result<String, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("cutvideo-overlay-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta temporal: {e}"))?;
    let mut slot = state.overlay_dir.lock().unwrap();
    if let Some(old) = slot.replace(dir.clone()) {
        let _ = std::fs::remove_dir_all(old);
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Recibe un frame PNG (cuerpo binario) y lo guarda como `<dir>/<segmento>/<frame>.png`.
#[tauri::command]
pub fn export_write_frame(state: State<'_, ExportState>, request: Request<'_>) -> Result<(), String> {
    let dir = state
        .overlay_dir
        .lock()
        .unwrap()
        .clone()
        .ok_or("No hay ninguna exportación de textos en curso")?;
    let segment = header_u32(&request, "x-segment")?;
    let frame = header_u32(&request, "x-frame")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaba un cuerpo binario".into());
    };
    let seg_dir = dir.join(segment.to_string());
    std::fs::create_dir_all(&seg_dir).map_err(|e| e.to_string())?;
    std::fs::write(seg_dir.join(format!("{frame:05}.png")), bytes).map_err(|e| e.to_string())
}

/// Borra la carpeta temporal de frames de texto.
#[tauri::command]
pub fn export_overlay_end(state: State<'_, ExportState>) -> Result<(), String> {
    if let Some(dir) = state.overlay_dir.lock().unwrap().take() {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_export(state: State<'_, ExportState>) -> Result<(), String> {
    state.cancelled.store(true, Ordering::SeqCst);
    if let Some(child) = state.child.lock().unwrap().take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_filters() {
        assert!(safe_filters(&Some("eq=contrast=1.2,hue=h=10".into())).is_some());
        assert!(safe_filters(&Some("vignette=angle=0.3".into())).is_some());
        // Nada de comillas, espacios, tuberías ni filtros fuera de la lista.
        assert!(safe_filters(&Some("movie=/etc/passwd".into())).is_none());
        assert!(safe_filters(&Some("eq=contrast=1[x];[x]drawtext=text=hola".into())).is_none());
        assert!(safe_filters(&Some("eq=contrast=1 -y /tmp/x".into())).is_none());
        assert!(safe_filters(&Some("".into())).is_none());
        assert!(safe_filters(&None).is_none());
    }

    fn clip(path: &str, in_sec: f64, out: f64, start: f64, has_audio: bool) -> ExportClip {
        ExportClip { path: path.into(), in_sec, out, start, has_audio, transition: None, filters: None }
    }

    /// Prueba de humo del grafo de filtros con el ffmpeg del sistema. Se activa con
    /// CUTVIDEO_FFMPEG=/ruta/ffmpeg y CUTVIDEO_TEST_DIR=<dir con clipA.mp4, clipB.mp4, mute.mp4, music.mp3>.
    #[test]
    fn filter_graph_runs_on_real_ffmpeg() {
        let (Ok(ffmpeg), Ok(dir)) = (std::env::var("CUTVIDEO_FFMPEG"), std::env::var("CUTVIDEO_TEST_DIR")) else {
            eprintln!("saltada: define CUTVIDEO_FFMPEG y CUTVIDEO_TEST_DIR");
            return;
        };
        let p = |name: &str| format!("{dir}/{name}");
        let output = p("out-test.mp4");
        // Capa de texto simulada: 15 PNG semitransparentes (0,5 s a 30 fps) que empiezan en 1 s.
        let overlay_dir = std::path::PathBuf::from(&dir).join("overlay-test");
        let _ = std::fs::remove_dir_all(&overlay_dir);
        std::fs::create_dir_all(&overlay_dir).unwrap();
        let pattern = overlay_dir.join("%05d.png").to_string_lossy().into_owned();
        let gen = std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=1280x720:r=30:d=0.5,format=rgba", &pattern])
            .status()
            .expect("generar PNGs");
        assert!(gen.success(), "no se pudieron generar los PNG de prueba");

        let plan = ExportPlan {
            output: output.clone(),
            width: 1280,
            height: 720,
            fps: 30.0,
            video: vec![
                // A → B con fundido de 0,5 s (solape); B → mute corte seco.
                ExportClip {
                    transition: Some(ExportTransition { xfade: "fade".into(), duration: 0.5 }),
                    filters: Some("eq=saturation=1.5:contrast=1.1,vignette=angle=0.3".into()),
                    ..clip(&p("clipA.mp4"), 0.5, 2.5, 0.0, true)
                },
                clip(&p("clipB.mp4"), 1.0, 3.0, 1.5, true),
                clip(&p("mute.mp4"), 0.0, 1.5, 3.5, false),
            ],
            audio: vec![clip(&p("music.mp3"), 0.0, 5.0, 1.5, true)],
            encoder: "x264".into(),
            overlays: vec![ExportOverlay { pattern, fps: 30.0, start: 1.0 }],
        };
        let expected = total_duration(&plan);
        assert!((expected - 6.5).abs() < 1e-9, "duración total {expected} (vídeo 5 - 0,5 de solape, audio hasta 6,5)");

        let args = build_args(&plan, Encoder::X264);
        let status = std::process::Command::new(&ffmpeg).args(&args).status().expect("ejecutar ffmpeg");
        assert!(status.success(), "ffmpeg falló con {status}\nargs: {}", args.join(" "));

        let probe = std::process::Command::new(ffmpeg.replace("ffmpeg", "ffprobe"))
            .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", &output])
            .output()
            .expect("ejecutar ffprobe");
        let duration: f64 = String::from_utf8_lossy(&probe.stdout).trim().parse().expect("duración");
        assert!((duration - expected).abs() < 0.2, "duración exportada {duration}, esperada {expected}");
    }
}
