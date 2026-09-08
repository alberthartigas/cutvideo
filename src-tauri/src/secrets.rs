//! Almacén de secretos: claves de API, licencias y sesiones.
//!
//! Es el único punto de la app que toca secretos. Todo va al llavero del
//! sistema (Keychain en macOS, Credential Manager en Windows, Secret Service en
//! Linux): nunca a archivos del proyecto ni a texto plano. El frontend solo
//! recibe una "pista" (los últimos 4 caracteres); el valor completo se lee
//! desde Rust cuando hay que llamar a un servicio.

use keyring::{Entry, Error as KeyringError};
use serde::Serialize;

/// Nombre del servicio en el llavero. Todas las entradas de QuickCut cuelgan de aquí.
const SERVICE: &str = "com.alberthartigas.quickcut";

/// Tipo de secreto. Cada uno vive en su propio espacio de nombres, así una
/// futura suscripción (token de sesión, licencia) no se mezcla con las claves
/// de API del usuario.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    /// Clave de un proveedor externo (Groq, OpenAI…). `id` = proveedor.
    ApiKey,
    /// Licencia o clave de activación de QuickCut. `id` = producto/plan.
    License,
    /// Token de sesión de la cuenta del usuario. `id` = servicio.
    Session,
}

impl SecretKind {
    fn prefix(self) -> &'static str {
        match self {
            SecretKind::ApiKey => "api",
            SecretKind::License => "license",
            SecretKind::Session => "session",
        }
    }

    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "api" => Ok(SecretKind::ApiKey),
            "license" => Ok(SecretKind::License),
            "session" => Ok(SecretKind::Session),
            other => Err(format!("Tipo de secreto desconocido: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub kind: String,
    pub id: String,
    pub present: bool,
    /// Últimos caracteres del secreto, para que el usuario reconozca cuál guardó.
    pub hint: Option<String>,
}

fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-' | '.'));
    if ok {
        Ok(())
    } else {
        Err(format!("Identificador de secreto no válido: {id:?}"))
    }
}

fn entry(kind: SecretKind, id: &str) -> Result<Entry, String> {
    validate_id(id)?;
    Entry::new(SERVICE, &format!("{}:{}", kind.prefix(), id)).map_err(describe)
}

/// Mensaje legible para el usuario; nunca incluye el valor del secreto.
fn describe(e: KeyringError) -> String {
    match e {
        KeyringError::NoStorageAccess(p) => format!("Sin acceso al llavero del sistema: {p}"),
        KeyringError::PlatformFailure(p) => format!("Error del llavero del sistema: {p}"),
        KeyringError::NoEntry => "No hay ningún secreto guardado".into(),
        other => format!("Error del llavero: {other}"),
    }
}

fn hint_of(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() >= 8 {
        format!("…{}", chars[chars.len() - 4..].iter().collect::<String>())
    } else {
        "••••".into()
    }
}

// ---- API interna (para el resto del backend) ----

pub fn set(kind: SecretKind, id: &str, value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return delete(kind, id);
    }
    entry(kind, id)?.set_password(value).map_err(describe)
}

pub fn get(kind: SecretKind, id: &str) -> Result<Option<String>, String> {
    match entry(kind, id)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(describe(e)),
    }
}

pub fn delete(kind: SecretKind, id: &str) -> Result<(), String> {
    match entry(kind, id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(describe(e)),
    }
}

pub fn status(kind: SecretKind, id: &str) -> Result<SecretStatus, String> {
    let value = get(kind, id)?;
    Ok(SecretStatus {
        kind: kind.prefix().into(),
        id: id.into(),
        present: value.is_some(),
        hint: value.as_deref().map(hint_of),
    })
}

/// Atajo para los proveedores de IA: la clave de API guardada, si la hay.
#[allow(dead_code)]
pub fn api_key(provider: &str) -> Result<Option<String>, String> {
    get(SecretKind::ApiKey, provider)
}

// ---- Comandos expuestos al frontend ----
// Solo guardar, consultar estado y borrar: el WebView nunca puede leer un secreto completo.

#[tauri::command]
pub fn secret_set(kind: String, id: String, value: String) -> Result<SecretStatus, String> {
    let kind = SecretKind::parse(&kind)?;
    set(kind, &id, &value)?;
    status(kind, &id)
}

#[tauri::command]
pub fn secret_status(kind: String, id: String) -> Result<SecretStatus, String> {
    status(SecretKind::parse(&kind)?, &id)
}

#[tauri::command]
pub fn secret_delete(kind: String, id: String) -> Result<(), String> {
    delete(SecretKind::parse(&kind)?, &id)
}
