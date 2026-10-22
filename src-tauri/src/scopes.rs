//! Scopes de vídeo (forma de onda, parade RGB y vectorscopio) del fotograma
//! que hay bajo el playhead, con el crate `scopes` de FilmCraft (ver
//! `vendor/filmcraft`).
//!
//! El frontend manda el fotograma ya reducido (como mucho 480×270, lo mismo
//! que muestrea FilmCraft) y sin corregir: la corrección de color se aplica
//! aquí con `Grade::apply`, la misma función que hornea el LUT, para que el
//! scope mida lo que va a salir y no lo que había en la cámara.

use crate::grade::Grade;
use filmcraft_scopes::{paint, parade, vectorscope_yuv, waveform, ParadeType, Params, Signal, WaveformType};
use tauri::ipc::{InvokeBody, Request, Response};

/// Pinta un scope y lo devuelve como `[ancho u32 LE, alto u32 LE, RGBA…]`.
pub fn render(kind: &str, w: usize, h: usize, rgba: &[u8], grade: Option<&Grade>) -> Result<(usize, usize, Vec<u8>), String> {
    if w == 0 || h == 0 || w > 4096 || h > 4096 || rgba.len() < w * h * 4 {
        return Err("Fotograma con tamaño no válido".into());
    }
    let mut signal = Signal::from_rgba8(w, h, rgba);
    if let Some(g) = grade.filter(|g| !g.is_identity()) {
        signal = signal.map(|c| g.apply(c));
    }
    let p = Params::default();
    // Brillo del trazo: el valor por defecto del panel de FilmCraft.
    const GAIN: f32 = 1.0;
    Ok(match kind {
        "waveform" => {
            let wf = waveform(&signal, WaveformType::Luma, &p);
            let r = paint::waveform_reference(wf.per_column);
            paint::grids(&[(&wf.traces[0], [0.55, 1.0, 0.6])], r, GAIN)
        }
        "parade" => {
            let wf = parade(&signal, ParadeType::Rgb, &p);
            let r = paint::waveform_reference(wf.per_column);
            // Las tres trazas van una al lado de la otra, como en cualquier parade.
            let cols = [[1.0, 0.3, 0.3], [0.3, 1.0, 0.35], [0.35, 0.5, 1.0]];
            let partes: Vec<_> = wf.traces.iter().zip(cols).map(|(t, c)| paint::grids(&[(t, c)], r, GAIN)).collect();
            let (tw, th) = (partes[0].0, partes[0].1);
            let mut out = vec![0u8; tw * 3 * th * 4];
            for (k, (_, _, px)) in partes.iter().enumerate() {
                for y in 0..th {
                    let dst = (y * tw * 3 + k * tw) * 4;
                    out[dst..dst + tw * 4].copy_from_slice(&px[y * tw * 4..(y + 1) * tw * 4]);
                }
            }
            (tw * 3, th, out)
        }
        "vectorscope" => paint::vectorscope(&vectorscope_yuv(&signal, &p), [0.6, 1.0, 0.6], GAIN, true),
        _ => return Err(format!("Scope desconocido: {kind}")),
    })
}

/// Cuerpo: el fotograma RGBA8. Cabeceras: `x-kind`, `x-width`, `x-height` y,
/// si el clip lleva corrección de color, `x-grade` (JSON).
#[tauri::command]
pub fn video_scope(request: Request<'_>) -> Result<Response, String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let num = |name: &str| header(name).and_then(|v| v.parse::<usize>().ok()).ok_or_else(|| format!("Falta la cabecera {name}"));
    let (w, h) = (num("x-width")?, num("x-height")?);
    let kind = header("x-kind").unwrap_or("waveform");
    let grade: Option<Grade> = match header("x-grade") {
        Some(j) => Some(serde_json::from_str(j).map_err(|e| format!("Corrección de color no válida: {e}"))?),
        None => None,
    };
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("El fotograma tiene que ir como binario".into());
    };
    let (ow, oh, px) = render(kind, w, h, bytes, grade.as_ref())?;
    let mut out = Vec::with_capacity(8 + px.len());
    out.extend_from_slice(&(ow as u32).to_le_bytes());
    out.extend_from_slice(&(oh as u32).to_le_bytes());
    out.extend_from_slice(&px);
    Ok(Response::new(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un fotograma gris medio liso: toda la forma de onda en una fila.
    fn gris(w: usize, h: usize, v: u8) -> Vec<u8> {
        [v, v, v, 255].repeat(w * h)
    }

    fn filas_con_trazo(px: &[u8], w: usize, h: usize) -> Vec<usize> {
        (0..h).filter(|y| (0..w).any(|x| px[(y * w + x) * 4 + 3] > 0)).collect()
    }

    #[test]
    fn un_gris_liso_es_una_raya_en_la_forma_de_onda() {
        let (w, h, px) = render("waveform", 64, 36, &gris(64, 36, 128), None).unwrap();
        assert_eq!((w, h), (64, 256));
        // Fila 0 arriba = blanco; el gris 128 cae en la fila 255-128.
        assert_eq!(filas_con_trazo(&px, w, h), vec![127]);
    }

    #[test]
    fn la_correccion_de_color_mueve_el_trazo() {
        let g = Grade { exposure: 1.0, ..Grade::default() };
        let (w, h, px) = render("waveform", 64, 36, &gris(64, 36, 128), Some(&g)).unwrap();
        let filas = filas_con_trazo(&px, w, h);
        assert!(filas[0] < 127, "con +1 de exposición el gris debería subir: {filas:?}");
    }

    #[test]
    fn el_parade_pone_tres_trazas_y_el_vectorscopio_es_cuadrado() {
        let (w, _, _) = render("parade", 64, 36, &gris(64, 36, 90), None).unwrap();
        assert_eq!(w, 64 * 3);
        let (w, h, px) = render("vectorscope", 64, 36, &gris(64, 36, 90), None).unwrap();
        assert_eq!(w, h);
        // Un gris no tiene color: todo el trazo en el centro.
        let c = (h / 2 * w + w / 2) * 4;
        assert!(px[c + 3] > 0);
    }

    #[test]
    fn rechaza_tamanos_imposibles() {
        assert!(render("waveform", 10, 10, &[0; 4], None).is_err());
        assert!(render("otro", 1, 1, &[0; 4], None).is_err());
    }
}
