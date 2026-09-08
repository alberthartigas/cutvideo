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
    name: "Anthropic",
    description: "Modelos Claude para edición por texto.",
    url: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
  },
];
