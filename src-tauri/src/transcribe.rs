//! Transcripción automática: extrae el audio de la pista principal con ffmpeg
//! y lo envía a un servicio Whisper en la nube (Groq u OpenAI) con la clave
//! guardada en el llavero. La clave nunca sale de Rust.

use crate::export::{sec, ExportClip};
use crate::secrets;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

/// Límite de los planes gratuitos (25 MB); dejamos margen.
const MAX_UPLOAD_BYTES: u64 = 24 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// "groq" u "openai".
    pub provider: String,
    /// Código ISO-639-1 ("es", "en"…) o null para detección automática.
    pub language: Option<String>,
    /// Clips de la pista principal en orden: el audio se concatena igual que en el timeline.
    pub clips: Vec<ExportClip>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    pub language: Option<String>,
    pub duration: Option<f64>,
    pub words: Vec<Word>,
    pub segments: Vec<Segment>,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    message: String,
}

// ---- Respuesta `verbose_json` de la API (formato Whisper de OpenAI, que Groq replica) ----

#[derive(Deserialize, Default)]
struct ApiTranscript {
    #[serde(default)]
    text: String,
    language: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    segments: Vec<ApiSegment>,
    #[serde(default)]
    words: Vec<ApiWord>,
}

#[derive(Deserialize)]
struct ApiSegment {
    start: f64,
    end: f64,
    text: String,
}

#[derive(Deserialize)]
struct ApiWord {
    word: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
struct ApiError {
    error: Option<ApiErrorBody>,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    message: Option<String>,
}

struct Provider {
    id: &'static str,
    name: &'static str,
    url: &'static str,
    model: &'static str,
}

const PROVIDERS: &[Provider] = &[
    Provider {
        id: "groq",
        name: "Groq",
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        model: "whisper-large-v3-turbo",
    },
    Provider {
        id: "openai",
        name: "OpenAI",
        url: "https://api.openai.com/v1/audio/transcriptions",
        model: "whisper-1",
    },
];

/// Argumentos de ffmpeg para sacar el audio de la pista principal como MP3 mono
/// a 16 kHz (lo que Whisper usa internamente), con silencio donde el vídeo es mudo.
pub fn build_audio_args(clips: &[ExportClip], output: &str) -> Vec<String> {
    let n = clips.len();
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostats", "-y"]
        .map(String::from)
        .to_vec();
    for c in clips {
        args.extend([
            "-ss".into(),
            sec(c.in_sec),
            "-t".into(),
            sec(c.duration()),
            "-i".into(),
            c.path.clone(),
        ]);
    }
    let mut filters: Vec<String> = Vec::new();
    for (i, c) in clips.iter().enumerate() {
        if c.has_audio {
            filters.push(format!(
                "[{i}:a]asetpts=PTS-STARTPTS,aresample=16000:async=1,\
                 aformat=sample_fmts=s16:channel_layouts=mono[a{i}]"
            ));
        } else {
            filters.push(format!(
                "anullsrc=r=16000:cl=mono,atrim=0:{}[a{i}]",
                sec(c.duration())
            ));
        }
    }
    let inputs: String = (0..n).map(|i| format!("[a{i}]")).collect();
    filters.push(format!("{inputs}concat=n={n}:v=0:a=1[aout]"));
    args.extend(
        [
            "-filter_complex", &filters.join(";"), "-map", "[aout]", "-c:a", "libmp3lame", "-b:a", "48k",
            "-ar", "16000", "-ac", "1", output,
        ]
        .map(String::from),
    );
    args
}

fn progress(app: &AppHandle, stage: &'static str, message: impl Into<String>) {
    let _ = app.emit("transcribe:progress", Progress { stage, message: message.into() });
}

#[tauri::command]
pub async fn transcribe(app: AppHandle, request: TranscribeRequest) -> Result<Transcript, String> {
    let provider = PROVIDERS
        .iter()
        .find(|p| p.id == request.provider)
        .ok_or_else(|| format!("Proveedor desconocido: {}", request.provider))?;
    if request.clips.is_empty() {
        return Err("No hay clips de vídeo en el timeline".into());
    }
    let key = secrets::api_key(provider.id)?.ok_or_else(|| {
        format!("Falta la clave de API de {}. Añádela en Ajustes → Claves de API.", provider.name)
    })?;

    // 1) Audio de la pista principal.
    progress(&app, "extract", "Extrayendo el audio…");
    let audio_path = std::env::temp_dir().join(format!("quickcut-transcribe-{}.mp3", std::process::id()));
    let audio = audio_path.to_string_lossy().into_owned();
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args(build_audio_args(&request.clips, &audio))
        .output()
        .await
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&audio_path);
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() { "ffmpeg no pudo extraer el audio".into() } else { err });
    }
    let bytes = std::fs::read(&audio_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&audio_path);
    if bytes.len() as u64 > MAX_UPLOAD_BYTES {
        return Err(format!(
            "El audio ocupa {:.1} MB y el máximo del servicio es 25 MB (unos 70 min). Divide el proyecto.",
            bytes.len() as f64 / 1_048_576.0
        ));
    }

    // 2) Subida y transcripción.
    progress(&app, "upload", format!("Transcribiendo con {} ({})…", provider.name, provider.model));
    let mut form = reqwest::multipart::Form::new()
        .part(
            "file",
            reqwest::multipart::Part::bytes(bytes)
                .file_name("audio.mp3")
                .mime_str("audio/mpeg")
                .map_err(|e| e.to_string())?,
        )
        .text("model", provider.model)
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "word")
        .text("timestamp_granularities[]", "segment");
    if let Some(lang) = request.language.as_deref().filter(|l| !l.is_empty()) {
        form = form.text("language", lang.to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(provider.url)
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con {}: {e}", provider.name))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = serde_json::from_str::<ApiError>(&body)
            .ok()
            .and_then(|e| e.error)
            .and_then(|e| e.message)
            .unwrap_or_else(|| body.chars().take(300).collect());
        return Err(match status.as_u16() {
            401 => format!("{} ha rechazado la clave de API. Revísala en Ajustes.", provider.name),
            429 => format!("{}: límite de uso alcanzado. Espera un poco o cambia de proveedor.", provider.name),
            _ => format!("{} respondió {}: {detail}", provider.name, status.as_u16()),
        });
    }
    let raw: ApiTranscript = serde_json::from_str(&body).map_err(|e| format!("Respuesta no válida: {e}"))?;

    progress(&app, "done", "Transcripción recibida");
    Ok(Transcript {
        text: raw.text.trim().to_string(),
        language: raw.language,
        duration: raw.duration,
        words: raw
            .words
            .into_iter()
            .map(|w| Word { word: w.word.trim().to_string(), start: w.start, end: w.end })
            .filter(|w| !w.word.is_empty())
            .collect(),
        segments: raw
            .segments
            .into_iter()
            .map(|s| Segment { start: s.start, end: s.end, text: s.text.trim().to_string() })
            .collect(),
        provider: provider.id.into(),
        model: provider.model.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Extrae audio real con el ffmpeg del sistema (mismas variables que el test de export).
    #[test]
    fn audio_extraction_runs_on_real_ffmpeg() {
        let (Ok(ffmpeg), Ok(dir)) = (std::env::var("QUICKCUT_FFMPEG"), std::env::var("QUICKCUT_TEST_DIR")) else {
            eprintln!("saltada: define QUICKCUT_FFMPEG y QUICKCUT_TEST_DIR");
            return;
        };
        let clip = |name: &str, in_sec: f64, out: f64, start: f64, has_audio: bool| ExportClip {
            path: format!("{dir}/{name}"),
            in_sec,
            out,
            start,
            has_audio,
        };
        let clips = vec![clip("clipA.mp4", 0.0, 2.0, 0.0, true), clip("mute.mp4", 0.0, 1.0, 2.0, false)];
        let output = format!("{dir}/transcribe-test.mp3");
        let status = std::process::Command::new(&ffmpeg)
            .args(build_audio_args(&clips, &output))
            .status()
            .expect("ejecutar ffmpeg");
        assert!(status.success());
        let probe = std::process::Command::new(ffmpeg.replace("ffmpeg", "ffprobe"))
            .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", &output])
            .output()
            .unwrap();
        let duration: f64 = String::from_utf8_lossy(&probe.stdout).trim().parse().unwrap();
        assert!((duration - 3.0).abs() < 0.15, "duración {duration}");
    }
}
