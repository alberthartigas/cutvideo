/** Proveedores externos cuya clave de API guarda el usuario (BYOK). Añadir uno = una línea. */
export interface ApiProvider {
  id: string;
  name: string;
  description: string;
  url: string;
  placeholder: string;
}

export const API_PROVIDERS: ApiProvider[] = [
  {
    id: "groq",
    name: "Groq · gratis",
    description:
      "Subtítulos automáticos (Whisper) y autoedición con IA. Plan gratuito generoso: con esta sola clave funciona todo.",
    url: "https://console.groq.com/keys",
    placeholder: "gsk_…",
  },
  {
    id: "gemini",
    name: "Google Gemini · gratis",
    description: "Alternativa gratuita para la autoedición con IA.",
    url: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Subtítulos y autoedición. De pago (sin plan gratuito).",
    url: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    description: "Autoedición con IA de la máxima calidad. De pago (sin plan gratuito).",
    url: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
  },
  {
    id: "acoustid",
    name: "AcoustID",
    description:
      "Identifica la música por huella acústica para avisarte de derechos de autor. Gratis. Necesita también `brew install chromaprint`.",
    url: "https://acoustid.org/new-application",
    placeholder: "clave de aplicación",
  },
];
