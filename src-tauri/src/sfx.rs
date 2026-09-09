//! Efectos de sonido que vienen con la app.
//!
//! Están sintetizados a propósito (ver `scripts/gen-sfx.sh`): así no arrastran
//! licencias de terceros y se pueden distribuir con el editor sin condiciones.
//! Se empaquetan como recursos, no dentro del binario, porque ffmpeg necesita
//! una ruta real en disco para poder mezclarlos al exportar.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundAsset {
    /// Nombre del archivo sin extensión; sirve de identificador.
    pub id: String,
    /// Nombre para enseñar, ya en castellano.
    pub name: String,
    /// Categoría a la que pertenece (transiciones, golpes…).
    pub category: String,
    pub path: String,
}

/// Cada efecto con su categoría y su nombre, en el orden en que se enseñan.
/// Lo que no esté aquí se ignora, para que un archivo suelto no aparezca sin
/// nombre en la interfaz.
const CATALOGO: &[(&str, &str, &str)] = &[
    ("whoosh-corto", "Whoosh corto", "Transiciones"),
    ("whoosh-largo", "Whoosh largo", "Transiciones"),
    ("whoosh-reverso", "Whoosh al revés", "Transiciones"),
    ("swish", "Swish", "Transiciones"),
    ("barrido", "Barrido", "Transiciones"),
    ("impacto", "Impacto", "Golpes"),
    ("impacto-seco", "Impacto seco", "Golpes"),
    ("subgrave", "Subgrave", "Golpes"),
    ("tambor", "Tambor", "Golpes"),
    ("platillo", "Platillo", "Golpes"),
    ("riser", "Riser", "Tensión"),
    ("riser-ruido", "Riser de ruido", "Tensión"),
    ("latido", "Latido", "Tensión"),
    ("cuenta-atras", "Cuenta atrás", "Tensión"),
    ("glitch", "Glitch", "Tensión"),
    ("pop", "Pop", "Interfaz"),
    ("click", "Clic", "Interfaz"),
    ("burbuja", "Burbuja", "Interfaz"),
    ("teclado", "Tecla", "Interfaz"),
    ("camara", "Cámara", "Interfaz"),
    ("campana", "Campana", "Avisos"),
    ("cristal", "Cristal", "Avisos"),
    ("exito", "Acierto", "Avisos"),
    ("error", "Error", "Avisos"),
    ("moneda", "Moneda", "Avisos"),
];

fn sfx_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("No se pudo encontrar la carpeta de recursos: {e}"))?
        .join("resources")
        .join("sfx");
    if dir.is_dir() {
        return Ok(dir);
    }
    // En `tauri dev` los recursos aún no están copiados al bundle.
    let suelto = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sfx");
    if suelto.is_dir() {
        return Ok(suelto);
    }
    Err(format!("No están los efectos de sonido en {}", dir.display()))
}

/// Efectos que trae la app, agrupados por categoría.
#[tauri::command]
pub fn builtin_sfx(app: AppHandle) -> Result<Vec<SoundAsset>, String> {
    let dir = sfx_dir(&app)?;
    let scope = app.asset_protocol_scope();
    Ok(CATALOGO
        .iter()
        .filter_map(|(id, name, category)| {
            let path = dir.join(format!("{id}.mp3"));
            if !path.is_file() {
                return None;
            }
            // Para poder escucharlos en el panel antes de usarlos.
            let _ = scope.allow_file(&path);
            Some(SoundAsset {
                id: (*id).to_string(),
                name: (*name).to_string(),
                category: (*category).to_string(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect())
}
