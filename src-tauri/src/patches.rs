//! Biblioteca de parches del usuario: imágenes y stickers que se copian a los
//! datos de la app para tenerlos disponibles en todos los proyectos.
//!
//! Se copian (no se referencian) a propósito: así un parche sigue estando
//! aunque muevas o borres el archivo original.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Extensiones que el WebView sabe pintar directamente.
const ALLOWED_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tiff", "heic"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchAsset {
    /// Nombre del archivo dentro de la biblioteca; sirve de identificador.
    pub id: String,
    /// Nombre legible, sin la extensión.
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

fn patches_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo encontrar la carpeta de datos: {e}"))?
        .join("patches");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    Ok(dir)
}

fn ext_of(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    ALLOWED_EXT.contains(&ext.as_str()).then_some(ext)
}

/// Autoriza la ruta en `asset://` para que el WebView pueda mostrarla.
fn allow(app: &AppHandle, path: &Path) {
    let _ = app.asset_protocol_scope().allow_file(path);
}

fn asset_of(app: &AppHandle, path: &Path) -> Option<PatchAsset> {
    let id = path.file_name()?.to_string_lossy().into_owned();
    let name = path.file_stem()?.to_string_lossy().into_owned();
    let size_bytes = std::fs::metadata(path).ok()?.len();
    allow(app, path);
    Some(PatchAsset { id, name, path: path.to_string_lossy().into_owned(), size_bytes })
}

/// Parches guardados, por orden alfabético.
#[tauri::command]
pub fn list_patches(app: AppHandle) -> Result<Vec<PatchAsset>, String> {
    let dir = patches_dir(&app)?;
    let mut out: Vec<PatchAsset> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && ext_of(p).is_some())
        .filter_map(|p| asset_of(&app, &p))
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Copia una imagen a la biblioteca. Si ya hay una con ese nombre, la numera.
#[tauri::command]
pub fn import_patch(app: AppHandle, path: String) -> Result<PatchAsset, String> {
    let source = Path::new(&path);
    if !source.is_file() {
        return Err(format!("No existe el archivo: {path}"));
    }
    let ext = ext_of(source)
        .ok_or("Ese formato no se puede usar como parche. Usa PNG, JPG, WebP, GIF o SVG.")?;
    // 40 MB de sobra para cualquier sticker; evita copiar un archivo enorme por error.
    const MAX: u64 = 40 * 1024 * 1024;
    let size = std::fs::metadata(source).map_err(|e| e.to_string())?.len();
    if size > MAX {
        return Err("La imagen pesa más de 40 MB.".into());
    }

    let dir = patches_dir(&app)?;
    let stem: String = source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "parche".into())
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_') { c } else { '_' })
        .take(60)
        .collect();
    let stem = if stem.trim().is_empty() { "parche".to_string() } else { stem.trim().to_string() };

    let mut dest = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{stem} {n}.{ext}"));
        n += 1;
    }
    std::fs::copy(source, &dest).map_err(|e| format!("No se pudo copiar: {e}"))?;
    asset_of(&app, &dest).ok_or_else(|| "No se pudo leer el parche copiado".into())
}

/// Quita un parche de la biblioteca. No toca el archivo original del usuario.
#[tauri::command]
pub fn delete_patch(app: AppHandle, id: String) -> Result<(), String> {
    // El id es solo un nombre de archivo: nada de rutas ni "..".
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("Identificador de parche no válido: {id:?}"));
    }
    let path = patches_dir(&app)?.join(&id);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| format!("No se pudo borrar: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_accepts_image_extensions() {
        assert_eq!(ext_of(Path::new("a/b/sticker.PNG")).as_deref(), Some("png"));
        assert_eq!(ext_of(Path::new("x.webp")).as_deref(), Some("webp"));
        assert_eq!(ext_of(Path::new("x.svg")).as_deref(), Some("svg"));
        assert_eq!(ext_of(Path::new("video.mp4")), None);
        assert_eq!(ext_of(Path::new("sin-extension")), None);
    }
}
