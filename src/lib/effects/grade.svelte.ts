import { invoke } from "@tauri-apps/api/core";
import { SvelteMap } from "svelte/reactivity";

/**
 * Corrección de color por clip. Espejo de src-tauri/src/grade.rs: Rust hornea
 * estos ajustes en un LUT 3D con la matemática de Lumetri de FilmCraft, y la
 * misma tabla se aplica en el preview (layer-gl.ts) y en el export (lut3d).
 */
export interface Grade {
  temperature: number;
  tint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  faded: number;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
}

export const DEFAULT_GRADE: Grade = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 100,
  vibrance: 0,
  faded: 0,
  shadowTint: [0.5, 0.5, 0.5],
  highlightTint: [0.5, 0.5, 0.5],
};

/** Lado del cubo; igual que `LUT_SIZE` en grade.rs. */
export const LUT_SIZE = 33;

export const isDefaultGrade = (g: Grade | undefined) =>
  !g || JSON.stringify({ ...DEFAULT_GRADE, ...g }) === JSON.stringify(DEFAULT_GRADE);

export interface Look {
  id: string;
  name: string;
  grade: Partial<Grade>;
}

/**
 * Looks de partida. Los valores son los de los Lumetri Presets de FilmCraft
 * (crates/render/src/lumetri_presets.rs), solo los que usan controles que
 * tenemos; «creative_sat» se multiplica con la saturación, como allí.
 */
export const LOOKS: Look[] = [
  { id: "teal-warm", name: "Cine: sombras azules", grade: { shadowTint: [0.36, 0.52, 0.6], highlightTint: [0.64, 0.53, 0.42], contrast: 20, saturation: 110 } },
  { id: "night", name: "Noche americana", grade: { temperature: -45, exposure: -0.9, contrast: 15, saturation: 70, shadowTint: [0.4, 0.45, 0.62] } },
  { id: "golden", name: "Atardecer", grade: { temperature: 35, tint: 8, highlights: -15, vibrance: 20, highlightTint: [0.66, 0.55, 0.4] } },
  { id: "steel", name: "Acero", grade: { temperature: -25, saturation: 80, contrast: 25 } },
  { id: "hard-sun", name: "Sol duro", grade: { contrast: 45, shadows: -20, highlights: -25, vibrance: 15 } },
  { id: "faded-print", name: "Copia gastada", grade: { faded: 45, contrast: -10, saturation: 85 } },
  { id: "mono", name: "B/N neutro", grade: { saturation: 0 } },
  { id: "hard-mono", name: "B/N duro", grade: { saturation: 0, contrast: 60, blacks: -25 } },
  { id: "lift", name: "Abrir sombras", grade: { shadows: 40, blacks: 10 } },
  { id: "protect", name: "Salvar cielos", grade: { highlights: -40, whites: -15 } },
  { id: "vibrance", name: "Más color", grade: { vibrance: 40 } },
];

const keyOf = (g: Grade) => JSON.stringify({ ...DEFAULT_GRADE, ...g });

/** LUTs ya horneados, por ajustes. Reactivo: el preview repinta al llegar. */
const cache = new SvelteMap<string, Uint8Array>();
const pending = new Set<string>();
/** Último cubo que tuvo cada clip: se sigue usando mientras llega el nuevo. */
const lastOf = new Map<string, Uint8Array>();

/**
 * El cubo RGB (rojo el que más rápido cambia) para estos ajustes. Mientras se
 * hornea devuelve el anterior del mismo clip (o null). Con un deslizador moviéndose se piden muchos seguidos;
 * cada uno tarda unos milisegundos en Rust, así que no merece la pena agruparlos.
 */
export function lutFor(g: Grade | undefined, clipId: string): Uint8Array | null {
  if (isDefaultGrade(g)) {
    lastOf.delete(clipId);
    return null;
  }
  const key = keyOf(g!);
  const hit = cache.get(key);
  if (hit) {
    lastOf.set(clipId, hit);
    return hit;
  }
  if (!pending.has(key)) {
    pending.add(key);
    invoke<ArrayBuffer>("grade_lut", { grade: { ...DEFAULT_GRADE, ...g } })
      .then((buf) => {
        // Cada ajuste intermedio de un deslizador deja un cubo de 107 KB:
        // se guardan los últimos y se olvidan los viejos.
        if (cache.size > 48) cache.delete(cache.keys().next().value!);
        cache.set(key, new Uint8Array(buf));
      })
      .catch((e) => console.error("[CutVideo] LUT de color:", e))
      .finally(() => pending.delete(key));
  }
  // Sin esto el clip parpadearía sin color a cada paso del deslizador.
  return lastOf.get(clipId) ?? null;
}
