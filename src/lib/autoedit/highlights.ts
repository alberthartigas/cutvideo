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
type Ventana = { clip: Clip; in: number; out: number; score: number };

/** Puntúa todas las ventanas posibles de todos los clips. */
async function ventanasDe(
  clips: Clip[],
  onStep: (message: string) => void,
  isCancelled: () => boolean,
  minSegment: number,
  maxSegment: number,
): Promise<{ ventanas: Ventana[]; notes: string[]; originalSeconds: number }> {
  const notes: string[] = [];
  const originalSeconds = clips.reduce((n, c) => n + clipDuration(c), 0);
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

  return { ventanas, notes, originalSeconds };
}

/** Tramo candidato que se le enseña a la IA, con su puntuación. */
export interface Candidate {
  clip: Clip;
  in: number;
  out: number;
  score: number;
}

/**
 * Los mejores tramos de cada clip, sin solaparse, para que la IA vea de un
 * vistazo dónde pasa algo en TODO el material y elija con contexto.
 */
export async function analyzeCandidates(
  clips: Clip[],
  onStep: (message: string) => void,
  isCancelled: () => boolean,
  porClip = 6,
): Promise<{ candidates: Candidate[]; notes: string[]; originalSeconds: number }> {
  const { ventanas, notes, originalSeconds } = await ventanasDe(clips, onStep, isCancelled, 2.2, 4.5);
  const candidates: Candidate[] = [];
  for (const clip of clips) {
    const propias = ventanas.filter((v) => v.clip.id === clip.id).sort((a, b) => b.score - a.score);
    const elegidas: Ventana[] = [];
    for (const v of propias) {
      if (elegidas.length >= porClip) break;
      if (elegidas.some((e) => v.in < e.out + 1 && v.out > e.in - 1)) continue;
      elegidas.push(v);
    }
    elegidas.sort((a, b) => a.in - b.in);
    candidates.push(...elegidas);
  }
  return { candidates, notes, originalSeconds };
}

export async function planHighlights(
  clips: Clip[],
  targetSeconds: number,
  onStep: (message: string) => void,
  isCancelled: () => boolean,
  minSegment = 2.2,
  maxSegment = 4.5,
): Promise<HighlightPlan> {
  const { ventanas, notes, originalSeconds } = await ventanasDe(clips, onStep, isCancelled, minSegment, maxSegment);
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

/** De dónde venía cada clip nuevo, en segundos del timeline anterior. */
export type Origen = Map<string, { origStart: number; origEnd: number }>;

/**
 * Deja en la pista principal solo los tramos elegidos, en orden. Devuelve de
 * qué segundos del timeline anterior sale cada clip nuevo, para poder mover
 * con ellos una transcripción hecha sobre el material entero.
 */
export function applyHighlights(picks: Highlight[]): Origen {
  const origen: Origen = new Map();
  if (!picks.length) return origen;
  project.commit();
  const track = project.videoTrack;
  track.clips = picks.map((p, i) => {
    const id = `${p.clip.id}-h${i}`;
    const origStart = p.clip.start + (p.in - p.clip.in);
    origen.set(id, { origStart, origEnd: origStart + (p.out - p.in) });
    return { ...p.clip, id, in: p.in, out: p.out, start: 0, transition: undefined };
  });
  project.relayoutVideo();
  project.selectedId = null;
  return origen;
}
