//! Qué partes de un vídeo merecen entrar en el montaje.
//!
//! La autoedición partía de "lo pongo todo y quito los silencios", que deja el
//! vídeo casi igual de largo y con el mismo ritmo plano. Un montador hace lo
//! contrario: mira el material y se queda con lo bueno.
//!
//! Aquí se saca, segundo a segundo, en qué momentos pasa algo: cuánto suena
//! (que suele marcar dónde se habla o hay acción) y cuánto cambia la imagen
//! (que marca movimiento y cortes de plano). Con eso el frontend puntúa y
//! elige. La decisión de qué es "interesante" no se toma aquí: esto solo mide.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Resolución del análisis. Medio segundo basta para elegir cortes y mantiene
/// el análisis rápido incluso en vídeos largos.
const PASO: f64 = 0.5;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRequest {
    pub path: String,
    /// Tramo a analizar dentro del archivo.
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlights {
    /// Instante de cada muestra, en segundos desde el principio del archivo.
    pub times: Vec<f64>,
    /// Volumen en ese instante, 0–1 (ya normalizado al máximo del clip).
    pub loudness: Vec<f64>,
    /// Cuánto cambia la imagen respecto al instante anterior, 0–1.
    pub motion: Vec<f64>,
    /// Instantes donde cambia el plano.
    pub cuts: Vec<f64>,
}

/// Mide volumen y movimiento a lo largo de un tramo de vídeo.
#[tauri::command]
pub async fn analyze_highlights(
    app: AppHandle,
    request: HighlightRequest,
) -> Result<Highlights, String> {
    let dur = (request.end - request.start).max(0.0);
    if dur < PASO {
        return Err("El tramo es demasiado corto para analizarlo".into());
    }
    // Volumen: se parte el audio en trozos de exactamente PASO segundos
    // (`asetnsamples`) y se mide cada uno. Dejar que astats se reinicie cada N
    // fotogramas de audio no vale: los fotogramas no duran siempre lo mismo y
    // salen cientos de ventanas vacías que se leen como silencio.
    let muestras_por_ventana = (44100.0 * PASO).round() as u32;
    let filtro = format!(
        "[0:a]aresample=44100,asetnsamples=n={muestras_por_ventana}:p=0,\
         astats=metadata=1:reset=1,\
         ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-[a]"
    );
    let args = vec![
        "-v".into(), "error".into(),
        "-ss".into(), format!("{:.3}", request.start),
        "-t".into(), format!("{dur:.3}"),
        "-i".into(), request.path.clone(),
        "-filter_complex".into(), filtro,
        "-map".into(), "[a]".into(),
        "-f".into(), "null".into(), "-".into(),
    ];
    // Un vídeo mudo no es un error: el movimiento por sí solo ya sirve para
    // elegir momentos, así que se sigue con el volumen a cero.
    let rms = ejecutar(&app, args).await.map(|s| parse_rms(&s)).unwrap_or_default();

    // Movimiento: la detección de escena de ffmpeg da un valor por fotograma
    // que sube cuando la imagen cambia mucho.
    let args = vec![
        "-v".into(), "error".into(),
        "-ss".into(), format!("{:.3}", request.start),
        "-t".into(), format!("{dur:.3}"),
        "-i".into(), request.path.clone(),
        "-vf".into(),
        format!("fps=1/{PASO},scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-"),
        "-an".into(), "-f".into(), "null".into(), "-".into(),
    ];
    let escena = parse_scene(&ejecutar(&app, args).await?);

    let muestras = rms.len().max(escena.len());
    if muestras == 0 {
        return Err("No se pudo analizar el vídeo".into());
    }
    let times: Vec<f64> = (0..muestras).map(|i| request.start + i as f64 * PASO).collect();
    Ok(Highlights {
        loudness: normalizar(&rellenar(rms, muestras)),
        motion: normalizar(&rellenar(escena.clone(), muestras)),
        cuts: escena
            .iter()
            .enumerate()
            .filter(|(_, s)| **s > 0.4)
            .map(|(i, _)| request.start + i as f64 * PASO)
            .collect(),
        times,
    })
}

async fn ejecutar(app: &AppHandle, args: Vec<String>) -> Result<String, String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("No se encontró el sidecar ffmpeg: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
    let mut salida = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            // `metadata=print:file=-` escribe por la salida estándar.
            CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => {
                salida.push_str(&String::from_utf8_lossy(&l))
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Ok(salida)
}

/// El RMS viene en dB (negativo, -91 es silencio); se pasa a una escala 0–1.
fn parse_rms(salida: &str) -> Vec<f64> {
    salida
        .lines()
        .filter_map(|l| l.rsplit_once('=').filter(|(k, _)| k.contains("RMS_level")))
        .map(|(_, v)| v.trim().parse::<f64>().unwrap_or(f64::NEG_INFINITY))
        .map(|db| if db.is_finite() { ((db + 60.0) / 60.0).clamp(0.0, 1.0) } else { 0.0 })
        .collect()
}

fn parse_scene(salida: &str) -> Vec<f64> {
    salida
        .lines()
        .filter_map(|l| l.rsplit_once('=').filter(|(k, _)| k.contains("scene_score")))
        .filter_map(|(_, v)| v.trim().parse::<f64>().ok())
        .collect()
}

/// Iguala la longitud de una señal repitiendo el último valor.
fn rellenar(mut v: Vec<f64>, n: usize) -> Vec<f64> {
    let ultimo = v.last().copied().unwrap_or(0.0);
    v.resize(n, ultimo);
    v
}

/// Lleva la señal a 0–1 respecto a su propio máximo: lo que importa es dónde
/// destaca dentro de este clip, no su nivel absoluto.
fn normalizar(v: &[f64]) -> Vec<f64> {
    let max = v.iter().cloned().fold(0.0_f64, f64::max);
    if max <= 0.0 {
        return v.to_vec();
    }
    v.iter().map(|x| (x / max).clamp(0.0, 1.0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_rms_en_db_se_convierte_a_escala_util() {
        let salida = "lavfi.astats.Overall.RMS_level=-91.0\nlavfi.astats.Overall.RMS_level=-30.0\nlavfi.astats.Overall.RMS_level=0.0";
        let v = parse_rms(salida);
        assert_eq!(v.len(), 3);
        assert!(v[0] < 0.01, "el silencio casi no suena: {}", v[0]);
        assert!((v[1] - 0.5).abs() < 0.01, "medio: {}", v[1]);
        assert!((v[2] - 1.0).abs() < 0.01, "máximo: {}", v[2]);
    }

    #[test]
    fn el_silencio_absoluto_no_rompe_la_lectura() {
        // ffmpeg escribe "-inf" cuando la ventana está en silencio total.
        let v = parse_rms("lavfi.astats.Overall.RMS_level=-inf\nlavfi.astats.Overall.RMS_level=-20.0");
        assert_eq!(v.len(), 2, "la ventana muda también cuenta como muestra");
        assert_eq!(v[0], 0.0);
        assert!(v[1] > 0.6);
    }

    #[test]
    fn normalizar_deja_el_pico_en_uno() {
        assert_eq!(normalizar(&[0.1, 0.2, 0.4]), vec![0.25, 0.5, 1.0]);
        // Sin señal no se divide por cero.
        assert_eq!(normalizar(&[0.0, 0.0]), vec![0.0, 0.0]);
    }
}
