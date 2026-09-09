//! Plan de edición con IA: pide a Claude títulos, momentos destacados y estilo,
//! a partir de la transcripción y los datos del proyecto. La clave de API sale
//! del llavero y nunca llega al frontend.

use crate::secrets;
use serde::{Deserialize, Serialize};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5";
const ANTHROPIC_VERSION: &str = "2023-06-01";

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

/// Pide a Claude un plan de edición. Requiere la clave de Anthropic en Ajustes.
#[tauri::command]
pub async fn ai_edit_plan(request: EditPlanRequest) -> Result<EditPlan, String> {
    let key = secrets::api_key("anthropic")?
        .ok_or("Falta la clave de API de Anthropic. Añádela en Ajustes → Claves de API.")?;

    // La transcripción puede ser muy larga: con el principio y el final basta para decidir.
    let transcript = if request.transcript.chars().count() > 6000 {
        let chars: Vec<char> = request.transcript.chars().collect();
        format!(
            "{}\n[…]\n{}",
            chars[..3000].iter().collect::<String>(),
            chars[chars.len() - 3000..].iter().collect::<String>()
        )
    } else {
        request.transcript.clone()
    };

    let prompt = format!(
        "Eres el asistente de edición de CutVideo, un editor de vídeo. Propón un plan de edición para este proyecto.\n\n\
         Duración: {:.1} s\nClips: {}\nTempo de la música: {}\nEstilo pedido: {}\nIdioma de los textos: {}\n\n\
         Transcripción del audio:\n{}\n\n\
         Devuelve el plan llamando a la herramienta `propose_edit`. Los textos deben estar en el idioma indicado, \
         ser cortos (caben en pantalla) y no repetir literalmente los subtítulos. Los momentos destacados deben \
         caer dentro de la duración del vídeo y repartirse a lo largo de él. Si no hay transcripción, propón \
         textos genéricos que encajen con el estilo.",
        request.duration,
        request.clip_count,
        request.bpm.map(|b| format!("{b:.0} BPM")).unwrap_or_else(|| "sin música".into()),
        request.style,
        request.language,
        if transcript.trim().is_empty() { "(sin transcripción)" } else { transcript.trim() },
    );

    let body = serde_json::json!({
        "model": MODEL,
        "max_tokens": 4000,
        "output_config": { "effort": "low" },
        "tools": [{
            "name": "propose_edit",
            "description": "Propone el plan de edición para el vídeo.",
            "input_schema": schema(),
            "strict": true
        }],
        "messages": [{ "role": "user", "content": prompt }]
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(API_URL)
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
            .unwrap_or_else(|| text.chars().take(300).collect());
        return Err(match status.as_u16() {
            401 => "Claude ha rechazado la clave de API. Revísala en Ajustes.".into(),
            429 => "Límite de uso de la API de Claude alcanzado. Inténtalo en un momento.".into(),
            _ => format!("La API de Claude respondió {}: {detail}", status.as_u16()),
        });
    }
    if parsed.stop_reason.as_deref() == Some("refusal") {
        return Err("Claude ha declinado responder a esta petición.".into());
    }

    // Lo normal: un bloque tool_use con el plan. Si respondió en texto, buscamos el JSON.
    if let Some(input) = parsed
        .content
        .iter()
        .find(|b| b.kind == "tool_use" && b.name.as_deref() == Some("propose_edit"))
        .and_then(|b| b.input.clone())
    {
        return serde_json::from_value(input).map_err(|e| format!("Plan incompleto: {e}"));
    }
    let text_blocks: String = parsed
        .content
        .iter()
        .filter(|b| b.kind == "text")
        .filter_map(|b| b.text.clone())
        .collect::<Vec<_>>()
        .join("\n");
    let start = text_blocks.find('{');
    let end = text_blocks.rfind('}');
    if let (Some(s), Some(e)) = (start, end) {
        if let Ok(plan) = serde_json::from_str::<EditPlan>(&text_blocks[s..=e]) {
            return Ok(plan);
        }
    }
    Err("Claude no devolvió un plan utilizable.".into())
}
