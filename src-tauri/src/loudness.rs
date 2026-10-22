//! Sonoridad del montaje (LUFS, EBU R128) con el medidor de FilmCraft
//! (`filmcraft-audio-dsp`, ver `vendor/filmcraft`).
//!
//! Se mide la mezcla que va a salir: ffmpeg monta el mismo grafo de audio que
//! la exportación (`export::audio_graph`) y lo saca en crudo por la tubería, y
//! aquí se va pasando por el medidor a trozos, sin guardarlo entero (10 minutos
//! serían 230 MB). De paso se apunta la sonoridad cada décima de segundo: el
//! preview la lee según el playhead y así los medidores se mueven "en vivo"
//! sin tocar el audio que suena, que va por los `<video>` del WebView.

use crate::export::{audio_graph, ExportPlan};
use filmcraft_audio_dsp::loudness::LoudnessMeter;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const RATE: u32 = 48_000;
/// Una muestra de la curva cada 100 ms: lo que dura un sub-bloque del medidor.
pub const STEP: f64 = 0.1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessReport {
    /// LUFS integrados de todo el montaje (lo que miran YouTube y compañía).
    pub integrated: f64,
    /// Rango de sonoridad (LU): cuánto varía entre lo flojo y lo fuerte.
    pub range: f64,
    /// Pico real (dBTP), con sobremuestreo: lo que de verdad llega a saturar.
    pub true_peak: f64,
    /// Separación entre muestras de las curvas, en segundos.
    pub step: f64,
    /// Sonoridad momentánea (400 ms) y a corto plazo (3 s) cada `step`.
    pub momentary: Vec<f32>,
    pub short_term: Vec<f32>,
}

/// Va acumulando PCM f32 estéreo intercalado y apuntando la curva.
pub struct Measure {
    meter: LoudnessMeter,
    /// Bytes que sobraron del último trozo (una muestra partida entre dos).
    rest: Vec<u8>,
    frames: u64,
    next_mark: u64,
    momentary: Vec<f32>,
    short_term: Vec<f32>,
}

impl Default for Measure {
    fn default() -> Self {
        Measure {
            meter: LoudnessMeter::new(RATE as f64, 2),
            rest: Vec::new(),
            frames: 0,
            next_mark: (RATE as f64 * STEP) as u64,
            momentary: Vec::new(),
            short_term: Vec::new(),
        }
    }
}

/// LUFS a f32 para la curva; el silencio (−∞) no cabe en JSON y se deja en −70.
fn lufs(v: f64) -> f32 {
    if v.is_finite() { v.max(-70.0) as f32 } else { -70.0 }
}

impl Measure {
    pub fn push(&mut self, bytes: &[u8]) {
        self.rest.extend_from_slice(bytes);
        let whole = self.rest.len() / 8 * 8;
        let samples: Vec<f32> = self.rest[..whole]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        self.rest.drain(..whole);
        // A trozos hasta cada marca de 100 ms, para leer el medidor justo ahí.
        let mut i = 0;
        while i < samples.len() {
            let left = (self.next_mark - self.frames) as usize;
            let take = left.min((samples.len() - i) / 2);
            self.meter.process_interleaved(&samples[i..i + take * 2]);
            self.frames += take as u64;
            i += take * 2;
            if self.frames == self.next_mark {
                self.momentary.push(lufs(self.meter.momentary()));
                self.short_term.push(lufs(self.meter.short_term()));
                self.next_mark += (RATE as f64 * STEP) as u64;
            }
        }
    }

    pub fn finish(self) -> LoudnessReport {
        let fin = |v: f64| if v.is_finite() { v } else { -70.0 };
        LoudnessReport {
            integrated: fin(self.meter.integrated()),
            range: fin(self.meter.loudness_range()).max(0.0),
            true_peak: fin(self.meter.true_peak_dbtp()),
            step: STEP,
            momentary: self.momentary,
            short_term: self.short_term,
        }
    }
}

/// Argumentos de ffmpeg para sacar la mezcla final en f32 estéreo por stdout.
pub fn mix_args(plan: &ExportPlan, total: f64) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostats"].map(String::from).to_vec();
    // Mismo orden de inputs que la exportación: el grafo cuenta con él.
    let clips = plan
        .video
        .iter()
        .chain(&plan.audio)
        .chain(&plan.background)
        .chain(plan.layers.iter().map(|l| &l.clip));
    for c in clips {
        args.extend(["-ss".into(), format!("{:.3}", c.in_sec), "-t".into(), format!("{:.3}", c.duration()), "-i".into(), c.path.clone()]);
    }
    let mut medir = plan.clone();
    medir.loudness_target = None;
    medir.loudness_gain = None;
    args.extend([
        "-filter_complex".into(),
        audio_graph(&medir).join(";"),
        "-map".into(),
        "[aout]".into(),
        "-t".into(),
        format!("{total:.3}"),
        "-f".into(),
        "f32le".into(),
        "-ac".into(),
        "2".into(),
        "-ar".into(),
        RATE.to_string(),
        "pipe:1".into(),
    ]);
    args
}

pub async fn measure(app: &AppHandle, plan: &ExportPlan) -> Result<LoudnessReport, String> {
    if plan.video.is_empty() {
        return Err("No hay clips de vídeo en el timeline".into());
    }
    let total = crate::export::total_duration(plan);
    let (mut rx, _child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args(mix_args(plan, total))
        // En crudo: si no, el plugin trocea stdout por saltos de línea.
        .set_raw_out(true)
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
    let mut m = Measure::default();
    let mut err = String::new();
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(b) => m.push(&b),
            CommandEvent::Stderr(b) => err.push_str(&String::from_utf8_lossy(&b)),
            CommandEvent::Terminated(t) if t.code != Some(0) => {
                let e = err.trim();
                return Err(if e.is_empty() { "ffmpeg no pudo medir el audio".into() } else { e.to_string() });
            }
            _ => {}
        }
    }
    Ok(m.finish())
}

#[tauri::command]
pub async fn measure_loudness(app: AppHandle, plan: ExportPlan) -> Result<LoudnessReport, String> {
    measure(&app, &plan).await
}

/// Ganancia (dB) para llevar `integrated` a `target`. Con ±20 dB de tope: más
/// solo pasa con una pista casi muda, y subirla 30 dB sería subir el ruido.
pub fn gain_for(integrated: f64, target: f64) -> Option<f64> {
    (integrated > -60.0).then(|| (target - integrated).clamp(-20.0, 20.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un seno de 1 kHz a amplitud `a` en los dos canales, en bytes f32le.
    fn seno(a: f32, secs: f64) -> Vec<u8> {
        let n = (RATE as f64 * secs) as usize;
        (0..n)
            .flat_map(|i| {
                let v = a * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / RATE as f32).sin();
                [v, v]
            })
            .flat_map(f32::to_le_bytes)
            .collect()
    }

    #[test]
    fn un_seno_a_menos_20_dbfs_mide_menos_20_lufs() {
        let mut m = Measure::default();
        // A trozos raros, para probar que las muestras partidas se recomponen.
        for chunk in seno(0.1, 5.0).chunks(1001) {
            m.push(chunk);
        }
        let r = m.finish();
        // BS.1770: un seno de 1 kHz en los dos canales mide lo mismo que su nivel en dBFS.
        assert!((r.integrated + 20.0).abs() < 0.3, "{}", r.integrated);
        assert!((r.true_peak + 20.0).abs() < 0.3, "{}", r.true_peak);
        assert_eq!(r.momentary.len(), 50);
    }

    #[test]
    fn el_silencio_no_rompe_nada() {
        let mut m = Measure::default();
        m.push(&seno(0.0, 1.0));
        let r = m.finish();
        assert_eq!(r.integrated, -70.0);
        assert_eq!(gain_for(r.integrated, -14.0), None);
    }

    /// La mezcla que saca ffmpeg con `mix_args` (y el grafo de la exportación)
    /// se mide como su nivel: un seno de -20 dBFS da -20 LUFS.
    #[test]
    fn mide_la_mezcla_de_ffmpeg() {
        let Ok(ffmpeg) = std::env::var("CUTVIDEO_FFMPEG") else { return };
        let dir = std::env::temp_dir().join(format!("cutvideo-lufs-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("seno.wav").to_string_lossy().into_owned();
        let ok = std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=1000:d=4:r=48000",
                   "-af", "volume=-20dB,pan=stereo|c0=1.4142*c0|c1=1.4142*c0", "-c:a", "pcm_s24le", &wav])
            .status()
            .unwrap();
        assert!(ok.success());
        let plan: ExportPlan = serde_json::from_value(serde_json::json!({
            "output": "", "width": 2, "height": 2, "fps": 30.0, "background": [], "audio": [],
            "layers": [], "encoder": "auto", "overlays": [],
            "video": [{ "path": wav, "in": 0.0, "out": 4.0, "start": 0.0, "hasAudio": true }]
        }))
        .unwrap();
        let medir = |plan: &ExportPlan, con_ganancia: bool| {
            let mut args = mix_args(plan, 4.0);
            if con_ganancia {
                // mix_args quita la ganancia a propósito; aquí se pone el grafo de la exportación.
                let i = args.iter().position(|a| a == "-filter_complex").unwrap();
                args[i + 1] = audio_graph(plan).join(";");
            }
            let out = std::process::Command::new(&ffmpeg).args(args).output().unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            let mut m = Measure::default();
            m.push(&out.stdout);
            m.finish()
        };
        let r = medir(&plan, false);
        // El seno de lavfi sale a amplitud 1/8 (-18 dBFS); con -20 dB queda en -38,
        // y el pan ×√2 por canal lo sube 3 dB: -35 LUFS.
        assert!((r.integrated + 35.0).abs() < 0.5, "{}", r.integrated);

        // Con la ganancia que calcula la exportación, sale al objetivo. -16 y
        // no -14: subir 21 dB pasaría del tope de 20.
        let mut normal = plan.clone();
        normal.loudness_target = Some(-16.0);
        normal.loudness_gain = gain_for(r.integrated, -16.0);
        let n = medir(&normal, true);
        let _ = std::fs::remove_dir_all(&dir);
        assert!((n.integrated + 16.0).abs() < 0.5, "{}", n.integrated);
        assert!(n.true_peak <= -0.9, "el limitador debería dejar el pico bajo -1: {}", n.true_peak);
    }

    #[test]
    fn la_ganancia_lleva_al_objetivo_con_tope() {
        assert_eq!(gain_for(-20.0, -14.0), Some(6.0));
        assert_eq!(gain_for(-50.0, -14.0), Some(20.0));
    }
}
