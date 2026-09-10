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
    /// Modelo por defecto. Puede quedarse obsoleto: los servicios retiran
    /// modelos cada pocos meses, así que antes de usarlo se comprueba contra
    /// la lista real del servicio (ver `resolve_model`).
    model: &'static str,
    /// Modelos preferidos, del mejor al más básico, si el de arriba ya no está.
    fallbacks: &'static [&'static str],
}

const PROVIDERS: &[Provider] = &[
    Provider {
        id: "groq",
        name: "Groq",
        secret: "groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: "llama-3.3-70b-versatile",
        fallbacks: &[
            "moonshotai/kimi-k2-instruct",
            "openai/gpt-oss-120b",
            "qwen/qwen3-32b",
            "llama-3.1-8b-instant",
        ],
    },
    Provider {
        id: "gemini",
        name: "Google Gemini",
        secret: "gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        model: "gemini-2.5-flash",
        fallbacks: &["gemini-2.5-flash-lite", "gemini-2.0-flash"],
    },
    Provider {
        // Ollama expone una API compatible con OpenAI en el propio ordenador.
        // No lleva clave: si no está abierto, el error lo dice claro.
        id: "ollama",
        name: "Ollama (local)",
        secret: "",
        url: "http://localhost:11434/v1/chat/completions",
        model: "qwen2.5:7b-instruct",
        fallbacks: &[
            "qwen2.5:14b-instruct",
            "llama3.1:8b",
            "llama3.2:3b",
            "mistral:7b",
            "gemma2:9b",
            "phi3.5",
        ],
    },
    Provider {
        id: "openai",
        name: "OpenAI",
        secret: "openai",
        url: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        fallbacks: &["gpt-4.1-mini", "gpt-4o"],
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
    /// El material entero, clip a clip, para que elija con contexto.
    #[serde(default)]
    pub material: Vec<MaterialClip>,
    /// A cuántos segundos hay que dejar el vídeo.
    #[serde(default)]
    pub target_seconds: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialClip {
    pub index: usize,
    pub name: String,
    pub duration: f64,
    pub recorded_at: Option<String>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    #[serde(rename = "in")]
    pub in_sec: f64,
    pub out: f64,
    pub score: f64,
    pub words: String,
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
pub struct Pick {
    pub clip: usize,
    #[serde(rename = "in")]
    pub in_sec: f64,
    pub out: f64,
    #[serde(default)]
    pub why: String,
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
    /// Momentos elegidos del material (índice de clip y tramo dentro del archivo).
    #[serde(default)]
    pub picks: Vec<Pick>,
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
        "required": ["title", "titlePreset", "highlights", "subtitleStyle", "transition", "musicQuery", "reasoning", "picks"],
        "properties": {
            "title": { "type": "string", "description": "Título de apertura, máximo 6 palabras" },
            "titlePreset": {
                "type": "string",
                "enum": ["pop", "bounce", "typewriter", "zoom", "rise", "slide", "wave", "glitch", "neon", "spin", "elastic", "elegant", "flash", "shake", "pulse", "sweep", "banner"]
            },
            "highlights": {
                "type": "array",
                "maxItems": 4,
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
                "enum": ["discreto", "viral", "hormozi", "golpe", "beast", "oneword", "sube", "karaoke", "neon", "classic", "box", "readable", "typewriter", "minimal", "elegant"]
            },
            "transition": {
                "type": "string",
                "enum": ["fade", "dissolve", "fadeblack", "flash", "slideleft", "slideup", "smooth", "wipe", "zoom", "blur", "circle", "pixel", "squeeze"]
            },
            "picks": {
                "type": "array",
                "maxItems": 24,
                "description": "Momentos del material que entran en el montaje, en orden cronológico",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["clip", "in", "out", "why"],
                    "properties": {
                        "clip": { "type": "integer", "description": "Índice del clip en el material" },
                        "in": { "type": "number", "description": "Segundo de entrada dentro del archivo" },
                        "out": { "type": "number", "description": "Segundo de salida dentro del archivo" },
                        "why": { "type": "string", "description": "Por qué entra, en pocas palabras" }
                    }
                }
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
         {material}\
         Los textos deben estar en el idioma indicado, ser cortos (caben en pantalla) y no repetir literalmente los \
         subtítulos. Pocos rótulos (máximo 4), separados entre sí y nunca justo en un cambio de plano. \
         El estilo de subtítulo por defecto es \"discreto\"; solo propón otro si el estilo pedido es muy enérgico. \
         Si no hay transcripción, propón textos genéricos que encajen con el estilo.",
        request.duration,
        request.clip_count,
        request.bpm.map(|b| format!("{b:.0} BPM")).unwrap_or_else(|| "sin música".into()),
        request.style,
        request.language,
        if transcript.trim().is_empty() { "(sin transcripción)" } else { transcript.trim() },
        material = describe_material(request),
    )
}

/// Lo que se ha aprendido viendo cómo remata él los montajes.
fn aprendido_texto(frases: &[String]) -> String {
    if frases.is_empty() {
        return String::new();
    }
    format!(
        "\n\nLO QUE HAS APRENDIDO DE ESTE USUARIO EN MONTAJES ANTERIORES (respétalo salvo que el estilo pedido diga otra cosa):\n- {}",
        frases.join("\n- ")
    )
}

/// El material clip a clip, para que la IA elija los momentos con contexto.
fn describe_material(request: &EditPlanRequest) -> String {
    if request.material.is_empty() {
        return String::new();
    }
    let objetivo = request
        .target_seconds
        .map(|t| format!("{t:.0} s"))
        .unwrap_or_else(|| "lo que pida el estilo".into());
    let mut out = format!(
        "MATERIAL DISPONIBLE (elige los momentos que entran, en `picks`, hasta sumar unos {objetivo}; \
         manténlos en orden cronológico salvo que el estilo pida otra cosa; cada tramo entre 2 y 5 s; \
         busca el patrón de lo que se cuenta y quédate con lo que lo sostiene, no solo con lo más ruidoso):\n"
    );
    for m in &request.material {
        out.push_str(&format!(
            "- Clip {} «{}», {:.1} s{}\n",
            m.index,
            m.name,
            m.duration,
            m.recorded_at.as_deref().map(|d| format!(", grabado {d}")).unwrap_or_default()
        ));
        for c in &m.candidates {
            out.push_str(&format!(
                "    · {:.1}–{:.1} s (interés {:.2}){}\n",
                c.in_sec,
                c.out,
                c.score,
                if c.words.trim().is_empty() { String::new() } else { format!(": \"{}\"", c.words.trim()) }
            ));
        }
    }
    out.push('\n');
    out
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

/// Modelos ya resueltos en esta sesión, para no preguntar en cada edición.
static MODELOS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, String>>> =
    std::sync::OnceLock::new();

/// Modelos que el servicio ofrece pero no sirven para escribir un plan.
fn es_de_texto(id: &str) -> bool {
    const FUERA: &[&str] = &[
        "whisper", "tts", "embed", "guard", "vision", "image", "audio", "moderation", "rerank",
        "dall-e", "sora", "veo", "imagen", "transcribe", "realtime", "search",
    ];
    let bajo = id.to_lowercase();
    !FUERA.iter().any(|f| bajo.contains(f))
}

/// Elige un modelo que exista de verdad.
///
/// Los servicios retiran modelos cada pocos meses y la app se queda con un
/// nombre muerto: eso es lo que pasó con `llama-3.3-70b-versatile`. En vez de
/// cambiar un nombre fijo por otro que caducará igual, se pregunta al servicio
/// qué tiene y se coge el primero de la lista de preferencias que siga vivo.
async fn resolve_model(p: &Provider, key: &str) -> String {
    let cache = MODELOS.get_or_init(Default::default);
    if let Some(m) = cache.lock().unwrap().get(p.id) {
        return m.clone();
    }
    let elegido = modelo_disponible(p, key).await.unwrap_or_else(|| p.model.to_string());
    cache.lock().unwrap().insert(p.id.to_string(), elegido.clone());
    elegido
}

async fn modelo_disponible(p: &Provider, key: &str) -> Option<String> {
    let url = format!("{}/models", p.url.strip_suffix("/chat/completions")?);
    let response = http_client().ok()?.get(url).bearer_auth(key).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let cuerpo: serde_json::Value = response.json().await.ok()?;
    let disponibles: Vec<String> = cuerpo
        .get("data")?
        .as_array()?
        .iter()
        .filter_map(|m| m.get("id")?.as_str().map(str::to_string))
        .collect();
    if disponibles.is_empty() {
        return None;
    }
    // Primero lo que hayamos elegido a mano, y si nada de eso está, cualquier
    // modelo de texto: mejor uno que no conocemos que un error.
    std::iter::once(p.model)
        .chain(p.fallbacks.iter().copied())
        .find(|m| disponibles.iter().any(|d| d == m))
        .map(str::to_string)
        .or_else(|| disponibles.into_iter().find(|d| es_de_texto(d)))
}

async fn plan_openai_compatible(p: &Provider, key: &str, prompt: &str) -> Result<EditPlan, String> {
    let modelo = resolve_model(p, key).await;
    let body = serde_json::json!({
        "model": modelo,
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
        .map_err(|e| {
            if p.secret.is_empty() {
                format!(
                    "No se ha podido hablar con Ollama en tu ordenador ({e}). Abre la app de Ollama y \
                     descarga un modelo con `ollama pull qwen2.5:7b-instruct`."
                )
            } else {
                format!("No se pudo conectar con {}: {e}", p.name)
            }
        })?;
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
pub async fn ai_edit_plan(app: tauri::AppHandle, request: EditPlanRequest) -> Result<EditPlan, String> {
    let transcript = trim_transcript(&request.transcript);
    // Lo aprendido de ediciones anteriores va en el propio encargo: es lo que
    // hace que cada montaje se parezca más a como edita él.
    let aprendido = crate::learning::cargar(&app).resumen();
    let prompt = format!("{}{}", build_prompt(&request, &transcript), aprendido_texto(&aprendido));

    if request.provider == "anthropic" {
        let key = secrets::api_key("anthropic")?
            .ok_or("Falta la clave de API de Anthropic. Añádela en Ajustes → Claves de API.")?;
        return plan_anthropic(&key, &prompt).await;
    }
    let p = PROVIDERS
        .iter()
        .find(|p| p.id == request.provider)
        .ok_or_else(|| format!("Servicio de IA desconocido: {}", request.provider))?;
    let key = if p.secret.is_empty() {
        // Local: no hay clave que pedir, pero la cabecera va igual (se ignora).
        "local".to_string()
    } else {
        secrets::api_key(p.secret)?.ok_or_else(|| {
            format!("Falta la clave de API de {}. Añádela en Ajustes → Claves de API.", p.name)
        })?
    };
    plan_openai_compatible(p, &key, &prompt).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peticion() -> EditPlanRequest {
        EditPlanRequest {
            transcript: "hola".into(),
            duration: 30.0,
            clip_count: 2,
            bpm: None,
            style: "viaje".into(),
            language: "es".into(),
            provider: "groq".into(),
            material: vec![
                MaterialClip {
                    index: 0,
                    name: "playa.mov".into(),
                    duration: 12.0,
                    recorded_at: Some("2026-08-01T10:00:00Z".into()),
                    candidates: vec![Candidate { in_sec: 1.0, out: 4.0, score: 0.91, words: "qué bonito".into() }],
                },
                MaterialClip { index: 1, name: "cena.mov".into(), duration: 18.0, recorded_at: None, candidates: vec![] },
            ],
            target_seconds: Some(20.0),
        }
    }

    #[test]
    fn el_prompt_describe_cada_clip_con_sus_tramos() {
        let texto = build_prompt(&peticion(), "hola");
        assert!(texto.contains("Clip 0 «playa.mov», 12.0 s, grabado 2026-08-01T10:00:00Z"));
        assert!(texto.contains("1.0–4.0 s (interés 0.91): \"qué bonito\""));
        assert!(texto.contains("Clip 1 «cena.mov», 18.0 s\n"));
        assert!(texto.contains("unos 20 s"));
    }

    #[test]
    fn el_proveedor_local_no_lleva_clave_y_apunta_al_propio_ordenador() {
        let p = PROVIDERS.iter().find(|p| p.id == "ollama").expect("falta Ollama");
        assert!(p.secret.is_empty());
        assert!(p.url.starts_with("http://localhost:11434/"));
        // La lista de modelos se saca de la misma URL quitando el sufijo.
        assert_eq!(
            p.url.strip_suffix("/chat/completions"),
            Some("http://localhost:11434/v1")
        );
        // Los modelos que se instalan en local deben pasar el filtro de texto.
        assert!(super::es_de_texto("qwen2.5:7b-instruct"));
        assert!(super::es_de_texto("llama3.1:8b"));
        assert!(!super::es_de_texto("nomic-embed-text"));
    }

    #[test]
    fn lo_aprendido_se_le_cuenta_a_la_ia() {
        assert_eq!(aprendido_texto(&[]), "");
        let texto = aprendido_texto(&["Prefiere planos de 3 s.".into(), "Borra los rótulos.".into()]);
        assert!(texto.contains("LO QUE HAS APRENDIDO"));
        assert!(texto.contains("- Prefiere planos de 3 s.\n- Borra los rótulos."));
    }

    #[test]
    fn sin_material_el_prompt_no_pide_momentos() {
        let mut r = peticion();
        r.material.clear();
        assert!(!build_prompt(&r, "hola").contains("MATERIAL DISPONIBLE"));
    }

    #[test]
    fn un_plan_sin_picks_sigue_valiendo() {
        let plan: EditPlan = serde_json::from_str(
            r#"{"title":"t","titlePreset":"pop","highlights":[],"subtitleStyle":"discreto","transition":"fade","musicQuery":"q","reasoning":"r"}"#,
        )
        .unwrap();
        assert!(plan.picks.is_empty());
        let plan: EditPlan = serde_json::from_str(
            r#"{"title":"t","titlePreset":"pop","highlights":[],"subtitleStyle":"discreto","transition":"fade","musicQuery":"q","reasoning":"r","picks":[{"clip":1,"in":2.5,"out":5,"why":"risa"}]}"#,
        )
        .unwrap();
        assert_eq!(plan.picks[0].clip, 1);
        assert_eq!(plan.picks[0].in_sec, 2.5);
    }

    #[test]
    fn el_esquema_exige_todas_sus_propiedades() {
        // Los modos estrictos (OpenAI) rechazan esquemas con propiedades fuera de `required`.
        fn comprobar(obj: &serde_json::Value) {
            if let Some(props) = obj.get("properties").and_then(|p| p.as_object()) {
                let req: Vec<&str> = obj["required"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
                for k in props.keys() {
                    assert!(req.contains(&k.as_str()), "{k} no está en required");
                }
                for v in props.values() {
                    comprobar(v);
                    if let Some(items) = v.get("items") {
                        comprobar(items);
                    }
                }
            }
        }
        comprobar(&schema());
    }
}
