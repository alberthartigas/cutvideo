mod ai;
mod analyze;
mod export;
mod media;
mod music_rights;
mod secrets;
mod transcribe;

use tauri::Manager;

/// Versión del ffmpeg empaquetado como sidecar. Sirve para comprobar desde la
/// UI que el sidecar se resuelve bien en dev y en el bundle.
#[tauri::command]
async fn ffmpeg_version(app: tauri::AppHandle) -> Result<String, String> {
    media::ffmpeg_version(&app).await
}

/// Analiza un archivo con ffprobe y autoriza su ruta en el protocolo `asset://`
/// para que el WebView pueda reproducirlo en el preview.
#[tauri::command]
async fn probe_media(app: tauri::AppHandle, path: String) -> Result<media::MediaInfo, String> {
    let info = media::probe(&app, &path).await?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    Ok(info)
}

/// Rutas pasadas por línea de comandos al arrancar (`cutvideo video.mp4`,
/// o "Abrir con…" en Windows). Solo devuelve las que existen como archivo.
#[tauri::command]
fn startup_files() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(export::ExportState::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg_version,
            probe_media,
            startup_files,
            export::export_video,
            export::cancel_export,
            export::export_overlay_begin,
            export::export_write_frame,
            export::export_overlay_end,
            secrets::secret_set,
            secrets::secret_status,
            secrets::secret_delete,
            transcribe::transcribe,
            analyze::detect_silences,
            analyze::analyze_beats,
            music_rights::check_music_rights,
            music_rights::suggest_free_music,
            ai::ai_edit_plan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
