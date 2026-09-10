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
    /// Último codificador que funcionó: así no se vuelven a probar los que
    /// esta máquina no tiene cada vez que se exporta.
    encoder: Mutex<Option<Encoder>>,
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

/// Silueta de recorte de una capa: un flujo de bytes en gris, un byte por
/// píxel, sin comprimir. Comprimir cada fotograma a PNG costaba más que todo
/// lo demás junto, así que el frontend escribe los bytes tal cual y ffmpeg los
/// lee como `rawvideo`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMask {
    /// Segmento dentro de la carpeta temporal. La ruta la pone el backend.
    pub segment: u32,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    /// Ruta real del archivo; la rellena `export_video`, nunca el frontend.
    #[serde(skip)]
    pub path: String,
}

/// Colocación de una capa dentro del frame (centro y tamaño normalizados).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLayout {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub opacity: f64,
}

/// Clip de una pista superpuesta (O1/O2): va encima del vídeo principal,
/// colocado según `layout` y recortado por croma y/o por la máscara de persona.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLayer {
    pub clip: ExportClip,
    pub layout: ExportLayout,
    /// Silueta de la persona (blanco = se ve), o null.
    #[serde(default)]
    pub mask: Option<ExportMask>,
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
    /// Filtros de pantalla verde, también validados.
    #[serde(default)]
    pub chroma: Option<String>,
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
    /// Clips de la pista de fondo (F1): se ven por detrás de la pantalla verde.
    #[serde(default)]
    pub background: Vec<ExportClip>,
    /// Capas superpuestas (O2 primero, O1 encima), en orden de dibujo.
    #[serde(default)]
    pub layers: Vec<ExportLayer>,
    /// "auto" (hardware si lo hay) o "x264".
    pub encoder: String,
    /// "cover" recorta lo que sobra; "contain" deja franjas.
    #[serde(default = "default_fit")]
    pub fit: String,
    #[serde(default)]
    pub overlays: Vec<ExportOverlay>,
}

fn default_fit() -> String {
    "cover".into()
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
    /// Mac: bloque dedicado de vídeo del chip.
    VideoToolbox,
    /// Windows/Linux con gráfica Nvidia.
    Nvenc,
    /// Gráfica integrada de Intel (Quick Sync).
    Qsv,
    /// Gráfica AMD.
    Amf,
    /// Por software, en el procesador. Es el que mejor imagen da, pero solo
    /// existe en las builds GPL: en Windows no viene, porque x264 es GPL y no
    /// puede ir dentro de una app con licencia MIT.
    X264,
    /// Por software también, y de la build LGPL: en Windows es el único que
    /// queda si ninguna gráfica sirve.
    OpenH264,
}

impl Encoder {
    fn name(self) -> &'static str {
        match self {
            Encoder::VideoToolbox => "h264_videotoolbox",
            Encoder::Nvenc => "h264_nvenc",
            Encoder::Qsv => "h264_qsv",
            Encoder::Amf => "h264_amf",
            Encoder::X264 => "libx264",
            Encoder::OpenH264 => "libopenh264",
        }
    }

    /// Codificadores a probar, del más rápido al que siempre funciona. Si el
    /// equipo no tiene esa gráfica, ffmpeg falla al arrancar y pasamos al
    /// siguiente, así que no hace falta detectar el hardware por otro lado.
    fn candidates(forced: &str) -> Vec<Encoder> {
        if forced == "x264" {
            return vec![Encoder::X264, Encoder::OpenH264];
        }
        if cfg!(target_os = "macos") {
            vec![Encoder::VideoToolbox, Encoder::X264, Encoder::OpenH264]
        } else {
            vec![
                Encoder::Nvenc,
                Encoder::Qsv,
                Encoder::Amf,
                Encoder::X264,
                Encoder::OpenH264,
            ]
        }
    }

    /// Argumentos de codificación. Los de hardware van por bitrate; x264 por
    /// calidad constante, que es lo que mejor se le da. openh264 no tiene modo
    /// de calidad constante, así que también va por bitrate.
    fn args(self, bitrate: &str) -> Vec<String> {
        match self {
            Encoder::VideoToolbox => vec![
                "-c:v", "h264_videotoolbox", "-b:v", bitrate, "-profile:v", "high", "-allow_sw", "1",
            ],
            Encoder::Nvenc => vec![
                "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-b:v", bitrate,
                "-profile:v", "high",
            ],
            Encoder::Qsv => vec!["-c:v", "h264_qsv", "-b:v", bitrate, "-profile:v", "high"],
            Encoder::Amf => vec![
                "-c:v", "h264_amf", "-quality", "balanced", "-rc", "vbr_latency", "-b:v", bitrate,
                "-profile:v", "high",
            ],
            Encoder::X264 => vec![
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high",
            ],
            Encoder::OpenH264 => vec![
                "-c:v", "libopenh264", "-b:v", bitrate, "-profile:v", "high", "-coder",
                "cabac", "-rc_mode", "bitrate",
            ],
        }
        .into_iter()
        .map(String::from)
        .collect()
    }
}

enum RunError {
    Cancelled,
    Failed(String),
}

/// Igual que `safe_filters`, para los filtros de pantalla verde.
fn safe_chroma(raw: &Option<String>) -> Option<String> {
    const ALLOWED: &[&str] = &["format", "chromakey", "colorkey", "despill"];
    check_filters(raw, ALLOWED)
}

/// Solo permitimos los filtros que genera el frontend: nombres conocidos y
/// caracteres seguros, para que nada pueda inyectar otra cosa en el grafo.
fn safe_filters(raw: &Option<String>) -> Option<String> {
    const ALLOWED: &[&str] = &[
        "hue", "eq", "colorchannelmixer", "colorbalance", "gblur", "vignette", "negate",
    ];
    check_filters(raw, ALLOWED)
}

fn check_filters(raw: &Option<String>, allowed: &[&str]) -> Option<String> {
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
        allowed.contains(&name)
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
        .chain(plan.layers.iter().map(|l| &l.clip))
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
    for c in plan.video.iter().chain(&plan.audio).chain(&plan.background) {
        args.extend([
            "-ss".into(),
            sec(c.in_sec),
            "-t".into(),
            sec(c.duration()),
            "-i".into(),
            c.path.clone(),
        ]);
    }
    for l in &plan.layers {
        args.extend([
            "-ss".into(),
            sec(l.clip.in_sec),
            "-t".into(),
            sec(l.clip.duration()),
            "-i".into(),
            l.clip.path.clone(),
        ]);
    }
    // Máscaras de recorte: un byte por píxel, sin cabecera ni compresión.
    for m in plan.layers.iter().filter_map(|l| l.mask.as_ref()) {
        args.extend([
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "gray".into(),
            "-video_size".into(),
            format!("{}x{}", m.width, m.height),
            "-framerate".into(),
            format!("{:.3}", m.fps),
            "-i".into(),
            m.path.clone(),
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

    // "Rellenar" agranda y recorta el sobrante; "Encajar" reduce y rellena con franjas.
    let encaje = if plan.fit == "contain" {
        format!(
            "scale={w}:{h}:force_original_aspect_ratio=decrease:flags=bicubic,\
             pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black@0"
        )
    } else {
        format!(
            "scale={w}:{h}:force_original_aspect_ratio=increase:flags=bicubic,crop={w}:{h}"
        )
    };

    let mut filters: Vec<String> = Vec::new();
    for (i, c) in plan.video.iter().enumerate() {
        // Todos los segmentos al mismo tamaño/fps/formato para poder concatenarlos.
        let fx = safe_filters(&c.filters).map(|f| format!(",{f}")).unwrap_or_default();
        // Con croma el clip conserva el canal alfa para que se vea el fondo por detrás.
        let chroma = safe_chroma(&c.chroma).map(|f| format!(",{f}")).unwrap_or_default();
        let out_fmt = if chroma.is_empty() { "format=yuv420p" } else { "format=yuva420p" };
        filters.push(format!(
            "[{i}:v]setpts=PTS-STARTPTS,{encaje},setsar=1,fps={fps}{fx}{chroma},{out_fmt}[v{i}]"
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

    // Fondo (F1): lienzo negro con los clips de fondo colocados en su instante.
    // El vídeo principal va encima; si lleva croma, deja ver esto por detrás.
    let bg_first = plan.video.len() + plan.audio.len();
    let mut base = String::from("canvas");
    filters.push(format!(
        "color=c=black:s={w}x{h}:r={fps}:d={}[canvas]",
        sec(total)
    ));
    for (k, c) in plan.background.iter().enumerate() {
        let idx = bg_first + k;
        let end = c.start + c.duration();
        filters.push(format!(
            "[{idx}:v]setpts=PTS-STARTPTS+{}/TB,\
             scale={w}:{h}:force_original_aspect_ratio=increase:flags=bicubic,\
             crop={w}:{h},setsar=1,fps={fps}[bgv{k}]",
            sec(c.start)
        ));
        filters.push(format!(
            "[{base}][bgv{k}]overlay=eof_action=pass:enable='between(t,{},{})'[bgm{k}]",
            sec(c.start),
            sec(end)
        ));
        base = format!("bgm{k}");
    }
    filters.push(format!("[{base}][vpad]overlay=eof_action=pass:format=auto[vcomp]"));

    // Capas superpuestas (O2, luego O1): se colocan, se recortan y se encadenan.
    let layer_first = bg_first + plan.background.len();
    let mask_first = layer_first + plan.layers.len();
    let mut last = String::from("vcomp");
    let mut mask_n = 0usize;
    for (k, l) in plan.layers.iter().enumerate() {
        let idx = layer_first + k;
        // La caja de la capa es el frame escalado por `scale`, centrado en (x, y).
        let scale = l.layout.scale.clamp(0.02, 4.0);
        let bw = ((plan.width as f64 * scale) as u32).max(2) & !1;
        let bh = ((plan.height as f64 * scale) as u32).max(2) & !1;
        let bx = ((l.layout.x - scale / 2.0) * plan.width as f64).round() as i64;
        let by = ((l.layout.y - scale / 2.0) * plan.height as f64).round() as i64;
        let fx = safe_filters(&l.clip.filters).map(|f| format!(",{f}")).unwrap_or_default();
        let chroma = safe_chroma(&l.clip.chroma).map(|f| format!(",{f}")).unwrap_or_default();
        // La capa se encaja en su caja igual que en el preview (rellenar/encajar).
        let caja = if plan.fit == "contain" {
            format!(
                "scale={bw}:{bh}:force_original_aspect_ratio=decrease:flags=bicubic,\
                 pad={bw}:{bh}:(ow-iw)/2:(oh-ih)/2:color=black@0"
            )
        } else {
            format!("scale={bw}:{bh}:force_original_aspect_ratio=increase:flags=bicubic,crop={bw}:{bh}")
        };
        filters.push(format!(
            "[{idx}:v]setpts=PTS-STARTPTS+{}/TB,{caja},setsar=1,fps={fps}{fx}{chroma},format=rgba[ly{k}]",
            sec(l.clip.start)
        ));
        let mut cur = format!("ly{k}");
        if l.mask.is_some() {
            let midx = mask_first + mask_n;
            mask_n += 1;
            filters.push(format!(
                "[{midx}:v]setpts=PTS-STARTPTS+{}/TB,scale={bw}:{bh}:flags=bilinear,\
                 format=gray,fps={fps}[lm{k}]",
                sec(l.clip.start)
            ));
            if chroma.is_empty() {
                filters.push(format!("[{cur}][lm{k}]alphamerge[lc{k}]"));
            } else {
                // Con croma ya hay alfa: la multiplicamos por la silueta.
                filters.push(format!("[{cur}]split[lp{k}][lq{k}]"));
                filters.push(format!("[lq{k}]alphaextract[la{k}]"));
                filters.push(format!("[la{k}][lm{k}]blend=all_mode=multiply[lb{k}]"));
                filters.push(format!("[lp{k}][lb{k}]alphamerge[lc{k}]"));
            }
            cur = format!("lc{k}");
        }
        let opacity = l.layout.opacity.clamp(0.0, 1.0);
        if opacity < 0.999 {
            filters.push(format!("[{cur}]colorchannelmixer=aa={opacity:.3}[lo{k}]"));
            cur = format!("lo{k}");
        }
        filters.push(format!(
            "[{last}][{cur}]overlay=x={bx}:y={by}:eof_action=pass:format=auto:\
             enable='between(t,{},{})'[lv{k}]",
            sec(l.clip.start),
            sec(l.clip.start + l.clip.duration())
        ));
        last = format!("lv{k}");
    }

    // Superponemos cada capa de texto y parches desplazada a su instante.
    let first_overlay_input = mask_first + mask_n;
    for (k, ov) in plan.overlays.iter().enumerate() {
        let idx = first_overlay_input + k;
        filters.push(format!("[{idx}:v]setpts=PTS-STARTPTS+{}/TB[ov{k}]", sec(ov.start)));
        filters.push(format!("[{last}][ov{k}]overlay=eof_action=pass:format=auto[vo{k}]"));
        last = format!("vo{k}");
    }
    filters.push(format!("[{last}]format=yuv420p[vout]"));

    // Todo lo que suena aparte de la pista principal: la pista A1, el fondo
    // y las capas que tengan audio. Antes las capas iban mudas y el usuario,
    // con razón, no entendía por qué su clip no sonaba. (input, inicio)
    let mut extras: Vec<(usize, f64)> = Vec::new();
    for (j, c) in plan.audio.iter().enumerate() {
        extras.push((n + j, c.start));
    }
    for (k, c) in plan.background.iter().enumerate() {
        if c.has_audio {
            extras.push((bg_first + k, c.start));
        }
    }
    for (k, l) in plan.layers.iter().enumerate() {
        if l.clip.has_audio {
            extras.push((layer_first + k, l.clip.start));
        }
    }
    if extras.is_empty() {
        filters.push("[acat]anull[aout]".into());
    } else {
        let mut mix = String::from("[acat]");
        for (j, (k, start)) in extras.iter().enumerate() {
            let ms = (start * 1000.0).round() as u64;
            filters.push(format!(
                "[{k}:a]asetpts=PTS-STARTPTS,aresample=48000,\
                 aformat=sample_fmts=fltp:channel_layouts=stereo,adelay={ms}:all=1[m{j}]"
            ));
            mix.push_str(&format!("[m{j}]"));
        }
        filters.push(format!(
            "{mix}amix=inputs={}:duration=longest:normalize=0[aout]",
            extras.len() + 1
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

    // Bitrate proporcional a píxeles × fps (1080p30 ≈ 12 Mb/s).
    let kbps = ((w * h) as f64 * plan.fps * 0.19 / 1000.0).clamp(2000.0, 60000.0) as u32;
    args.extend(encoder.args(&format!("{kbps}k")));
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

    // Las rutas de las siluetas las pone el backend a partir de su propia
    // carpeta temporal: el frontend solo dice qué segmento le toca a cada capa.
    let overlay_dir = state.overlay_dir.lock().unwrap().clone();
    for capa in plan.layers.iter_mut() {
        if let Some(m) = capa.mask.as_mut() {
            let dir = overlay_dir
                .as_ref()
                .ok_or("No se prepararon las siluetas de recorte")?;
            if m.width < 2 || m.height < 2 || m.width > 8192 || m.height > 8192 || m.fps <= 0.0 {
                return Err("Silueta de recorte con tamaño o fps no válidos".into());
            }
            let path = dir.join(format!("{}.raw", m.segment));
            if !path.is_file() {
                return Err(format!("Falta la silueta de la capa (segmento {})", m.segment));
            }
            m.path = path.to_string_lossy().into_owned();
        }
    }
    let total = total_duration(&plan);
    let state = state.inner();
    state.cancelled.store(false, Ordering::SeqCst);

    let started = Instant::now();
    // Probamos los codificadores por hardware y, si el equipo no los tiene,
    // caemos al de software. La lista siempre acaba en x264.
    let mut candidates = Encoder::candidates(&plan.encoder);
    // El que ya funcionó aquí va primero.
    if let Some(previo) = *state.encoder.lock().unwrap() {
        if let Some(i) = candidates.iter().position(|&c| c == previo) {
            candidates.swap(0, i);
        }
    }
    let mut encoder = candidates[0];
    let mut result = run(&app, state, build_args(&plan, encoder), total).await;
    for &siguiente in &candidates[1..] {
        if !matches!(result, Err(RunError::Failed(_))) {
            break;
        }
        encoder = siguiente;
        result = run(&app, state, build_args(&plan, encoder), total).await;
    }

    if result.is_ok() {
        *state.encoder.lock().unwrap() = Some(encoder);
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

/// Añade un fotograma de silueta (bytes en gris) al flujo `<dir>/<segmento>.raw`.
/// Los fotogramas tienen todos el mismo tamaño, así que el orden se comprueba
/// mirando lo que lleva escrito el archivo: si no cuadra, algo llegó cambiado
/// de sitio y el recorte saldría desplazado.
#[tauri::command]
pub fn export_write_raw(state: State<'_, ExportState>, request: Request<'_>) -> Result<(), String> {
    let dir = state
        .overlay_dir
        .lock()
        .unwrap()
        .clone()
        .ok_or("No hay ninguna exportación en curso")?;
    let segment = header_u32(&request, "x-segment")?;
    let frame = header_u32(&request, "x-frame")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaba un cuerpo binario".into());
    };
    if bytes.is_empty() {
        return Err("Fotograma de silueta vacío".into());
    }
    let path = dir.join(format!("{segment}.raw"));
    let mut file = if frame == 0 {
        std::fs::File::create(&path).map_err(|e| e.to_string())?
    } else {
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .map_err(|e| e.to_string())?
    };
    let escrito = file.metadata().map_err(|e| e.to_string())?.len();
    let esperado = frame as u64 * bytes.len() as u64;
    if escrito != esperado {
        return Err(format!(
            "Las siluetas llegaron desordenadas (fotograma {frame}: había {escrito} bytes, se esperaban {esperado})"
        ));
    }
    std::io::Write::write_all(&mut file, bytes).map_err(|e| e.to_string())
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
        // El croma tiene su propia lista: no se cuelan filtros de color por ahí.
        assert!(safe_chroma(&Some("format=yuva420p,chromakey=0x00b140:0.3:0.08".into())).is_some());
        assert!(safe_chroma(&Some("despill=type=green:mix=0.4".into())).is_some());
        assert!(safe_chroma(&Some("eq=contrast=2".into())).is_none());
        assert!(safe_chroma(&Some("movie=x.mp4".into())).is_none());
    }

    fn clip(path: &str, in_sec: f64, out: f64, start: f64, has_audio: bool) -> ExportClip {
        ExportClip {
            path: path.into(),
            in_sec,
            out,
            start,
            has_audio,
            transition: None,
            filters: None,
            chroma: None,
        }
    }

    /// Cambiar la proporción debe producir un MP4 con esas dimensiones,
    /// y "rellenar" no deja franjas negras donde "encajar" sí las deja.
    #[test]
    fn aspect_and_fit_change_the_output_frame() {
        let (Ok(ffmpeg), Ok(dir)) = (std::env::var("CUTVIDEO_FFMPEG"), std::env::var("CUTVIDEO_TEST_DIR")) else {
            eprintln!("saltada: define CUTVIDEO_FFMPEG y CUTVIDEO_TEST_DIR");
            return;
        };
        // Clip 16:9 con relleno naranja: en vertical hay que recortar o enmarcar.
        let src = format!("{dir}/aspect-src.mp4");
        let ok = std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i",
                   "color=c=orange:s=640x360:r=25:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", &src])
            .status()
            .expect("generar el clip");
        assert!(ok.success());

        for (fit, esquina_negra) in [("cover", false), ("contain", true)] {
            let out = format!("{dir}/aspect-{fit}.mp4");
            let plan = ExportPlan {
                output: out.clone(),
                // 9:16 a partir de un 640x360: el lado corto manda.
                width: 360,
                height: 640,
                fps: 25.0,
                video: vec![clip(&src, 0.0, 1.0, 0.0, false)],
                audio: vec![],
                background: vec![],
                encoder: "x264".into(),
                fit: fit.into(),
                overlays: vec![],
                layers: vec![],
            };
            let status = std::process::Command::new(&ffmpeg)
                .args(build_args(&plan, Encoder::X264))
                .status()
                .expect("ejecutar ffmpeg");
            assert!(status.success(), "ffmpeg falló con fit={fit}");

            let probe = std::process::Command::new(ffmpeg.replace("ffmpeg", "ffprobe"))
                .args(["-v", "error", "-select_streams", "v:0", "-show_entries",
                       "stream=width,height", "-of", "csv=p=0:s=x", &out])
                .output()
                .unwrap();
            let dims = String::from_utf8_lossy(&probe.stdout).trim().to_string();
            assert_eq!(dims, "360x640", "dimensiones con fit={fit}");

            // Píxel de arriba del todo: con "encajar" es franja negra; con "rellenar", naranja.
            let o = std::process::Command::new(&ffmpeg)
                .args(["-v", "error", "-i", &out, "-frames:v", "1", "-vf",
                       "crop=40:40:160:10,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                .output()
                .unwrap();
            let negro = o.stdout.iter().all(|&c| c < 40);
            assert_eq!(negro, esquina_negra, "fit={fit} dio {:?} arriba", o.stdout);
        }
    }


    /// Dos capas encimadas: la de abajo recortada por máscara y la de arriba
    /// por pantalla verde. Cada zona del frame tiene que enseñar lo suyo.
    #[test]
    fn stacked_layers_composite_with_chroma_and_mask() {
        let (Ok(ffmpeg), Ok(dir)) = (std::env::var("CUTVIDEO_FFMPEG"), std::env::var("CUTVIDEO_TEST_DIR")) else {
            eprintln!("saltada: define CUTVIDEO_FFMPEG y CUTVIDEO_TEST_DIR");
            return;
        };
        let p = |name: &str| format!("{dir}/{name}");
        let lavfi = |filtro: &str, salida: &str| {
            let ok = std::process::Command::new(&ffmpeg)
                .args(["-v", "error", "-y", "-f", "lavfi", "-i", filtro,
                       "-c:v", "libx264", "-pix_fmt", "yuv420p", salida])
                .status()
                .expect("generar el clip");
            assert!(ok.success());
        };
        let (base, magenta, verde) = (p("cap-base.mp4"), p("cap-mag.mp4"), p("cap-verde.mp4"));
        let amarillo = p("cap-ama.mp4");
        lavfi("color=c=blue:s=320x240:r=25:d=3", &base);
        lavfi("color=c=magenta:s=320x240:r=25:d=2", &magenta);
        lavfi("color=c=yellow:s=320x240:r=25:d=1", &amarillo);
        lavfi(
            "color=c=0x00b140:s=320x240:r=25:d=2,drawbox=x=130:y=90:w=60:h=60:color=red:t=fill",
            &verde,
        );

        // Silueta: blanca a la izquierda, negra a la derecha, en el mismo flujo
        // de bytes en gris que escribe el frontend (un byte por píxel, sin
        // comprimir). Aquí es donde se vería si ffmpeg recortara el rango.
        let mask_raw = p("cap-mask.raw");
        let ok = std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i",
                   "color=c=black:s=160x120:r=25:d=2,drawbox=x=0:y=0:w=80:h=120:color=white:t=fill",
                   "-f", "rawvideo", "-pix_fmt", "gray", &mask_raw])
            .status()
            .expect("generar la silueta");
        assert!(ok.success());

        let out = p("cap-out.mp4");
        let plan = ExportPlan {
            output: out.clone(),
            width: 320,
            height: 240,
            fps: 25.0,
            video: vec![clip(&base, 0.0, 3.0, 0.0, false)],
            audio: vec![],
            background: vec![],
            layers: vec![
                // Abajo: magenta a pantalla completa, recortado por la máscara.
                ExportLayer {
                    clip: clip(&magenta, 0.0, 2.0, 0.0, false),
                    layout: ExportLayout { x: 0.5, y: 0.5, scale: 1.0, opacity: 1.0 },
                    mask: Some(ExportMask {
                        segment: 0,
                        fps: 25.0,
                        width: 160,
                        height: 120,
                        path: mask_raw.clone(),
                    }),
                },
                // Encima: pantalla verde a media escala, en el centro.
                ExportLayer {
                    clip: ExportClip {
                        chroma: Some("format=yuva420p,chromakey=0x00b140:0.3:0.08".into()),
                        ..clip(&verde, 0.0, 2.0, 0.0, false)
                    },
                    layout: ExportLayout { x: 0.5, y: 0.5, scale: 0.5, opacity: 1.0 },
                    mask: None,
                },
                // Escena de relleno que entra a mitad de vídeo, en una esquina.
                ExportLayer {
                    clip: clip(&amarillo, 0.0, 1.0, 2.0, false),
                    layout: ExportLayout { x: 0.8, y: 0.8, scale: 0.3, opacity: 1.0 },
                    mask: None,
                },
            ],
            encoder: "x264".into(),
            fit: "cover".into(),
            overlays: vec![],
        };
        let status = std::process::Command::new(&ffmpeg)
            .args(build_args(&plan, Encoder::X264))
            .status()
            .expect("ejecutar ffmpeg");
        assert!(status.success(), "ffmpeg falló componiendo las capas");

        // Color medio de un cuadradito del frame en el instante que se pida.
        let en = |t: &str, x: u32, y: u32| -> (u8, u8, u8) {
            let o = std::process::Command::new(&ffmpeg)
                .args(["-v", "error", "-ss", t, "-i", &out, "-frames:v", "1", "-vf",
                       &format!("crop=10:10:{x}:{y},scale=1:1"),
                       "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                .output()
                .unwrap();
            let b = o.stdout;
            assert!(b.len() >= 3, "no se pudo leer el píxel en {x},{y}");
            (b[0], b[1], b[2])
        };
        let px = |x: u32, y: u32| en("1", x, y);
        // Exigimos magenta puro: si la máscara perdiera rango, saldría lavado.
        let magenta_p = |c: (u8, u8, u8)| c.0 > 240 && c.1 < 25 && c.2 > 240;
        let azul_p = |c: (u8, u8, u8)| c.0 < 90 && c.1 < 90 && c.2 > 140;
        let rojo_p = |c: (u8, u8, u8)| c.0 > 150 && c.1 < 90 && c.2 < 90;

        let izq = px(20, 20);
        assert!(magenta_p(izq), "la máscara debía dejar magenta a la izquierda, dio {izq:?}");
        let der = px(280, 20);
        assert!(azul_p(der), "a la derecha la máscara tapa: debía verse el vídeo, dio {der:?}");
        let centro = px(155, 115);
        assert!(rojo_p(centro), "el croma debía dejar el cuadrado rojo, dio {centro:?}");
        // Dentro de la caja del croma pero fuera del rojo: se ve la capa de abajo.
        let dentro = px(95, 115);
        assert!(magenta_p(dentro), "el verde debía ser transparente, dio {dentro:?}");

        // La escena de relleno solo debe verse a partir de su segundo 2.
        let amarillo_p = |c: (u8, u8, u8)| c.0 > 150 && c.1 > 150 && c.2 < 90;
        let antes = en("1", 250, 190);
        assert!(azul_p(antes), "la escena de relleno no debía verse todavía, dio {antes:?}");
        let despues = en("2.5", 250, 190);
        assert!(amarillo_p(despues), "la escena de relleno debía estar en la esquina, dio {despues:?}");
        // Y al entrar no debe tapar el resto del frame; a esas alturas la capa
        // de magenta ya se ha acabado, así que ahí se ve el vídeo principal.
        let fuera = en("2.5", 40, 190);
        assert!(azul_p(fuera), "la esquina no debía extenderse, dio {fuera:?}");
    }

    /// Una capa con sonido tiene que oírse en el vídeo final, no solo verse.
    #[test]
    fn layer_audio_is_mixed_into_the_export() {
        let (Ok(ffmpeg), Ok(dir)) = (std::env::var("CUTVIDEO_FFMPEG"), std::env::var("CUTVIDEO_TEST_DIR")) else {
            eprintln!("saltada: define CUTVIDEO_FFMPEG y CUTVIDEO_TEST_DIR");
            return;
        };
        let p = |name: &str| format!("{dir}/{name}");
        // Base muda; capa con un tono de 440 Hz.
        let base = p("aud-base.mp4");
        let capa = p("aud-capa.mp4");
        assert!(std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=25:d=2",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", &base])
            .status().unwrap().success());
        assert!(std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-y",
                   "-f", "lavfi", "-i", "color=c=red:s=160x120:r=25:d=2",
                   "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &capa])
            .status().unwrap().success());
        let out = p("aud-out.mp4");
        let plan = ExportPlan {
            output: out.clone(),
            width: 160, height: 120, fps: 25.0,
            video: vec![clip(&base, 0.0, 2.0, 0.0, false)],
            audio: vec![], background: vec![],
            layers: vec![ExportLayer {
                clip: clip(&capa, 0.0, 2.0, 0.0, true),
                layout: ExportLayout { x: 0.5, y: 0.5, scale: 0.5, opacity: 1.0 },
                mask: None,
            }],
            encoder: "x264".into(), fit: "cover".into(), overlays: vec![],
        };
        assert!(std::process::Command::new(&ffmpeg).args(build_args(&plan, Encoder::X264)).status().unwrap().success());
        let o = std::process::Command::new(&ffmpeg)
            .args(["-i", &out, "-af", "volumedetect", "-f", "null", "-"])
            .output().unwrap();
        let log = String::from_utf8_lossy(&o.stderr);
        let media: f64 = log.lines()
            .find_map(|l| l.split("mean_volume:").nth(1))
            .and_then(|v| v.trim().trim_end_matches(" dB").parse().ok())
            .expect("volumedetect no dio mean_volume");
        assert!(media > -40.0, "la capa debía sonar en la exportación; volumen medio {media} dB");
    }

    /// La pantalla verde debe dejar ver la pista de fondo por detrás.
    #[test]
    fn chroma_key_shows_the_background_track() {
        let (Ok(ffmpeg), Ok(dir)) = (std::env::var("CUTVIDEO_FFMPEG"), std::env::var("CUTVIDEO_TEST_DIR")) else {
            eprintln!("saltada: define CUTVIDEO_FFMPEG y CUTVIDEO_TEST_DIR");
            return;
        };
        let p = |name: &str| format!("{dir}/{name}");
        // Primer plano: verde croma con un cuadrado rojo en el centro.
        // Fondo: azul liso. Tras el croma, fuera del cuadrado debe verse azul.
        let green = p("chroma-fg.mp4");
        let blue = p("chroma-bg.mp4");
        for (file, filter) in [
            (&green, "color=c=0x00b140:s=320x240:r=25:d=2,drawbox=x=130:y=90:w=60:h=60:color=red:t=fill"),
            (&blue, "color=c=blue:s=320x240:r=25:d=2"),
        ] {
            let ok = std::process::Command::new(&ffmpeg)
                .args(["-v", "error", "-y", "-f", "lavfi", "-i", filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", file])
                .status()
                .expect("generar el clip de prueba");
            assert!(ok.success());
        }

        let out = p("chroma-out.mp4");
        let plan = ExportPlan {
            output: out.clone(),
            width: 320,
            height: 240,
            fps: 25.0,
            video: vec![ExportClip {
                chroma: Some("format=yuva420p,chromakey=0x00b140:0.3:0.08".into()),
                ..clip(&green, 0.0, 2.0, 0.0, false)
            }],
            audio: vec![],
            background: vec![clip(&blue, 0.0, 2.0, 0.0, false)],
            encoder: "x264".into(),
            fit: "cover".into(),
            overlays: vec![],
            layers: vec![],
        };
        let status = std::process::Command::new(&ffmpeg)
            .args(build_args(&plan, Encoder::X264))
            .status()
            .expect("ejecutar ffmpeg");
        assert!(status.success(), "ffmpeg falló montando el croma");

        // Un píxel de la esquina (era verde) y otro del centro (era rojo).
        let pixel = |crop: &str| -> Vec<u8> {
            let o = std::process::Command::new(&ffmpeg)
                .args(["-v", "error", "-ss", "1", "-i", &out, "-frames:v", "1", "-vf",
                       &format!("crop={crop},scale=1:1"), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                .output()
                .expect("leer el píxel");
            o.stdout
        };
        let esquina = pixel("40:40:10:10");
        let centro = pixel("30:30:145:105");
        assert!(
            esquina[2] > 120 && esquina[1] < 90,
            "la esquina debería ser azul (el fondo), y es {esquina:?}"
        );
        assert!(
            centro[0] > 120 && centro[2] < 90,
            "el centro debería seguir siendo rojo (el sujeto), y es {centro:?}"
        );
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
            background: vec![clip(&p("clipB.mp4"), 0.0, 3.0, 0.0, false)],
            layers: vec![],
            encoder: "x264".into(),
            fit: "cover".into(),
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
