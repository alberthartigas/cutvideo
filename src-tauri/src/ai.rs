//! Plan de edición con IA: pide a Claude títulos, momentos destacados y estilo,
//! a partir de la transcripción y los datos del proyecto. La clave de API sale
//! del llavero y nunca llega al frontend.

use crate::secrets;
use serde::{Deserialize, Serialize};

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL: &str = "claude-opus-5";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Servicios de IA para el plan de edición. Los dos primeros tienen plan gratuito.
struct Provider {
    id: &'static str,
    name: &'static str,
    /// Clave guardada en el llavero (Groq comparte la de los subtítulos).
    secret: &'static str,
    url: &'static str,
    model: &'static str,
}

const PROVIDERS: &[Provider] = &[
    Provider {
        id: "groq",
        name: "Groq",
        secret: "groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: "llama-3.3-70b-versatile",
    },
    Provider {
        id: "gemini",
        name: "Google Gemini",
        secret: "gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        model: "gemini-2.5-flash",
    },
    Provider {
        id: "openai",
        name: "OpenAI",
        secret: "openai",
        url: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
    },
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPlanRequest {
    /// Transcripción del vídeo (puede ir vacía).
    pub transcript: String,
    pub duration: f64,
    pub clip_count: usize,
    /// Tempo detectado en la música, si hay.
    pub bpm: Option<f64>,
    /// Estilo pedido por el usuario ("dinámico", "tutorial", "vlog"…).
    pub style: String,
    /// Idioma de los textos ("es", "en"…).
    pub language: String,
    /// "groq" (gratis), "gemini" (gratis), "openai" o "anthropic".
    #[serde(default = "default_provider")]
    pub provider: String,
}

fn default_provider() -> String {
    "groq".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    /// Instante del vídeo (s) donde aparece el texto.
    pub time: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPlan {
    /// Título de apertura.
    pub title: String,
    /// Preset de animación de texto para el título (id de TITLE_PRESETS).
    pub title_preset: String,
    /// Frases destacadas a lo largo del vídeo.
    pub highlights: Vec<Highlight>,
    /// Id del estilo de subtítulo recomendado.
    pub subtitle_style: String,
    /// Id de la transición recomendada.
    pub transition: String,
    /// Búsqueda sugerida para música libre de derechos.
    pub music_query: String,
    /// Una frase explicando el criterio, para enseñarla en la UI.
    pub reasoning: String,
}

#[derive(Deserialize)]
struct ApiResponse {
    #[serde(default)]
    content: Vec<ApiBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ApiBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(default)]
    message: Option<String>,
}

fn schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "titlePreset", "highlights", "subtitleStyle", "transition", "musicQuery", "reasoning"],
        "properties": {
            "title": { "type": "string", "description": "Título de apertura, máximo 6 palabras" },
            "titlePreset": {
                "type": "string",
                "enum": ["pop", "bounce", "typewriter", "zoom", "rise", "slide", "wave", "glitch", "neon", "spin", "elastic", "elegant", "flash", "shake", "pulse", "sweep", "banner"]
            },
            "highlights": {
                "type": "array",
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["time", "text"],
                    "properties": {
                        "time": { "type": "number", "description": "Segundos desde el inicio" },
                        "text": { "type": "string", "description": "Frase corta, máximo 5 palabras" }
                    }
                }
            },
            "subtitleStyle": {
                "type": "string",
                "enum": ["classic", "karaoke", "wordbox", "wordpop", "wordbounce", "oneword", "box", "readable", "neon", "typewriter", "minimal", "elegant"]
            },
            "transition": {
                "type": "string",
                "enum": ["fade", "dissolve", "fadeblack", "flash", "slideleft", "slideup", "smooth", "wipe", "zoom", "blur", "circle", "pixel", "squeeze"]
            },
            "musicQuery": { "type": "string", "description": "Búsqueda en inglés para música libre que pegue con el vídeo" },
            "reasoning": { "type": "string", "description": "Una frase explicando las decisiones" }
        }
    })
}

/// Instrucciones comunes para cualquier proveedor.
fn build_prompt(request: &EditPlanRequest, transcript: &str) -> String {
    format!(
        "Eres el asistente de edición de CutVideo, un editor de vídeo. Propón un plan de edición para este proyecto.\n\n\
         Duración: {:.1} s\nClips: {}\nTempo de la música: {}\nEstilo pedido: {}\nIdioma de los textos: {}\n\n\
         Transcripción del audio:\n{}\n\n\
         Los textos deben estar en el idioma indicado, ser cortos (caben en pantalla) y no repetir literalmente los \
         subtítulos. Los momentos destacados deben caer dentro de la duración del vídeo y repartirse a lo largo de él. \
         Si no hay transcripción, propón textos genéricos que encajen con el estilo.",
        request.duration,
        request.clip_count,
        request.bpm.map(|b| format!("{b:.0} BPM")).unwrap_or_else(|| "sin música".into()),
        request.style,
        request.language,
        if transcript.trim().is_empty() { "(sin transcripción)" } else { transcript.trim() },
    )
}

/// Recorta la transcripción: con el principio y el final basta para decidir.
fn trim_transcript(text: &str) -> String {
    if text.chars().count() <= 6000 {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    format!(
        "{}\n[…]\n{}",
        chars[..3000].iter().collect::<String>(),
        chars[chars.len() - 3000..].iter().collect::<String>()
    )
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

fn friendly_error(name: &str, status: u16, detail: String) -> String {
    match status {
        401 | 403 => format!("{name} ha rechazado la clave de API. Revísala en Ajustes."),
        404 => format!("{name}: el modelo configurado ya no existe. {detail}"),
        429 => format!("{name}: límite de uso alcanzado. Espera un momento o prueba con otro servicio."),
        _ => format!("{name} respondió {status}: {detail}"),
    }
}

/// Extrae el primer objeto JSON de un texto (los modelos a veces lo envuelven).
fn extract_json(text: &str) -> Option<EditPlan> {
    if let Ok(plan) = serde_json::from_str::<EditPlan>(text) {
        return Some(plan);
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    serde_json::from_str::<EditPlan>(&text[start..=end]).ok()
}

// ---- Servicios con API compatible con OpenAI (Groq, Gemini, OpenAI) ----

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
    #[serde(default)]
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatMessage {
    #[serde(default)]
    content: Option<String>,
}

async fn plan_openai_compatible(p: &Provider, key: &str, prompt: &str) -> Result<EditPlan, String> {
    let body = serde_json::json!({
        "model": p.model,
        "temperature": 0.7,
        // Modo JSON: el modelo devuelve un objeto y no hace falta rescatarlo del texto.
        "response_format": { "type": "json_object" },
        "messages": [
            {
                "role": "system",
                "content": format!(
                    "Devuelve SOLO un objeto JSON con este esquema, sin texto alrededor:\n{}",
                    serde_json::to_string_pretty(&schema()).unwrap_or_default()
                )
            },
            { "role": "user", "content": prompt }
        ]
    });
    let response = http_client()?
        .post(p.url)
        .bearer_auth(key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con {}: {e}", p.name))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    let parsed: ChatResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Respuesta no válida de {} ({}): {e}", p.name, status.as_u16()))?;
    if !status.is_success() {
        let detail = parsed
            .error
            .and_then(|e| e.message)
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(friendly_error(p.name, status.as_u16(), detail));
    }
    let content = parsed
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .unwrap_or_default();
    extract_json(&content).ok_or_else(|| format!("{} no devolvió un plan utilizable.", p.name))
}

// ---- Anthropic (API propia, de pago) ----

async fn plan_anthropic(key: &str, prompt: &str) -> Result<EditPlan, String> {
    let body = serde_json::json!({
        "model": ANTHROPIC_MODEL,
        "max_tokens": 4000,
        "output_config": { "effort": "low" },
        "tools": [{
            "name": "propose_edit",
            "description": "Propone el plan de edición para el vídeo.",
            "input_schema": schema(),
            "strict": true
        }],
        "messages": [{
            "role": "user",
            "content": format!("{prompt}\n\nDevuelve el plan llamando a la herramienta `propose_edit`.")
        }]
    });
    let response = http_client()?
        .post(ANTHROPIC_URL)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con la API de Claude: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    let parsed: ApiResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Respuesta no válida de la API ({}): {e}", status.as_u16()))?;
    if !status.is_success() {
        let detail = parsed
            .error
            .and_then(|e| e.message)
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(friendly_error("Claude", status.as_u16(), detail));
    }
    if parsed.stop_reason.as_deref() == Some("refusal") {
        return Err("Claude ha declinado responder a esta petición.".into());
    }
    if let Some(input) = parsed
        .content
        .iter()
        .find(|b| b.kind == "tool_use" && b.name.as_deref() == Some("propose_edit"))
        .and_then(|b| b.input.clone())
    {
        return serde_json::from_value(input).map_err(|e| format!("Plan incompleto: {e}"));
    }
    let joined: String = parsed
        .content
        .iter()
        .filter(|b| b.kind == "text")
        .filter_map(|b| b.text.clone())
        .collect::<Vec<_>>()
        .join("\n");
    extract_json(&joined).ok_or_else(|| "Claude no devolvió un plan utilizable.".to_string())
}

/// Pide el plan de edición al servicio elegido.
#[tauri::command]
pub async fn ai_edit_plan(request: EditPlanRequest) -> Result<EditPlan, String> {
    let transcript = trim_transcript(&request.transcript);
    let prompt = build_prompt(&request, &transcript);

    if request.provider == "anthropic" {
        let key = secrets::api_key("anthropic")?
            .ok_or("Falta la clave de API de Anthropic. Añádela en Ajustes → Claves de API.")?;
        return plan_anthropic(&key, &prompt).await;
    }
    let p = PROVIDERS
        .iter()
        .find(|p| p.id == request.provider)
        .ok_or_else(|| format!("Servicio de IA desconocido: {}", request.provider))?;
    let key = secrets::api_key(p.secret)?.ok_or_else(|| {
        format!("Falta la clave de API de {}. Añádela en Ajustes → Claves de API.", p.name)
    })?;
    plan_openai_compatible(p, &key, &prompt).await
}
