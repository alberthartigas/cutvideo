/** Proporciones de salida. "original" usa la del propio vídeo. */
export type AspectId = "original" | "16:9" | "9:16" | "1:1" | "4:3";

/** Cómo encaja el vídeo cuando su proporción no es la del proyecto. */
export type FitMode = "contain" | "cover";

export const ASPECTS: { id: AspectId; label: string; hint: string; ratio: number | null }[] = [
  { id: "original", label: "Original", hint: "La del vídeo", ratio: null },
  { id: "16:9", label: "16:9", hint: "YouTube, TV", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", hint: "Reels, TikTok, Shorts", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", hint: "Publicaciones cuadradas", ratio: 1 },
  { id: "4:3", label: "4:3", hint: "Clásico", ratio: 4 / 3 },
];

export const FITS: { id: FitMode; label: string; hint: string }[] = [
  { id: "cover", label: "Rellenar", hint: "Recorta lo que sobra: sin franjas" },
  { id: "contain", label: "Encajar", hint: "Se ve entero, con franjas a los lados" },
];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Tamaño del frame para una proporción, tomando como referencia el lado corto
 * del vídeo: un 1920×1080 da 1080×1920 en vertical y 1080×1080 en cuadrado.
 */
export function frameForAspect(
  source: { width: number; height: number },
  aspect: AspectId,
): { width: number; height: number } {
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? null;
  if (ratio === null) return { width: even(source.width), height: even(source.height) };
  const base = Math.min(source.width, source.height);
  return ratio >= 1
    ? { width: even(base * ratio), height: even(base) }
    : { width: even(base), height: even(base / ratio) };
}
