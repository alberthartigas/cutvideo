//! Errores de red legibles.
//!
//! `reqwest::Error` por sí solo dice «error sending request for url (…)», que no
//! sirve para nada: no distingue un DNS que no resuelve de un certificado
//! rechazado o de un permiso de macOS que bloquea la conexión. Aquí se recorre
//! la cadena de causas y se traduce lo habitual.

use std::error::Error;

/// Describe un fallo de red con su causa real y, si se reconoce, una pista.
pub fn describe(context: &str, e: &(dyn Error + 'static)) -> String {
    let mut causas: Vec<String> = Vec::new();
    let mut actual: Option<&(dyn Error + 'static)> = Some(e);
    while let Some(err) = actual {
        let texto = err.to_string();
        if !causas.contains(&texto) {
            causas.push(texto);
        }
        actual = err.source();
    }
    let cadena = causas.join(" → ");
    let bajo = cadena.to_lowercase();

    let pista = if bajo.contains("dns") || bajo.contains("name resolution") || bajo.contains("nodename") {
        Some("No se pudo resolver el nombre del servidor: comprueba la conexión o el DNS.")
    } else if bajo.contains("certificate") || bajo.contains("tls") || bajo.contains("handshake") {
        Some("Falló el cifrado de la conexión. Suele ser un proxy o un antivirus que se mete en medio.")
    } else if bajo.contains("operation not permitted") || bajo.contains("permission denied") {
        Some("El sistema bloqueó la conexión. En macOS, revisa que la app tenga permiso de red.")
    } else if bajo.contains("timed out") || bajo.contains("timeout") {
        Some("El servidor tardó demasiado en responder.")
    } else if bajo.contains("connection refused") || bajo.contains("connect") {
        Some("No se pudo abrir la conexión.")
    } else {
        None
    };

    match pista {
        Some(p) => format!("{context}: {cadena}. {p}"),
        None => format!("{context}: {cadena}"),
    }
}
