//! Comprobación de derechos de la música y sugerencias de alternativas libres.
//!
//! Se hace por capas, de más a menos fiable, y siempre se dice al usuario en qué
//! se basa el veredicto:
//!   1. Huella acústica (AcoustID) — identifica la grabación aunque no tenga tags.
//!      Necesita `fpcalc` (brew install chromaprint) y una clave de AcoustID.
//!   2. Metadatos del archivo (ISRC, artista/título, campo copyright).
//!   3. MusicBrainz: confirma si ese artista/título es una grabación publicada.
//! Esto es una ayuda, no un dictamen legal: se avisa explícitamente en la UI.

use crate::secrets;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

const USER_AGENT: &str = "CutVideo/0.1 (editor de vídeo de escritorio)";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    /// Grabación comercial identificada: no la subas sin licencia.
    Copyrighted,
    /// Indicios de obra registrada, sin confirmación.
    Risky,
    /// Sin indicios; probablemente propia o libre (no es garantía).
    Unknown,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub isrc: Option<String>,
    pub copyright: Option<String>,
    pub publisher: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeTrack {
    pub title: String,
    pub creator: String,
    pub license: String,
    pub url: String,
    pub duration: Option<f64>,
    pub audio_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RightsReport {
    pub verdict: Verdict,
    /// 0–1: cómo de seguros estamos del veredicto.
    pub confidence: f64,
    pub tags: TrackTags,
    /// Qué comprobaciones se han hecho y qué han dado.
    pub findings: Vec<String>,
    /// Qué le falta a la comprobación (p. ej. sin fpcalc no hay huella acústica).
    pub limitations: Vec<String>,
    /// Si se identificó la grabación, cómo se llama.
    pub identified_as: Option<String>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    #[serde(default)]
    tags: HashMap<String, String>,
}

#[derive(Deserialize)]
struct FfprobeOut {
    #[serde(default)]
    format: Option<FfprobeFormat>,
    #[serde(default)]
    streams: Vec<FfprobeFormat>,
}

/// Busca una etiqueta sin distinguir mayúsculas (los contenedores las escriben de mil formas).
fn tag(tags: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    for (k, v) in tags {
        let lower = k.to_ascii_lowercase();
        if keys.iter().any(|want| lower == *want || lower.ends_with(&format!(":{want}"))) {
            let v = v.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

async fn read_tags(app: &AppHandle, path: &str) -> Result<TrackTags, String> {
    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("No se encontró el sidecar ffprobe: {e}"))?
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
        .output()
        .await
        .map_err(|e| format!("No se pudo ejecutar ffprobe: {e}"))?;
    let raw: FfprobeOut =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("Salida de ffprobe no válida: {e}"))?;
    let mut all: HashMap<String, String> = HashMap::new();
    if let Some(f) = raw.format {
        all.extend(f.tags);
    }
    for s in raw.streams {
        for (k, v) in s.tags {
            all.entry(k).or_insert(v);
        }
    }
    Ok(TrackTags {
        title: tag(&all, &["title"]),
        artist: tag(&all, &["artist", "album_artist", "performer"]),
        album: tag(&all, &["album"]),
        isrc: tag(&all, &["isrc", "tsrc"]),
        copyright: tag(&all, &["copyright"]),
        publisher: tag(&all, &["publisher", "label", "organization"]),
    })
}

/// ¿Existe esa grabación en MusicBrainz? Señal de que es una obra publicada.
async fn musicbrainz_lookup(artist: &str, title: &str) -> Result<Option<String>, String> {
    let query = format!("recording:\"{title}\" AND artist:\"{artist}\"");
    let url = format!(
        "https://musicbrainz.org/ws/2/recording?query={}&limit=1&fmt=json",
        urlencoding(&query)
    );
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| crate::neterr::describe("No se pudo consultar el servicio", &e))?;
    if !response.status().is_success() {
        return Err(format!("MusicBrainz respondió {}", response.status().as_u16()));
    }
    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let best = body.get("recordings").and_then(|r| r.get(0));
    let Some(rec) = best else { return Ok(None) };
    // El campo `score` (0–100) dice cómo de buena es la coincidencia.
    let score = rec.get("score").and_then(|s| s.as_i64()).unwrap_or(0);
    if score < 85 {
        return Ok(None);
    }
    let name = rec.get("title").and_then(|t| t.as_str()).unwrap_or(title);
    let by = rec
        .get("artist-credit")
        .and_then(|a| a.get(0))
        .and_then(|a| a.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or(artist);
    Ok(Some(format!("{by} — {name}")))
}

/// Huella acústica con Chromaprint + AcoustID. Solo si el usuario tiene `fpcalc` y clave.
async fn acoustid_lookup(path: &str) -> Result<Option<String>, String> {
    let key = secrets::api_key("acoustid")?.ok_or("sin clave")?;
    let out = std::process::Command::new("fpcalc")
        .args(["-json", path])
        .output()
        .map_err(|e| format!("fpcalc no disponible: {e}"))?;
    if !out.status.success() {
        return Err("fpcalc falló".into());
    }
    let fp: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let (Some(fingerprint), Some(duration)) = (
        fp.get("fingerprint").and_then(|f| f.as_str()),
        fp.get("duration").and_then(|d| d.as_f64()),
    ) else {
        return Err("fpcalc devolvió algo inesperado".into());
    };
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "https://api.acoustid.org/v2/lookup?client={}&meta=recordings&duration={}&fingerprint={}",
        urlencoding(&key),
        duration.round() as i64,
        urlencoding(fingerprint)
    );
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| crate::neterr::describe("No se pudo consultar el servicio", &e))?;
    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let rec = body
        .get("results")
        .and_then(|r| r.get(0))
        .and_then(|r| r.get("recordings"))
        .and_then(|r| r.get(0));
    let Some(rec) = rec else { return Ok(None) };
    let title = rec.get("title").and_then(|t| t.as_str()).unwrap_or("?");
    let artist = rec
        .get("artists")
        .and_then(|a| a.get(0))
        .and_then(|a| a.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("?");
    Ok(Some(format!("{artist} — {title}")))
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            b' ' => "+".to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// Comprueba si la música puede dar problemas de copyright.
#[tauri::command]
pub async fn check_music_rights(app: AppHandle, path: String) -> Result<RightsReport, String> {
    if !Path::new(&path).is_file() {
        return Err(format!("No existe el archivo: {path}"));
    }
    let tags = read_tags(&app, &path).await?;
    let mut findings = Vec::new();
    let mut limitations = Vec::new();
    let mut verdict = Verdict::Unknown;
    let mut confidence: f64 = 0.3;
    let mut identified_as = None;

    // 1) Huella acústica: lo más fiable, si está disponible.
    match acoustid_lookup(&path).await {
        Ok(Some(name)) => {
            findings.push(format!("Huella acústica: identificada como «{name}» (AcoustID)."));
            identified_as = Some(name);
            verdict = Verdict::Copyrighted;
            confidence = 0.95;
        }
        Ok(None) => {
            findings.push("Huella acústica: no coincide con ninguna grabación registrada.".into());
            confidence = 0.6;
        }
        Err(e) => limitations.push(if e.contains("sin clave") {
            "Sin huella acústica: falta la clave de AcoustID (Ajustes → Claves de API).".into()
        } else if e.contains("fpcalc") {
            "Sin huella acústica: instala Chromaprint (`brew install chromaprint`) para identificar la pista aunque no tenga metadatos.".into()
        } else {
            format!("Huella acústica no disponible: {e}")
        }),
    }

    // 2) Metadatos del archivo.
    if let Some(isrc) = &tags.isrc {
        findings.push(format!("Tiene código ISRC ({isrc}): es una grabación registrada comercialmente."));
        if verdict != Verdict::Copyrighted {
            verdict = Verdict::Copyrighted;
            confidence = confidence.max(0.9);
        }
    }
    if let Some(c) = &tags.copyright {
        let free = c.to_lowercase().contains("creative commons") || c.to_lowercase().contains("cc-") || c.to_lowercase().contains("public domain");
        findings.push(format!("Campo copyright: «{c}»."));
        if !free && verdict == Verdict::Unknown {
            verdict = Verdict::Risky;
            confidence = confidence.max(0.7);
        }
    }

    // 3) MusicBrainz con artista + título.
    if verdict != Verdict::Copyrighted {
        if let (Some(artist), Some(title)) = (&tags.artist, &tags.title) {
            match musicbrainz_lookup(artist, title).await {
                Ok(Some(name)) => {
                    findings.push(format!("MusicBrainz: coincide con la grabación publicada «{name}»."));
                    identified_as = Some(name);
                    verdict = Verdict::Copyrighted;
                    confidence = confidence.max(0.85);
                }
                Ok(None) => findings.push("MusicBrainz: no hay ninguna grabación publicada con ese artista y título.".into()),
                Err(e) => limitations.push(format!("No se pudo consultar MusicBrainz: {e}")),
            }
        } else {
            findings.push("El archivo no lleva artista y título en los metadatos.".into());
        }
    }

    if verdict == Verdict::Unknown && identified_as.is_none() {
        limitations.push(
            "Sin identificación positiva no se puede garantizar que esté libre de derechos: comprueba de dónde salió la pista."
                .into(),
        );
    }
    Ok(RightsReport { verdict, confidence, tags, findings, limitations, identified_as })
}

/// Busca música con licencia abierta en Openverse (catálogo público, sin clave).
#[tauri::command]
pub async fn suggest_free_music(query: String) -> Result<Vec<FreeTrack>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "https://api.openverse.org/v1/audio/?q={}&license_type=commercial%2Cmodification&page_size=12",
        urlencoding(&query)
    );
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| crate::neterr::describe("No se pudo consultar Openverse", &e))?;
    if !response.status().is_success() {
        return Err(format!("Openverse respondió {}", response.status().as_u16()));
    }
    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let items = body.get("results").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    Ok(items
        .iter()
        .map(|t| FreeTrack {
            title: t.get("title").and_then(|v| v.as_str()).unwrap_or("Sin título").to_string(),
            creator: t.get("creator").and_then(|v| v.as_str()).unwrap_or("Desconocido").to_string(),
            license: format!(
                "{} {}",
                t.get("license").and_then(|v| v.as_str()).unwrap_or("?").to_uppercase(),
                t.get("license_version").and_then(|v| v.as_str()).unwrap_or("")
            )
            .trim()
            .to_string(),
            url: t.get("foreign_landing_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            // Openverse da la duración en milisegundos.
            duration: t.get("duration").and_then(|v| v.as_f64()).map(|ms| ms / 1000.0),
            audio_url: t.get("url").and_then(|v| v.as_str()).map(String::from),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_tags_case_insensitively() {
        let mut tags = HashMap::new();
        tags.insert("TITLE".to_string(), "Mi canción".to_string());
        tags.insert("com.apple.iTunes:ISRC".to_string(), "ESA011234567".to_string());
        tags.insert("empty".to_string(), "  ".to_string());
        assert_eq!(tag(&tags, &["title"]).as_deref(), Some("Mi canción"));
        assert_eq!(tag(&tags, &["isrc", "tsrc"]).as_deref(), Some("ESA011234567"));
        assert_eq!(tag(&tags, &["empty"]), None);
        assert_eq!(tag(&tags, &["artist"]), None);
    }

    #[test]
    fn encodes_query_strings() {
        assert_eq!(urlencoding("a b&c"), "a+b%26c");
        assert_eq!(urlencoding("recording:\"Hey\""), "recording%3A%22Hey%22");
    }
}

/// Descarga una pista sugerida a `~/Música/CutVideo/` y devuelve su ruta,
/// para poder escucharla y usarla sin salir de la app.
#[tauri::command]
pub async fn download_track(app: AppHandle, url: String, name: String) -> Result<String, String> {
    // La URL viene de una API externa: solo https y nada de rutas locales.
    if !url.starts_with("https://") {
        return Err("Solo se descargan enlaces https".into());
    }
    let dir = app
        .path()
        .audio_dir()
        .map_err(|e| format!("No se encontró la carpeta de música: {e}"))?
        .join("CutVideo");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| crate::neterr::describe("No se pudo descargar", &e))?;
    if !response.status().is_success() {
        return Err(format!("La descarga respondió {}", response.status().as_u16()));
    }
    // La extensión sale del tipo de contenido; si no, mp3.
    let ext = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .and_then(|ct| match ct.split(';').next()?.trim() {
            "audio/mpeg" | "audio/mp3" => Some("mp3"),
            "audio/ogg" | "application/ogg" => Some("ogg"),
            "audio/wav" | "audio/x-wav" => Some("wav"),
            "audio/flac" | "audio/x-flac" => Some("flac"),
            "audio/mp4" | "audio/x-m4a" => Some("m4a"),
            _ => None,
        })
        .unwrap_or("mp3");
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    const MAX: usize = 80 * 1024 * 1024;
    if bytes.len() > MAX {
        return Err("La pista pesa más de 80 MB; descárgala desde su página".into());
    }

    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_') { c } else { '_' })
        .take(60)
        .collect();
    let stem = safe.trim().to_string();
    let stem = if stem.is_empty() { "pista".to_string() } else { stem };
    let mut path = dir.join(format!("{stem}.{ext}"));
    // Si ya existe, numeramos en vez de sobrescribir.
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} {n}.{ext}"));
        n += 1;
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("No se pudo guardar: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}
