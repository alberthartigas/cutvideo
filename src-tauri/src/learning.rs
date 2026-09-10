//! Lo que la autoedición aprende de cómo edita el usuario.
//!
//! No se reentrena ningún modelo: se guarda un perfil pequeño con lo que hace
//! el usuario **después** de que la IA monte el vídeo (qué momentos conserva,
//! qué tamaño acaban teniendo los subtítulos, qué transiciones borra…) y ese
//! resumen se le cuenta a la IA en la siguiente edición. Es aprendizaje en el
//! propio encargo: barato, sin datos fuera de la máquina y reversible desde la
//! propia app («Olvidar lo aprendido»).

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Lo que se mide al exportar: qué propuso la autoedición y con qué se quedó él.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Muestra {
    pub estilo_subtitulo: Option<String>,
    pub subtitulo_font_size: Option<f64>,
    pub subtitulo_y: Option<f64>,
    /// Transiciones que puso la autoedición y las que siguen al exportar.
    #[serde(default)]
    pub transiciones_puestas: Vec<String>,
    #[serde(default)]
    pub transiciones_finales: Vec<String>,
    #[serde(default)]
    pub rotulos_puestos: u32,
    #[serde(default)]
    pub rotulos_conservados: u32,
    #[serde(default)]
    pub musica_puesta: bool,
    #[serde(default)]
    pub musica_conservada: bool,
    #[serde(default)]
    pub momentos_propuestos: u32,
    #[serde(default)]
    pub momentos_conservados: u32,
    /// Duración media de los clips del montaje final.
    pub duracion_clip: Option<f64>,
    pub objetivo_segundos: Option<f64>,
    pub duracion_final: Option<f64>,
}

/// El perfil que se guarda entre sesiones. Todo son medias y recuentos.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Perfil {
    pub version: u32,
    pub ediciones: u32,
    /// Cuántas veces acaba cada estilo de subtítulo en la exportación.
    pub subtitulo_estilos: BTreeMap<String, u32>,
    pub subtitulo_font_size: Option<f64>,
    pub subtitulo_y: Option<f64>,
    /// Por transición: [veces puesta, veces conservada].
    pub transiciones: BTreeMap<String, [u32; 2]>,
    /// [rótulos puestos, rótulos conservados].
    pub rotulos: [u32; 2],
    pub musica: [u32; 2],
    /// [momentos propuestos, momentos conservados].
    pub momentos: [u32; 2],
    pub duracion_clip: Option<f64>,
    /// Cuánto acaba durando el vídeo respecto a lo pedido (1 = clavado).
    pub ajuste_duracion: Option<f64>,
    pub actualizado: i64,
}

/// Media móvil: cada edición pesa lo mismo que las anteriores juntas… hasta
/// cierto punto. Con `n` grande el perfil deja de moverse por una edición rara.
fn promediar(actual: Option<f64>, valor: f64, n: u32) -> Option<f64> {
    let peso = (n.max(1) as f64).min(8.0);
    Some(match actual {
        Some(a) => (a * peso + valor) / (peso + 1.0),
        None => valor,
    })
}

fn porcentaje(a: u32, b: u32) -> Option<f64> {
    (b > 0).then(|| a as f64 / b as f64)
}

impl Perfil {
    pub fn aprender(&mut self, m: &Muestra) {
        let n = self.ediciones;
        if let Some(id) = m.estilo_subtitulo.as_deref().filter(|s| !s.is_empty()) {
            *self.subtitulo_estilos.entry(id.to_string()).or_insert(0) += 1;
        }
        if let Some(v) = m.subtitulo_font_size {
            self.subtitulo_font_size = promediar(self.subtitulo_font_size, v, n);
        }
        if let Some(v) = m.subtitulo_y {
            self.subtitulo_y = promediar(self.subtitulo_y, v, n);
        }
        for id in &m.transiciones_puestas {
            self.transiciones.entry(id.clone()).or_insert([0, 0])[0] += 1;
        }
        for id in &m.transiciones_finales {
            self.transiciones.entry(id.clone()).or_insert([0, 0])[1] += 1;
        }
        self.rotulos[0] += m.rotulos_puestos;
        self.rotulos[1] += m.rotulos_conservados;
        self.musica[0] += u32::from(m.musica_puesta);
        self.musica[1] += u32::from(m.musica_conservada);
        self.momentos[0] += m.momentos_propuestos;
        self.momentos[1] += m.momentos_conservados;
        if let Some(v) = m.duracion_clip.filter(|v| *v > 0.0) {
            self.duracion_clip = promediar(self.duracion_clip, v, n);
        }
        if let (Some(obj), Some(fin)) = (m.objetivo_segundos, m.duracion_final) {
            if obj > 0.0 {
                self.ajuste_duracion = promediar(self.ajuste_duracion, fin / obj, n);
            }
        }
        self.version = 1;
        self.ediciones += 1;
        self.actualizado = chrono_ahora();
    }

    /// El estilo de subtítulo con el que más veces se ha quedado.
    pub fn estilo_favorito(&self) -> Option<&str> {
        self.subtitulo_estilos
            .iter()
            .max_by_key(|(_, n)| **n)
            .map(|(id, _)| id.as_str())
    }

    /// Lo aprendido, en frases que se le pasan a la IA tal cual.
    pub fn resumen(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.ediciones == 0 {
            return out;
        }
        if let Some(id) = self.estilo_favorito() {
            let mut frase = format!("Se queda con los subtítulos en estilo «{id}»");
            if let Some(t) = self.subtitulo_font_size {
                frase.push_str(&format!(", a un {:.1} % de tamaño", t * 100.0));
            }
            if let Some(y) = self.subtitulo_y {
                frase.push_str(&format!(" y a un {:.0} % de altura", y * 100.0));
            }
            frase.push('.');
            out.push(frase);
        }
        if let Some(p) = porcentaje(self.momentos[1], self.momentos[0]) {
            out.push(if p < 0.6 {
                format!(
                    "De los momentos que propones solo se queda con el {:.0} %: sé más selectivo y propón menos, pero mejores.",
                    p * 100.0
                )
            } else {
                format!("Conserva el {:.0} % de los momentos que propones: vas bien encaminado.", p * 100.0)
            });
        }
        if let Some(d) = self.duracion_clip {
            out.push(format!("Los planos le acaban quedando de unos {d:.1} s: elige tramos de ese tamaño."));
        }
        if self.rotulos[0] >= 2 {
            let p = porcentaje(self.rotulos[1], self.rotulos[0]).unwrap_or(0.0);
            out.push(if p < 0.4 {
                "Borra casi todos los rótulos que pones: limítate al título de apertura.".into()
            } else {
                "Conserva los rótulos: puedes poner hasta cuatro, siempre separados de los cortes.".into()
            });
        }
        let (quita, deja): (Vec<_>, Vec<_>) = self
            .transiciones
            .iter()
            .filter(|(_, [puestas, _])| *puestas >= 2)
            .partition(|(_, [puestas, quedan])| (*quedan as f64) < (*puestas as f64) * 0.5);
        if !quita.is_empty() {
            let ids: Vec<&str> = quita.iter().map(|(id, _)| id.as_str()).collect();
            out.push(format!("Suele quitar estas transiciones: {}. Evítalas.", ids.join(", ")));
        }
        if !deja.is_empty() {
            let ids: Vec<&str> = deja.iter().map(|(id, _)| id.as_str()).collect();
            out.push(format!("Le funcionan estas transiciones: {}.", ids.join(", ")));
        }
        if self.musica[0] >= 2 {
            out.push(if self.musica[1] * 2 < self.musica[0] {
                "Suele quitar la música que se pone sola: propón una búsqueda sobria o ninguna.".into()
            } else {
                "Se queda con la música que le pones.".into()
            });
        }
        if let Some(a) = self.ajuste_duracion {
            if !(0.85..=1.15).contains(&a) {
                out.push(format!(
                    "El montaje le acaba quedando al {:.0} % de la duración pedida: {}.",
                    a * 100.0,
                    if a < 1.0 { "no te pases de largo" } else { "puedes ser algo más generoso" }
                ));
            }
        }
        out
    }
}

/// Segundos desde 1970 sin traernos una dependencia de fechas.
fn chrono_ahora() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn archivo(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo encontrar la carpeta de datos: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    Ok(dir.join("aprendizaje.json"))
}

pub fn cargar(app: &AppHandle) -> Perfil {
    archivo(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn guardar(app: &AppHandle, perfil: &Perfil) -> Result<(), String> {
    let path = archivo(app)?;
    let json = serde_json::to_string_pretty(perfil).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("No se pudo guardar {}: {e}", path.display()))
}

/// Lo aprendido, ya masticado para la interfaz y para la autoedición.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aprendido {
    pub ediciones: u32,
    pub frases: Vec<String>,
    pub estilo_subtitulo: Option<String>,
    pub subtitulo_font_size: Option<f64>,
    pub subtitulo_y: Option<f64>,
    pub duracion_clip: Option<f64>,
    /// Si suele conservar los rótulos que se le ponen.
    pub poner_rotulos: bool,
    pub poner_musica: bool,
}

impl From<&Perfil> for Aprendido {
    fn from(p: &Perfil) -> Self {
        Aprendido {
            ediciones: p.ediciones,
            frases: p.resumen(),
            estilo_subtitulo: p.estilo_favorito().map(str::to_string),
            subtitulo_font_size: p.subtitulo_font_size,
            subtitulo_y: p.subtitulo_y,
            duracion_clip: p.duracion_clip,
            // Sin datos suficientes se sigue haciendo lo de siempre.
            poner_rotulos: p.rotulos[0] < 2 || p.rotulos[1] * 5 >= p.rotulos[0] * 2,
            poner_musica: p.musica[0] < 2 || p.musica[1] * 2 >= p.musica[0],
        }
    }
}

#[tauri::command]
pub fn learning_summary(app: AppHandle) -> Aprendido {
    (&cargar(&app)).into()
}

#[tauri::command]
pub fn learning_record(app: AppHandle, muestra: Muestra) -> Result<Aprendido, String> {
    let mut perfil = cargar(&app);
    perfil.aprender(&muestra);
    guardar(&app, &perfil)?;
    Ok((&perfil).into())
}

#[tauri::command]
pub fn learning_forget(app: AppHandle) -> Result<(), String> {
    let path = archivo(&app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("No se pudo borrar {}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn muestra() -> Muestra {
        Muestra {
            estilo_subtitulo: Some("discreto".into()),
            subtitulo_font_size: Some(0.04),
            subtitulo_y: Some(0.86),
            transiciones_puestas: vec!["fade".into(), "zoom".into()],
            transiciones_finales: vec!["fade".into()],
            rotulos_puestos: 3,
            rotulos_conservados: 0,
            musica_puesta: true,
            musica_conservada: false,
            momentos_propuestos: 10,
            momentos_conservados: 4,
            duracion_clip: Some(3.2),
            objetivo_segundos: Some(60.0),
            duracion_final: Some(42.0),
            ..Default::default()
        }
    }

    #[test]
    fn una_edicion_deja_perfil_utilizable() {
        let mut p = Perfil::default();
        p.aprender(&muestra());
        assert_eq!(p.ediciones, 1);
        assert_eq!(p.estilo_favorito(), Some("discreto"));
        assert_eq!(p.subtitulo_font_size, Some(0.04));
        assert_eq!(p.transiciones["zoom"], [1, 0]);
        assert_eq!(p.momentos, [10, 4]);
        assert_eq!(p.ajuste_duracion, Some(0.7));
    }

    #[test]
    fn las_medias_se_mueven_poco_a_poco() {
        let mut p = Perfil::default();
        p.aprender(&muestra());
        let mut otra = muestra();
        otra.subtitulo_font_size = Some(0.08);
        p.aprender(&otra);
        // Segunda edición: la media queda entre las dos, no salta a la última.
        let t = p.subtitulo_font_size.unwrap();
        assert!(t > 0.05 && t < 0.07, "media rara: {t}");
        assert_eq!(p.ediciones, 2);
    }

    #[test]
    fn el_resumen_dice_lo_que_hay_que_cambiar() {
        let mut p = Perfil::default();
        for _ in 0..2 {
            p.aprender(&muestra());
        }
        let frases = p.resumen().join(" | ");
        assert!(frases.contains("«discreto»"), "{frases}");
        assert!(frases.contains("sé más selectivo"), "{frases}");
        assert!(frases.contains("limítate al título"), "{frases}");
        assert!(frases.contains("Suele quitar estas transiciones: zoom"), "{frases}");
        assert!(frases.contains("Le funcionan estas transiciones: fade"), "{frases}");
        assert!(frases.contains("quitar la música"), "{frases}");
        assert!(frases.contains("no te pases de largo"), "{frases}");
    }

    #[test]
    fn sin_ediciones_no_se_le_cuenta_nada_a_la_ia() {
        assert!(Perfil::default().resumen().is_empty());
        let a: Aprendido = (&Perfil::default()).into();
        // Sin datos, la autoedición sigue con sus valores de siempre.
        assert!(a.poner_rotulos && a.poner_musica && a.duracion_clip.is_none());
    }

    #[test]
    fn conservar_lo_puesto_se_nota_en_el_resumen() {
        let mut p = Perfil::default();
        let m = Muestra {
            rotulos_puestos: 3,
            rotulos_conservados: 3,
            musica_puesta: true,
            musica_conservada: true,
            momentos_propuestos: 10,
            momentos_conservados: 9,
            transiciones_puestas: vec!["fade".into()],
            transiciones_finales: vec!["fade".into()],
            ..Default::default()
        };
        p.aprender(&m);
        p.aprender(&m);
        let frases = p.resumen().join(" | ");
        assert!(frases.contains("Conserva el 90 %"), "{frases}");
        assert!(frases.contains("Conserva los rótulos"), "{frases}");
        assert!(frases.contains("Se queda con la música"), "{frases}");
        let a: Aprendido = (&p).into();
        assert!(a.poner_rotulos && a.poner_musica);
    }
}
