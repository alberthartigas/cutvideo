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
    name: "Groq",
    description: "Transcripción rápida en la nube (Whisper). Tiene plan gratuito.",
    url: "https://console.groq.com/keys",
    placeholder: "gsk_…",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Modelos GPT para edición por texto y resúmenes.",
    url: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    description: "Autoedición con IA: títulos, momentos destacados y estilo.",
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
