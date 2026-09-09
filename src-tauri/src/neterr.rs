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

#[cfg(test)]
mod firma_actualizacion {
    /// La app solo instalará una actualización si la firma del paquete valida
    /// contra la clave pública que lleva dentro. Si ese par no cuadra, el
    /// actualizador rechaza todo en silencio, así que conviene comprobarlo.
    #[test]
    fn el_paquete_publicado_valida_con_la_clave_de_la_app() {
        let (Ok(pkg), Ok(sig), Ok(pubkey)) = (
            std::env::var("CUTVIDEO_UPDATE_PKG"),
            std::env::var("CUTVIDEO_UPDATE_SIG"),
            std::env::var("CUTVIDEO_UPDATE_PUBKEY"),
        ) else {
            eprintln!("saltada: faltan CUTVIDEO_UPDATE_PKG/SIG/PUBKEY");
            return;
        };
        let datos = std::fs::read(&pkg).expect("leer el paquete");
        let firma = minisign_verify::Signature::decode(&std::fs::read_to_string(&sig).unwrap())
            .expect("decodificar la firma");
        let clave = minisign_verify::PublicKey::decode(&std::fs::read_to_string(&pubkey).unwrap())
            .expect("decodificar la clave pública");
        clave
            .verify(&datos, &firma, false)
            .expect("la firma NO valida con la clave que lleva la app");
        println!("FIRMA OK: el paquete lo firmó la clave del autor");
    }
}
