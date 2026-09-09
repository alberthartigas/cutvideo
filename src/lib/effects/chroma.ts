/** Ajustes de pantalla verde (croma) de un clip. */
export interface ChromaKey {
  enabled: boolean;
  /** Color a volver transparente, en hex. */
  color: string;
  /** 0–1: cuánto se parece un píxel al color para borrarlo. */
  similarity: number;
  /** 0–1: suavizado del borde. */
  blend: number;
  /** 0–1: cuánto verde se quita de los bordes del sujeto. */
  spill: number;
}

export const DEFAULT_CHROMA: ChromaKey = {
  enabled: false,
  color: "#00b140", // el verde estándar de croma
  similarity: 0.3,
  blend: 0.08,
  spill: 0.4,
};

export const CHROMA_PRESETS: { name: string; color: string }[] = [
  { name: "Verde", color: "#00b140" },
  { name: "Azul", color: "#0047bb" },
  { name: "Blanco", color: "#ffffff" },
  { name: "Negro", color: "#000000" },
];

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Filtros de ffmpeg para el croma; el clip queda con canal alfa. */
export function chromaFfmpeg(c: ChromaKey | undefined): string {
  if (!c?.enabled) return "";
  const hex = c.color.replace("#", "");
  const parts = [
    "format=yuva420p",
    `chromakey=0x${hex}:${c.similarity.toFixed(3)}:${c.blend.toFixed(3)}`,
  ];
  if (c.spill > 0) parts.push(`despill=type=green:mix=${c.spill.toFixed(2)}`);
  return parts.join(",");
}
