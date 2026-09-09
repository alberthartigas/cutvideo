//! Análisis de audio: silencios (para cortar) y ritmo (para editar al compás).

use crate::export::{sec, ExportClip};
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Frecuencia a la que analizamos: suficiente para el ritmo y rápida de procesar.
const SR: usize = 22_050;
const WIN: usize = 1024;
const HOP: usize = 256;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Silence {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceRequest {
    pub clips: Vec<ExportClip>,
    /// Umbral en dBFS (-30 va bien para voz grabada con algo de ruido).
    pub threshold_db: f64,
    /// Duración mínima del silencio para contarlo (s).
    pub min_duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatAnalysis {
    pub bpm: f64,
    /// Instantes de los pulsos (s).
    pub beats: Vec<f64>,
    /// Instantes de los golpes fuertes (1 de cada 4 pulsos, el más marcado).
    pub downbeats: Vec<f64>,
    pub duration: f64,
    /// 0–1: cómo de claro es el ritmo. Por debajo de 0,25 no conviene fiarse.
    pub confidence: f64,
}

/// Extrae el audio de la pista principal y busca los tramos silenciosos.
#[tauri::command]
pub async fn detect_silences(app: AppHandle, request: SilenceRequest) -> Result<Vec<Silence>, String> {
    if request.clips.is_empty() {
        return Ok(Vec::new());
    }
    let mut args: Vec<String> = ["-hide_banner", "-nostats"].map(String::from).to_vec();
    for c in &request.clips {
        args.extend([
            "-ss".into(),
            sec(c.in_sec),
            "-t".into(),
            sec(c.duration()),
            "-i".into(),
            c.path.clone(),
        ]);
    }
    let n = request.clips.len();
    let mut filters: Vec<String> = Vec::new();
    for (i, c) in request.clips.iter().enumerate() {
        if c.has_audio {
            filters.push(format!("[{i}:a]asetpts=PTS-STARTPTS,aresample=16000[a{i}]"));
        } else {
            filters.push(format!("anullsrc=r=16000:cl=mono,atrim=0:{}[a{i}]", sec(c.duration())));
        }
    }
    let inputs: String = (0..n).map(|i| format!("[a{i}]")).collect();
    filters.push(format!(
        "{inputs}concat=n={n}:v=0:a=1,silencedetect=noise={}dB:d={}[out]",
        request.threshold_db, request.min_duration
    ));
    args.extend(
        ["-filter_complex", &filters.join(";"), "-map", "[out]", "-f", "null", "-"].map(String::from),
    );

    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
    Ok(parse_silences(&String::from_utf8_lossy(&output.stderr)))
}

/// `silencedetect` escribe pares "silence_start: X" / "silence_end: Y" en stderr.
fn parse_silences(log: &str) -> Vec<Silence> {
    let mut out = Vec::new();
    let mut start: Option<f64> = None;
    for line in log.lines() {
        if let Some(v) = line.split("silence_start:").nth(1) {
            start = v.split_whitespace().next().and_then(|s| s.parse().ok());
        } else if let Some(v) = line.split("silence_end:").nth(1) {
            if let (Some(s), Some(e)) = (
                start.take(),
                v.split_whitespace().next().and_then(|s| s.parse::<f64>().ok()),
            ) {
                if e > s {
                    out.push(Silence { start: s, end: e });
                }
            }
        }
    }
    out
}

/// Decodifica un archivo a PCM mono f32 a 22 050 Hz.
async fn decode_mono(app: &AppHandle, path: &str) -> Result<Vec<f32>, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args([
            "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar",
            &SR.to_string(), "-f", "f32le", "-",
        ])
        .output()
        .await
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() { "ffmpeg no pudo leer el audio".into() } else { err });
    }
    Ok(output
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// Envolvente de novedad espectral (spectral flux): sube en cada golpe.
fn onset_envelope(samples: &[f32]) -> Vec<f32> {
    use rustfft::{num_complex::Complex, FftPlanner};
    if samples.len() < WIN * 2 {
        return Vec::new();
    }
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(WIN);
    // Ventana de Hann para que no aparezcan golpes falsos en los bordes.
    let window: Vec<f32> = (0..WIN)
        .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / WIN as f32).cos())
        .collect();

    let frames = (samples.len() - WIN) / HOP;
    let mut env = Vec::with_capacity(frames);
    let mut prev = vec![0.0f32; WIN / 2];
    let mut buf = vec![Complex::new(0.0f32, 0.0); WIN];
    for f in 0..frames {
        let base = f * HOP;
        for i in 0..WIN {
            buf[i] = Complex::new(samples[base + i] * window[i], 0.0);
        }
        fft.process(&mut buf);
        let mut flux = 0.0f32;
        for k in 0..WIN / 2 {
            // Escala logarítmica: se parece más a cómo oímos los golpes.
            let mag = (1.0 + 20.0 * buf[k].norm()).ln();
            let diff = mag - prev[k];
            if diff > 0.0 {
                flux += diff;
            }
            prev[k] = mag;
        }
        env.push(flux);
    }

    // Restamos la media móvil: deja solo los picos, sin importar el volumen general.
    let w = 20usize;
    let smoothed: Vec<f32> = (0..env.len())
        .map(|i| {
            let lo = i.saturating_sub(w);
            let hi = (i + w + 1).min(env.len());
            env[lo..hi].iter().sum::<f32>() / (hi - lo) as f32
        })
        .collect();
    env.iter().zip(&smoothed).map(|(v, m)| (v - m).max(0.0)).collect()
}

/// BPM por autocorrelación de la envolvente, buscando entre 60 y 190.
fn estimate_tempo(env: &[f32], fps: f64) -> (f64, f64) {
    let min_lag = (fps * 60.0 / 190.0).round() as usize;
    let max_lag = (fps * 60.0 / 60.0).round() as usize;
    if env.len() < max_lag * 2 || max_lag <= min_lag {
        return (0.0, 0.0);
    }
    let energy: f32 = env.iter().map(|v| v * v).sum();
    if energy <= f32::EPSILON {
        return (0.0, 0.0);
    }
    let mut best = (min_lag, 0.0f32);
    let mut total = 0.0f32;
    let mut count = 0usize;
    for lag in min_lag..=max_lag {
        let mut sum = 0.0f32;
        for i in 0..env.len() - lag {
            sum += env[i] * env[i + lag];
        }
        let score = sum / (env.len() - lag) as f32;
        total += score;
        count += 1;
        if score > best.1 {
            best = (lag, score);
        }
    }
    let mean = if count > 0 { total / count as f32 } else { 0.0 };
    // Confianza: cuánto destaca el mejor desfase sobre la media.
    let confidence = if mean > 0.0 { ((best.1 / mean - 1.0) / 2.0).clamp(0.0, 1.0) } else { 0.0 };
    (60.0 * fps / best.0 as f64, confidence as f64)
}

/// Coloca la rejilla de pulsos en la fase que más golpes recoge.
fn beat_grid(env: &[f32], fps: f64, bpm: f64) -> Vec<f64> {
    let period = 60.0 / bpm * fps;
    if period < 2.0 {
        return Vec::new();
    }
    let steps = period.round() as usize;
    let mut best_offset = 0usize;
    let mut best_score = -1.0f32;
    for offset in 0..steps {
        let mut score = 0.0f32;
        let mut i = offset as f64;
        while (i as usize) < env.len() {
            score += env[i as usize];
            i += period;
        }
        if score > best_score {
            best_score = score;
            best_offset = offset;
        }
    }
    let mut beats = Vec::new();
    let mut i = best_offset as f64;
    while (i as usize) < env.len() {
        beats.push(i / fps);
        i += period;
    }
    beats
}

/// Analiza el ritmo de un archivo de audio (o del audio de un vídeo).
#[tauri::command]
pub async fn analyze_beats(app: AppHandle, path: String) -> Result<BeatAnalysis, String> {
    let samples = decode_mono(&app, &path).await?;
    let duration = samples.len() as f64 / SR as f64;
    let env = onset_envelope(&samples);
    let fps = SR as f64 / HOP as f64;
    let (bpm, confidence) = estimate_tempo(&env, fps);
    if bpm <= 0.0 {
        return Ok(BeatAnalysis { bpm: 0.0, beats: Vec::new(), downbeats: Vec::new(), duration, confidence: 0.0 });
    }
    let beats = beat_grid(&env, fps, bpm);

    // Golpe fuerte: de cada 4 pulsos, el que más energía acumula en su posición.
    let value_at = |t: f64| -> f32 {
        let i = (t * fps).round() as usize;
        env.get(i).copied().unwrap_or(0.0)
    };
    let phase = (0..4)
        .max_by(|&a, &b| {
            let sa: f32 = beats.iter().skip(a).step_by(4).map(|&t| value_at(t)).sum();
            let sb: f32 = beats.iter().skip(b).step_by(4).map(|&t| value_at(t)).sum();
            sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(0);
    let downbeats = beats.iter().skip(phase).step_by(4).copied().collect();

    Ok(BeatAnalysis { bpm, beats, downbeats, duration, confidence })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_silencedetect_log() {
        let log = "[silencedetect @ 0x1] silence_start: 1.25\n\
                   [silencedetect @ 0x1] silence_end: 2.75 | silence_duration: 1.5\n\
                   [silencedetect @ 0x1] silence_start: 8\n\
                   [silencedetect @ 0x1] silence_end: 9.5 | silence_duration: 1.5\n";
        let s = parse_silences(log);
        assert_eq!(s.len(), 2);
        assert!((s[0].start - 1.25).abs() < 1e-9 && (s[0].end - 2.75).abs() < 1e-9);
        assert!((s[1].start - 8.0).abs() < 1e-9);
        // Un silencio abierto sin cierre no se cuenta.
        assert!(parse_silences("silence_start: 3").is_empty());
    }

    /// Un clic periódico sintético debe dar el BPM exacto.
    #[test]
    fn estimates_tempo_of_a_synthetic_click_track() {
        let bpm = 120.0;
        let period = (SR as f64 * 60.0 / bpm) as usize;
        let mut samples = vec![0.0f32; SR * 12];
        let mut i = 0;
        while i < samples.len() {
            for k in 0..200.min(samples.len() - i) {
                // Golpe corto que decae: se parece a una percusión.
                samples[i + k] = (1.0 - k as f32 / 200.0) * ((k as f32) * 0.7).sin();
            }
            i += period;
        }
        let env = onset_envelope(&samples);
        let fps = SR as f64 / HOP as f64;
        let (detected, confidence) = estimate_tempo(&env, fps);
        assert!((detected - bpm).abs() < 3.0, "BPM detectado {detected}");
        assert!(confidence > 0.2, "confianza {confidence}");
        let beats = beat_grid(&env, fps, detected);
        assert!(beats.len() > 20, "pocos pulsos: {}", beats.len());
    }
}
