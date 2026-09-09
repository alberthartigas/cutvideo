import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ExportClip } from "./export";
import type { Segment, Word } from "$lib/subtitles/cues";

// Espejo de src-tauri/src/transcribe.rs.
export type TranscribeProvider = "groq" | "openai";

export interface TranscribeRequest {
  provider: TranscribeProvider;
  language: string | null;
  clips: ExportClip[];
}

export interface Transcript {
  text: string;
  language: string | null;
  duration: number | null;
  words: Word[];
  segments: Segment[];
  provider: string;
  model: string;
}

export interface TranscribeProgress {
  stage: "extract" | "upload" | "done";
  message: string;
}

export const TRANSCRIBE_PROVIDERS: { id: TranscribeProvider; name: string; model: string }[] = [
  { id: "groq", name: "Groq", model: "whisper-large-v3-turbo · rápido y con plan gratuito" },
  { id: "openai", name: "OpenAI", model: "whisper-1" },
];

export const LANGUAGES: { code: string; name: string }[] = [
  { code: "", name: "Detectar automáticamente" },
  { code: "es", name: "Español" },
  { code: "en", name: "Inglés" },
  { code: "ca", name: "Catalán" },
  { code: "pt", name: "Portugués" },
  { code: "fr", name: "Francés" },
  { code: "it", name: "Italiano" },
  { code: "de", name: "Alemán" },
  { code: "ja", name: "Japonés" },
  { code: "zh", name: "Chino" },
];

export function transcribe(request: TranscribeRequest): Promise<Transcript> {
  return invoke<Transcript>("transcribe", { request });
}

export function onTranscribeProgress(cb: (p: TranscribeProgress) => void): Promise<UnlistenFn> {
  return listen<TranscribeProgress>("transcribe:progress", (e) => cb(e.payload));
}
