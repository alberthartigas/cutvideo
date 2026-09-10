import { invoke } from "@tauri-apps/api/core";

/** Medidas de un tramo de vídeo, una muestra cada medio segundo. */
export interface Highlights {
  times: number[];
  /** Cuánto suena, 0–1. */
  loudness: number[];
  /** Cuánto cambia la imagen, 0–1. */
  motion: number[];
  /** Instantes donde cambia el plano. */
  cuts: number[];
}

export const analyzeHighlights = (path: string, start: number, end: number) =>
  invoke<Highlights>("analyze_highlights", { request: { path, start, end } });
