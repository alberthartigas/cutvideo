//! Análisis de archivos multimedia con el sidecar `ffprobe`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub file_name: String,
    pub container: String,
    pub duration_sec: f64,
    pub size_bytes: u64,
    pub bit_rate: Option<u64>,
    pub video: Option<VideoStream>,
    pub audio: Option<AudioStream>,
    pub video_stream_count: usize,
    pub audio_stream_count: usize,
    /// true para PNG/JPG/WebP/GIF: son parches, no clips de vídeo.
    pub is_image: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub codec_long: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub pix_fmt: Option<String>,
    /// Rotación según metadatos, normalizada a 0 / 90 / 180 / 270.
    pub rotation: i32,
    pub frame_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub codec: String,
    pub codec_long: String,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub channel_layout: Option<String>,
}

// ---- Salida cruda de `ffprobe -print_format json` ----
// ffprobe devuelve casi todos los números como strings; se parsean después.

#[derive(Deserialize, Default)]
struct FfprobeOutput {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
    #[serde(default)]
    format: FfprobeFormat,
}

#[derive(Deserialize, Default)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
}

#[derive(Deserialize, Default)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    codec_long_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    pix_fmt: Option<String>,
    sample_rate: Option<String>,
    channels: Option<u32>,
    channel_layout: Option<String>,
    nb_frames: Option<String>,
    duration: Option<String>,
    #[serde(default)]
    tags: HashMap<String, Value>,
    #[serde(default)]
    disposition: HashMap<String, Value>,
    #[serde(default)]
    side_data_list: Vec<FfprobeSideData>,
}

#[derive(Deserialize, Default)]
struct FfprobeSideData {
    rotation: Option<Value>,
}

fn value_to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn parse_f64(s: &Option<String>) -> Option<f64> {
    s.as_deref().and_then(|v| v.trim().parse().ok())
}

fn parse_u64(s: &Option<String>) -> Option<u64> {
    parse_f64(s).map(|v| v.round() as u64)
}

/// "30000/1001" -> 29.97. Devuelve None para "0/0" o valores no positivos.
fn parse_ratio(s: &Option<String>) -> Option<f64> {
    let s = s.as_deref()?.trim();
    let (num, den) = match s.split_once('/') {
        Some((n, d)) => (n.parse::<f64>().ok()?, d.parse::<f64>().ok()?),
        None => (s.parse::<f64>().ok()?, 1.0),
    };
    if den == 0.0 || num <= 0.0 {
        None
    } else {
        Some(num / den)
    }
}

/// La rotación puede venir en `side_data_list[].rotation` (ffprobe moderno)
/// o en `tags.rotate` (archivos antiguos). Puede ser negativa (-90).
fn rotation_of(stream: &FfprobeStream) -> i32 {
    let raw = stream
        .side_data_list
        .iter()
        .find_map(|sd| sd.rotation.as_ref())
        .and_then(value_to_f64)
        .or_else(|| stream.tags.get("rotate").and_then(value_to_f64))
        .unwrap_or(0.0);
    (((raw.round() as i32) % 360) + 360) % 360
}

/// Las carátulas embebidas (mp3/m4a) aparecen como stream de vídeo con
/// `attached_pic = 1`; no son vídeo real.
fn is_attached_pic(stream: &FfprobeStream) -> bool {
    stream
        .disposition
        .get("attached_pic")
        .and_then(value_to_f64)
        .map_or(false, |v| v == 1.0)
}

pub async fn ffmpeg_version(app: &AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args(["-version"])
        .output()
        .await
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    // Primera línea: "ffmpeg version 8.1.2 Copyright (c) ..."
    let version = text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(2))
        .unwrap_or("desconocida");
    Ok(version.to_string())
}

pub async fn probe(app: &AppHandle, path: &str) -> Result<MediaInfo, String> {
    let file = Path::new(path);
    if !file.is_file() {
        return Err(format!("No existe el archivo: {path}"));
    }

    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("No se encontró el sidecar ffprobe: {e}"))?
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .await
        .map_err(|e| format!("No se pudo ejecutar ffprobe: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffprobe no pudo leer el archivo".to_string()
        } else {
            stderr
        });
    }

    let raw: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Salida de ffprobe no válida: {e}"))?;

    let video_streams: Vec<&FfprobeStream> = raw
        .streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("video") && !is_attached_pic(s))
        .collect();
    let audio_streams: Vec<&FfprobeStream> = raw
        .streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("audio"))
        .collect();

    let video = video_streams.first().map(|s| VideoStream {
        codec: s.codec_name.clone().unwrap_or_else(|| "?".into()),
        codec_long: s.codec_long_name.clone().unwrap_or_default(),
        width: s.width.unwrap_or(0),
        height: s.height.unwrap_or(0),
        fps: parse_ratio(&s.avg_frame_rate)
            .or_else(|| parse_ratio(&s.r_frame_rate))
            .unwrap_or(0.0),
        pix_fmt: s.pix_fmt.clone(),
        rotation: rotation_of(s),
        frame_count: parse_u64(&s.nb_frames),
    });

    let audio = audio_streams.first().map(|s| AudioStream {
        codec: s.codec_name.clone().unwrap_or_else(|| "?".into()),
        codec_long: s.codec_long_name.clone().unwrap_or_default(),
        sample_rate: parse_f64(&s.sample_rate).map(|v| v as u32),
        channels: s.channels,
        channel_layout: s.channel_layout.clone(),
    });

    // Duración del contenedor; si falta, la mayor de los streams.
    let duration_sec = parse_f64(&raw.format.duration)
        .or_else(|| {
            raw.streams
                .iter()
                .filter_map(|s| parse_f64(&s.duration))
                .fold(None, |acc: Option<f64>, d| Some(acc.map_or(d, |a| a.max(d))))
        })
        .unwrap_or(0.0);

    let size_bytes = parse_u64(&raw.format.size)
        .or_else(|| std::fs::metadata(file).ok().map(|m| m.len()))
        .unwrap_or(0);

    // Una imagen es un contenedor de imagen con un solo frame y sin audio.
    const IMAGE_FORMATS: &[&str] = &[
        "png_pipe", "image2", "jpeg_pipe", "webp_pipe", "webp", "gif", "bmp_pipe", "tiff_pipe",
    ];
    let container = raw.format.format_name.clone().unwrap_or_else(|| "desconocido".into());
    let is_image = audio_streams.is_empty()
        && video_streams.len() == 1
        && container
            .split(',')
            .any(|f| IMAGE_FORMATS.contains(&f.trim()));

    Ok(MediaInfo {
        path: path.to_string(),
        file_name: file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string()),
        container,
        duration_sec,
        size_bytes,
        bit_rate: parse_u64(&raw.format.bit_rate),
        video,
        audio,
        video_stream_count: video_streams.len(),
        audio_stream_count: audio_streams.len(),
        is_image,
    })
}
