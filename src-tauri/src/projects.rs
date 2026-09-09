//! Proyectos guardados en disco: uno por carpeta dentro de los datos de la app.
//!
//!   <datos de la app>/projects/<id>/project.json   estado del timeline
//!                                  /thumb.jpg      miniatura del primer clip
//!
//! Los vídeos originales NO se copian: el proyecto solo guarda sus rutas. Por eso
//! borrar un proyecto libera poco espacio y nunca toca los archivos del usuario.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    /// Milisegundos desde epoch.
    pub created_at: f64,
    pub modified_at: f64,
    /// Lo que ocupa la carpeta del proyecto (json + miniatura).
    pub size_bytes: u64,
    pub clip_count: usize,
    pub duration_sec: f64,
    /// Miniatura en `data:` para pintarla sin permisos de archivo.
    pub thumbnail: Option<String>,
    /// Archivos referenciados que ya no existen en disco.
    pub missing_media: usize,
}

/// Lo que guarda el frontend. `data` es opaco para Rust: el timeline entero.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created_at: f64,
    pub modified_at: f64,
    #[serde(default)]
    pub clip_count: usize,
    #[serde(default)]
    pub duration_sec: f64,
    /// Rutas de los medios, para poder avisar si falta alguno sin abrir el proyecto.
    #[serde(default)]
    pub media_paths: Vec<String>,
    pub data: serde_json::Value,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo encontrar la carpeta de datos: {e}"))?
        .join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Solo aceptamos ids que hemos generado nosotros: nada de "..", "/" ni rutas.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn project_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Identificador de proyecto no válido: {id:?}"));
    }
    Ok(projects_dir(app)?.join(id))
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .filter_map(|e| e.ok())
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

fn read_project(dir: &Path) -> Option<ProjectFile> {
    let raw = std::fs::read(dir.join("project.json")).ok()?;
    serde_json::from_slice(&raw).ok()
}

fn read_thumbnail(dir: &Path) -> Option<String> {
    let bytes = std::fs::read(dir.join("thumb.jpg")).ok()?;
    // Un data: URL evita tener que autorizar la ruta en el protocolo asset://.
    Some(format!("data:image/jpeg;base64,{}", base64(&bytes)))
}

/// Base64 estándar. Son unos pocos KB por miniatura, no merece otra dependencia.
fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Proyectos guardados, del más reciente al más antiguo.
#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let dir = projects_dir(&app)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(file) = read_project(&path) else { continue };
        let missing = file
            .media_paths
            .iter()
            .filter(|p| !Path::new(p).is_file())
            .count();
        out.push(ProjectSummary {
            id: file.id,
            name: file.name,
            created_at: file.created_at,
            modified_at: file.modified_at,
            size_bytes: dir_size(&path),
            clip_count: file.clip_count,
            duration_sec: file.duration_sec,
            thumbnail: read_thumbnail(&path),
            missing_media: missing,
        });
    }
    out.sort_by(|a, b| b.modified_at.total_cmp(&a.modified_at));
    Ok(out)
}

#[tauri::command]
pub fn load_project(app: AppHandle, id: String) -> Result<ProjectFile, String> {
    let dir = project_dir(&app, &id)?;
    read_project(&dir).ok_or_else(|| format!("No se pudo leer el proyecto {id}"))
}

/// Guarda (o crea) un proyecto. `thumbnail` es un data URL JPEG, opcional.
#[tauri::command]
pub fn save_project(
    app: AppHandle,
    mut file: ProjectFile,
    thumbnail: Option<String>,
) -> Result<ProjectSummary, String> {
    let dir = project_dir(&app, &file.id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    file.modified_at = now_ms();
    if file.created_at <= 0.0 {
        file.created_at = file.modified_at;
    }
    let json = serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?;
    // Escritura atómica: si algo falla a medias, el proyecto anterior sigue intacto.
    let tmp = dir.join("project.json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("No se pudo guardar: {e}"))?;
    std::fs::rename(&tmp, dir.join("project.json")).map_err(|e| format!("No se pudo guardar: {e}"))?;

    if let Some(data_url) = thumbnail.as_deref().and_then(|t| t.split(",").nth(1)) {
        if let Some(bytes) = decode_base64(data_url) {
            let _ = std::fs::write(dir.join("thumb.jpg"), bytes);
        }
    }
    let missing = file.media_paths.iter().filter(|p| !Path::new(p).is_file()).count();
    Ok(ProjectSummary {
        id: file.id,
        name: file.name,
        created_at: file.created_at,
        modified_at: file.modified_at,
        size_bytes: dir_size(&dir),
        clip_count: file.clip_count,
        duration_sec: file.duration_sec,
        thumbnail: read_thumbnail(&dir),
        missing_media: missing,
    })
}

fn decode_base64(s: &str) -> Option<Vec<u8>> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut idx = [255u8; 256];
    for (i, c) in T.iter().enumerate() {
        idx[*c as usize] = i as u8;
    }
    let clean: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace() && *b != b'=').collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut n = 0u32;
        for (i, b) in chunk.iter().enumerate() {
            let v = idx[*b as usize];
            if v == 255 {
                return None;
            }
            n |= (v as u32) << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// Borra un proyecto. No toca los vídeos originales, solo la carpeta del proyecto.
#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    let dir = project_dir(&app, &id)?;
    if !dir.is_dir() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("No se pudo borrar el proyecto: {e}"))
}

/// Ruta y tamaño de la carpeta de proyectos, para enseñarlos en la pantalla de inicio.
#[tauri::command]
pub fn projects_storage(app: AppHandle) -> Result<(String, u64), String> {
    let dir = projects_dir(&app)?;
    let size = dir_size(&dir);
    Ok((dir.to_string_lossy().into_owned(), size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_ids_that_escape_the_folder() {
        assert!(valid_id("a1b2-c3d4"));
        assert!(!valid_id("../otro"));
        assert!(!valid_id("con/barra"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"x".repeat(65)));
    }

    #[test]
    fn base64_roundtrip() {
        for case in [&b""[..], b"a", b"ab", b"abc", b"abcd", b"\x00\xff\x10hola"] {
            let encoded = base64(case);
            assert_eq!(decode_base64(&encoded).as_deref(), Some(case), "{encoded}");
        }
        // Y coincide con lo que produciría cualquier codificador estándar.
        assert_eq!(base64(b"hola"), "aG9sYQ==");
        assert_eq!(decode_base64("aG9sYQ=="), Some(b"hola".to_vec()));
    }
}
