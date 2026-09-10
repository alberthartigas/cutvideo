//! Copias ligeras para editar sin tirones.
//!
//! Un vídeo de móvil moderno son 6 megapíxeles de HEVC a 30 Mb/s. El WebView
//! puede reproducir uno, pero el preview hace malabares con varios a la vez —
//! dos en cada transición, más el que precarga— y en cada corte monta y
//! desmonta decodificadores. El resultado va a trompicones.
//!
//! La solución de siempre en montaje: se edita con copias pequeñas y se exporta
//! con los originales. El proxy es H.264 con el lado corto a 540 px, que pesa
//! una fracción y se decodifica sin despeinarse.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Lado corto del proxy. Suficiente para encuadrar y elegir cortes.
const LADO_CORTO: u32 = 540;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proxy {
    /// Ruta del archivo original, que es como lo identifica el frontend.
    pub source: String,
    pub path: String,
}

fn proxies_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo encontrar la carpeta de datos: {e}"))?
        .join("proxies");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Nombre estable a partir de la ruta, el tamaño y la fecha: si el archivo
/// cambia, el proxy se regenera solo en vez de servir uno viejo.
fn nombre_de(path: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(&mut h);
        if let Ok(m) = meta.modified() {
            if let Ok(d) = m.duration_since(std::time::UNIX_EPOCH) {
                d.as_secs().hash(&mut h);
            }
        }
    }
    format!("{:016x}.mp4", h.finish())
}

/// Proxy ya hecho para ese archivo, si existe.
#[tauri::command]
pub fn proxy_for(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let destino = proxies_dir(&app)?.join(nombre_de(&path));
    if destino.is_file() {
        let _ = app.asset_protocol_scope().allow_file(&destino);
        return Ok(Some(destino.to_string_lossy().into_owned()));
    }
    Ok(None)
}

/// Crea el proxy si hace falta y devuelve su ruta. Si ya estaba, no hace nada.
#[tauri::command]
pub async fn make_proxy(app: AppHandle, path: String) -> Result<String, String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(format!("No existe el archivo: {path}"));
    }
    let destino = proxies_dir(&app)?.join(nombre_de(&path));
    if destino.is_file() {
        let _ = app.asset_protocol_scope().allow_file(&destino);
        return Ok(destino.to_string_lossy().into_owned());
    }
    // Se escribe a un temporal y se renombra al final: si la app se cierra a
    // medias, no queda un proxy cortado que parezca bueno.
    let temporal = destino.with_extension("parcial.mp4");
    let escala = format!(
        "scale='if(gt(iw,ih),-2,{LADO_CORTO})':'if(gt(iw,ih),{LADO_CORTO},-2)':flags=fast_bilinear"
    );
    let args = [
        "-v", "error", "-y", "-i", &path,
        "-vf", &escala,
        "-c:v", "h264_videotoolbox", "-b:v", "2500k",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        temporal.to_str().unwrap_or_default(),
    ];
    let (mut rx, _child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;

    let mut stderr = String::new();
    let mut code = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(l) => stderr.push_str(&String::from_utf8_lossy(&l)),
            CommandEvent::Terminated(p) => {
                code = p.code;
                break;
            }
            _ => {}
        }
    }
    if code != Some(0) {
        let _ = std::fs::remove_file(&temporal);
        return Err(format!(
            "No se pudo crear la copia de edición: {}",
            stderr.lines().last().unwrap_or("ffmpeg falló")
        ));
    }
    std::fs::rename(&temporal, &destino).map_err(|e| e.to_string())?;
    let _ = app.asset_protocol_scope().allow_file(&destino);
    let ruta = destino.to_string_lossy().into_owned();
    let _ = app.emit("proxy:ready", Proxy { source: path, path: ruta.clone() });
    Ok(ruta)
}

/// Cuántos fotogramas lleva la tira. Con veinte se recorre un clip de un
/// vistazo sin que el archivo pese.
pub const FOTOGRAMAS_TIRA: u32 = 20;

/// Tira de fotogramas en una sola imagen, para poder recorrer el vídeo pasando
/// el ratón por encima sin decodificar nada en ese momento.
#[tauri::command]
pub async fn make_filmstrip(app: AppHandle, path: String) -> Result<String, String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(format!("No existe el archivo: {path}"));
    }
    let destino = proxies_dir(&app)?.join(format!("tira-{}", nombre_de(&path))).with_extension("jpg");
    if destino.is_file() {
        let _ = app.asset_protocol_scope().allow_file(&destino);
        return Ok(destino.to_string_lossy().into_owned());
    }
    let temporal = destino.with_extension("parcial.jpg");
    // `thumbnail` elige el fotograma más representativo de cada tramo en vez de
    // uno al azar, que a veces cae en un fundido o en un desenfoque.
    let filtro = format!(
        "thumbnail={FOTOGRAMAS_TIRA},scale=160:-2,tile={FOTOGRAMAS_TIRA}x1"
    );
    let args = [
        "-v", "error", "-y", "-i", &path,
        "-vf", &filtro, "-frames:v", "1", "-q:v", "5",
        temporal.to_str().unwrap_or_default(),
    ];
    let (mut rx, _child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
    let mut code = None;
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Terminated(p) = event {
            code = p.code;
            break;
        }
    }
    if code != Some(0) || !temporal.is_file() {
        let _ = std::fs::remove_file(&temporal);
        return Err("No se pudieron sacar las miniaturas".into());
    }
    std::fs::rename(&temporal, &destino).map_err(|e| e.to_string())?;
    let _ = app.asset_protocol_scope().allow_file(&destino);
    Ok(destino.to_string_lossy().into_owned())
}

/// Borra todos los proxies. Se pueden volver a crear cuando haga falta.
#[tauri::command]
pub fn clear_proxies(app: AppHandle) -> Result<u64, String> {
    let dir = proxies_dir(&app)?;
    let mut liberado = 0;
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if let Ok(meta) = entry.metadata() {
            liberado += meta.len();
        }
        let _ = std::fs::remove_file(entry.path());
    }
    Ok(liberado)
}
