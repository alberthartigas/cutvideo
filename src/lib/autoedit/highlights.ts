import { clipDuration, project, type Clip } from "$lib/project.svelte";
import { analyzeHighlights } from "$lib/tauri/highlights";

/**
 * Elegir los momentos que valen la pena, en vez de montarlo todo.
 *
 * Quitar silencios deja el vídeo casi igual de largo y con el mismo ritmo
 * plano. Un montador hace lo contrario: mira el material y se queda con lo
 * bueno. Aquí se puntúa cada tramo por cuánto suena y cuánto se mueve, se
 * cogen los mejores hasta llegar a la duración que se pida, y se montan **en
 * orden cronológico**: reordenarlos rompería lo que se está contando.
 */

/** Resolución del análisis del backend. */
const PASO = 0.5;

export interface Highlight {
  clip: Clip;
  /** Dentro del archivo de origen. */
  in: number;
  out: number;
  score: number;
}

export interface HighlightPlan {
  picks: Highlight[];
  /** Duración total elegida. */
  seconds: number;
  /** Duración de la que se partía. */
  originalSeconds: number;
  notes: string[];
}

/** Media móvil: interesa lo que se sostiene, no un pico suelto. */
function suavizar(v: number[], ventana: number): number[] {
  const r = Math.max(1, Math.round(ventana / 2));
  return v.map((_, i) => {
    let suma = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(v.length - 1, i + r); j++) {
      suma += v[j];
      n++;
    }
    return suma / n;
  });
}

/**
 * Escoge tramos del material hasta acercarse a `targetSeconds`.
 *
 * Va cogiendo el mejor tramo que quede, y al cogerlo invalida lo que lo rodea
 * para no quedarse con cinco pedazos del mismo momento. Los tramos duran entre
 * `minSegment` y `maxSegment`: por debajo no se leen como plano, y por encima
 * se pierde el ritmo.
 */
export async function planHighlights(
  clips: Clip[],
  targetSeconds: number,
  onStep: (message: string) => void,
  isCancelled: () => boolean,
  minSegment = 2.2,
  maxSegment = 4.5,
): Promise<HighlightPlan> {
  const notes: string[] = [];
  const originalSeconds = clips.reduce((n, c) => n + clipDuration(c), 0);
  type Ventana = { clip: Clip; in: number; out: number; score: number };
  const ventanas: Ventana[] = [];

  for (const [i, clip] of clips.entries()) {
    if (isCancelled()) throw new Error("Autoedición cancelada");
    onStep(`Mirando qué pasa en el clip ${i + 1} de ${clips.length}…`);
    let datos;
    try {
      datos = await analyzeHighlights(clip.mediaPath, clip.in, clip.out);
    } catch (e) {
      notes.push(`No se pudo analizar «${clip.name}»: ${e}`);
      continue;
    }
    // El volumen manda un poco más que el movimiento: en un vídeo hablado lo
    // que se dice pesa más que lo que se menea la cámara.
    const bruto = datos.times.map((_, j) => 0.6 * (datos.loudness[j] ?? 0) + 0.4 * (datos.motion[j] ?? 0));
    const score = suavizar(bruto, Math.round(minSegment / PASO));
    const largo = Math.round(((minSegment + maxSegment) / 2) / PASO);

    for (let j = 0; j + largo <= score.length; j++) {
      const trozo = score.slice(j, j + largo);
      const media = trozo.reduce((a, b) => a + b, 0) / trozo.length;
      ventanas.push({
        clip,
        in: datos.times[j],
        out: Math.min(datos.times[j] + largo * PASO, clip.out),
        score: media,
      });
    }
  }

  if (!ventanas.length) {
    return { picks: [], seconds: 0, originalSeconds, notes };
  }

  ventanas.sort((a, b) => b.score - a.score);
  const elegidas: Ventana[] = [];
  let total = 0;
  for (const v of ventanas) {
    if (total >= targetSeconds) break;
    if (v.out - v.in < minSegment) continue;
    // Nada que se solape con algo ya elegido, ni pegado a ello: si no, salen
    // cinco trozos del mismo instante y el montaje se repite.
    const choca = elegidas.some(
      (e) => e.clip.id === v.clip.id && v.in < e.out + minSegment && v.out > e.in - minSegment,
    );
    if (choca) continue;
    elegidas.push(v);
    total += v.out - v.in;
  }

  // En orden, que si no se rompe lo que se cuenta.
  const orden = new Map(clips.map((c, i) => [c.id, i]));
  elegidas.sort((a, b) => (orden.get(a.clip.id)! - orden.get(b.clip.id)!) || a.in - b.in);

  return {
    picks: elegidas.map((v) => ({ clip: v.clip, in: v.in, out: v.out, score: v.score })),
    seconds: total,
    originalSeconds,
    notes,
  };
}

/** Deja en la pista principal solo los tramos elegidos, en orden. */
export function applyHighlights(picks: Highlight[]) {
  if (!picks.length) return;
  project.commit();
  const track = project.videoTrack;
  track.clips = picks.map((p, i) => ({
    ...p.clip,
    id: `${p.clip.id}-h${i}`,
    in: p.in,
    out: p.out,
    start: 0,
    transition: undefined,
  }));
  project.relayoutVideo();
  project.selectedId = null;
}
