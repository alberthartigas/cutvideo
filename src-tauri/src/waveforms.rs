//! Formas de onda para el timeline: los picos del audio, a 50 por segundo,
//! sacados con ffmpeg una sola vez y guardados junto a los proxies.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::proxies::{nombre_de, proxies_dir};

/// Picos por segundo. Con 50, a 100 px por segundo tocan a dos por píxel:
/// suficiente para ver dónde se habla y dónde no, y ocupa poquísimo.
pub const PICOS_POR_SEGUNDO: u32 = 50;
/// Frecuencia a la que se decodifica el audio (mono). No hace falta más para picos.
const FRECUENCIA: u32 = 8000;

/// Reduce PCM de 16 bits mono a un pico (0–255) por cada `por_pico` muestras.
pub fn picos_de_pcm(pcm: &[u8], por_pico: usize) -> Vec<u8> {
    let por_pico = por_pico.max(1);
    let mut out = Vec::with_capacity(pcm.len() / 2 / por_pico + 1);
    let mut max = 0i32;
    let mut n = 0usize;
    for m in pcm.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])) {
        max = max.max((m as i32).abs());
        n += 1;
        if n == por_pico {
            out.push((max * 255 / 32767).min(255) as u8);
            max = 0;
            n = 0;
        }
    }
    if n > 0 {
        out.push((max * 255 / 32767).min(255) as u8);
    }
    out
}

/// Devuelve los picos del audio de un archivo (vídeo o audio), calculándolos si hace falta.
#[tauri::command]
pub async fn make_waveform(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    if !Path::new(&path).is_file() {
        return Err(format!("No existe el archivo: {path}"));
    }
    let destino = proxies_dir(&app)?.join(format!("onda-{}.bin", nombre_de(&path)));
    if let Ok(picos) = std::fs::read(&destino) {
        return Ok(picos);
    }
    let temporal = destino.with_extension("pcm");
    let frecuencia = FRECUENCIA.to_string();
    let args = [
        "-v", "error", "-y", "-i", &path,
        "-vn", "-ac", "1", "-ar", &frecuencia, "-f", "s16le",
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
    let pcm = std::fs::read(&temporal);
    let _ = std::fs::remove_file(&temporal);
    if code != Some(0) {
        return Err("No se pudo leer el audio para la forma de onda".into());
    }
    let pcm = pcm.map_err(|e| e.to_string())?;
    let picos = picos_de_pcm(&pcm, (FRECUENCIA / PICOS_POR_SEGUNDO) as usize);
    let _ = std::fs::write(&destino, &picos);
    Ok(picos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cada_pico_es_el_maximo_absoluto_de_su_tramo() {
        let muestras: Vec<i16> = vec![0, 100, -32767, 5, 0, 0, 0, 0, 16384];
        let pcm: Vec<u8> = muestras.iter().flat_map(|m| m.to_le_bytes()).collect();
        assert_eq!(picos_de_pcm(&pcm, 4), vec![255, 0, 127]);
    }

    #[test]
    fn sin_audio_no_hay_picos() {
        assert!(picos_de_pcm(&[], 160).is_empty());
    }
}
