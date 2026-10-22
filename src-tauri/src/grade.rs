//! Corrección de color por clip (temperatura, exposición, contraste, luces,
//! sombras, saturación…) horneada en un LUT 3D.
//!
//! La matemática es la de Lumetri en FilmCraft (`crates/render/src/effects.rs`,
//! `fn lumetri`, MIT OR Apache-2.0; ver `vendor/filmcraft`): su camino SDR, sin
//! la parte que depende de la posición del píxel (viñeta, nitidez), que CutVideo
//! ya hace por su cuenta. Como todo lo demás es una función color → color, se
//! puede tabular: el preview (WebGL) y el export (`lut3d` de ffmpeg) aplican la
//! MISMA tabla, así que lo que se ve es lo que sale. Con filtros CSS por un lado
//! y `eq` por el otro solo se parecían.

use filmcraft_color::{linear_to_srgb, srgb_to_linear, Lut3d};
use serde::Deserialize;

/// Lado del cubo. 33 es lo habitual en los .cube de cine: ~36 000 puntos,
/// interpolados después, sin escalones visibles en degradados.
pub const LUT_SIZE: usize = 33;

/// Ajustes en las mismas unidades que los deslizadores de Lumetri.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Grade {
    /// -100..100: frío ↔ cálido.
    pub temperature: f32,
    /// -100..100: verde ↔ magenta.
    pub tint: f32,
    /// Pasos de diafragma, -4..4.
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    /// 0..200, 100 = sin cambio.
    pub saturation: f32,
    /// -100..100: satura más lo que está menos saturado (pieles a salvo).
    pub vibrance: f32,
    /// 0..100: negros levantados y contraste comprimido, como copia de cine.
    pub faded: f32,
    /// Tono de sombras y de luces (RGB 0..1; 0.5 gris = neutro).
    pub shadow_tint: [f32; 3],
    pub highlight_tint: [f32; 3],
}

impl Default for Grade {
    fn default() -> Self {
        Grade {
            temperature: 0.0,
            tint: 0.0,
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            saturation: 100.0,
            vibrance: 0.0,
            faded: 0.0,
            shadow_tint: [0.5; 3],
            highlight_tint: [0.5; 3],
        }
    }
}

const fn luma(v: [f32; 3]) -> f32 {
    0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

impl Grade {
    pub fn is_identity(&self) -> bool {
        *self == Grade::default()
    }

    /// Un color del vídeo (sRGB 0..1) → el color corregido (sRGB 0..1).
    pub fn apply(&self, srgb: [f32; 3]) -> [f32; 3] {
        let temp = self.temperature / 100.0;
        let tint = self.tint / 100.0;
        let exposure = 2f32.powf(self.exposure);
        let contrast = self.contrast / 100.0;
        let (hl, sh) = (self.highlights / 100.0, self.shadows / 100.0);
        let (wh, bl) = (self.whites / 100.0, self.blacks / 100.0);
        let sat = self.saturation / 100.0;
        let vib = self.vibrance / 100.0;
        let faded = self.faded / 100.0;
        let (st, ht) = (self.shadow_tint, self.highlight_tint);
        let gains = [1.0 + 0.35 * temp, 1.0 - 0.3 * tint, 1.0 - 0.35 * temp];

        // Balance de blancos y exposición en luz lineal, como una cámara.
        let lin = srgb.map(srgb_to_linear);
        let lin = [lin[0] * gains[0] * exposure, lin[1] * gains[1] * exposure, lin[2] * gains[2] * exposure];
        let mut v = lin.map(|q| linear_to_srgb(q.max(0.0)));

        // Blancos / negros: mueven los extremos.
        let b0 = -bl * 0.15;
        let w0 = 1.0 - wh * 0.15;
        v = v.map(|q| (q - b0) / (w0 - b0).max(1e-3));

        // Luces / sombras: suben o bajan según la luminancia sin cambiar el tono.
        let l = luma(v);
        let ws = (1.0 - l).clamp(0.0, 1.0).powi(3);
        let whl = l.clamp(0.0, 1.0).powi(3);
        let nl = (l + sh * 0.35 * ws + hl * 0.35 * whl).max(0.0);
        if l > 1e-5 {
            let k = nl / l;
            v = v.map(|q| q * k);
        }

        // Contraste: curva en S suave alrededor del gris medio.
        if contrast.abs() > 1e-4 {
            let k = 1.0 + contrast;
            v = v.map(|q| {
                let q = q.clamp(0.0, 1.0);
                let s = q * q * (3.0 - 2.0 * q);
                if k >= 1.0 { q + (s - q) * (k - 1.0) } else { 0.5 + (q - 0.5) * k }
            });
        }

        if faded > 0.0 {
            v = v.map(|q| q * (1.0 - 0.25 * faded) + 0.12 * faded);
        }

        // Virado partido: un color en las sombras y otro en las luces.
        let l2 = luma(v).clamp(0.0, 1.0);
        for k in 0..3 {
            v[k] += (st[k] - 0.5) * 0.3 * (1.0 - l2) + (ht[k] - 0.5) * 0.3 * l2;
        }

        let l3 = luma(v);
        let cur_sat = v[0].max(v[1]).max(v[2]) - v[0].min(v[1]).min(v[2]);
        let s = sat * (1.0 + vib * (1.0 - cur_sat.clamp(0.0, 1.0)));
        v.map(|q| (l3 + (q - l3) * s).clamp(0.0, 1.0))
    }

    pub fn bake(&self, size: usize) -> Lut3d {
        let mut lut = Lut3d::from_fn(size, |c| self.apply(c));
        lut.title = "CutVideo".into();
        lut
    }
}

/// El cubo en bytes RGB (rojo el que más rápido cambia), para subirlo al
/// shader del preview. Va como binario: en JSON serían ~400 KB por ajuste.
#[tauri::command]
pub fn grade_lut(grade: Grade) -> tauri::ipc::Response {
    let lut = grade.bake(LUT_SIZE);
    let bytes: Vec<u8> = lut
        .data
        .iter()
        .flat_map(|c| c.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8))
        .collect();
    tauri::ipc::Response::new(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_ajustes_no_cambia_nada() {
        let g = Grade::default();
        assert!(g.is_identity());
        for c in [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.2, 0.5, 0.9], [0.73, 0.1, 0.4]] {
            let o = g.apply(c);
            for k in 0..3 {
                assert!((o[k] - c[k]).abs() < 1e-3, "{c:?} → {o:?}");
            }
        }
    }

    #[test]
    fn calido_sube_el_rojo_y_baja_el_azul() {
        let g = Grade { temperature: 50.0, ..Grade::default() };
        let o = g.apply([0.5, 0.5, 0.5]);
        assert!(o[0] > 0.5 && o[2] < 0.5);
    }

    #[test]
    fn saturacion_cero_es_blanco_y_negro() {
        let g = Grade { saturation: 0.0, ..Grade::default() };
        let o = g.apply([0.8, 0.2, 0.1]);
        assert!((o[0] - o[1]).abs() < 1e-4 && (o[1] - o[2]).abs() < 1e-4);
    }

    #[test]
    fn el_cubo_escrito_se_vuelve_a_leer() {
        let g = Grade { exposure: 0.5, contrast: 30.0, ..Grade::default() };
        let cube = g.bake(LUT_SIZE).to_cube();
        let back = Lut3d::parse_cube(&cube).unwrap();
        assert_eq!(back.size, LUT_SIZE);
        let o = back.apply([0.4, 0.4, 0.4]);
        let e = g.apply([0.4, 0.4, 0.4]);
        assert!((o[0] - e[0]).abs() < 1e-2);
    }
}
