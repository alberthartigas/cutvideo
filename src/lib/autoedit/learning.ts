import { invoke } from "@tauri-apps/api/core";
import { clipDuration, project } from "$lib/project.svelte";
import { SUBTITLE_STYLES } from "$lib/subtitles/cues";
import type { TextData } from "$lib/text/styles";

/**
 * La autoedición aprende de cómo remata él los montajes.
 *
 * Al exportar se compara lo que propuso la IA con lo que hay en el timeline:
 * qué momentos siguen, qué tamaño tienen los subtítulos, qué transiciones ha
 * borrado. Ese resumen se guarda en la máquina (`aprendizaje.json`) y se le
 * cuenta a la IA en el siguiente montaje, además de usarse aquí mismo para los
 * ajustes automáticos. Nada de esto reentrena un modelo: es memoria del gusto
 * del usuario, y se puede olvidar desde el panel.
 */
export interface Aprendido {
  ediciones: number;
  /** Lo aprendido en frases, tal como se le cuenta a la IA. */
  frases: string[];
  estiloSubtitulo: string | null;
  subtituloFontSize: number | null;
  subtituloY: number | null;
  duracionClip: number | null;
  ponerRotulos: boolean;
  ponerMusica: boolean;
}

export const NADA_APRENDIDO: Aprendido = {
  ediciones: 0,
  frases: [],
  estiloSubtitulo: null,
  subtituloFontSize: null,
  subtituloY: null,
  duracionClip: null,
  ponerRotulos: true,
  ponerMusica: true,
};

export async function cargarAprendido(): Promise<Aprendido> {
  try {
    return await invoke<Aprendido>("learning_summary");
  } catch {
    return NADA_APRENDIDO;
  }
}

export const olvidarAprendido = () => invoke<void>("learning_forget");

/** Lo que dejó la última autoedición, para poder comparar al exportar. */
export interface Autoedicion {
  at: number;
  objetivoSegundos: number;
  /** Clips que montó la selección de momentos. */
  momentos: string[];
  /** Transiciones que puso, por id. */
  transiciones: string[];
  /** Clips de texto (títulos y rótulos) que creó. */
  rotulos: string[];
  /** Clip de música que puso, si puso alguna. */
  musica: string | null;
  /** Estilo de subtítulo que aplicó. */
  estiloSubtitulo: string | null;
}

/** Campos que distinguen de verdad un estilo de subtítulo de otro. */
const HUELLA = (d: TextData) =>
  [d.animIn, d.animOut, d.emphasis, d.uppercase === true, d.box === true, d.glow === true].join("|");

/** Qué estilo llevan ahora los subtítulos, aunque se haya cambiado el tamaño. */
function estiloActual(fallback: string | null): string | null {
  const data = project.subtitleTrack.clips[0]?.text;
  if (!data) return fallback;
  return SUBTITLE_STYLES.find((s) => HUELLA(s.data) === HUELLA(data))?.id ?? fallback;
}

/** Lo medido al exportar; espejo de `Muestra` en learning.rs. */
interface Muestra {
  estiloSubtitulo: string | null;
  subtituloFontSize: number | null;
  subtituloY: number | null;
  transicionesPuestas: string[];
  transicionesFinales: string[];
  rotulosPuestos: number;
  rotulosConservados: number;
  musicaPuesta: boolean;
  musicaConservada: boolean;
  momentosPropuestos: number;
  momentosConservados: number;
  duracionClip: number | null;
  objetivoSegundos: number | null;
  duracionFinal: number | null;
}

/** Compara lo que propuso la autoedición con lo que se acaba exportando. */
export function medir(a: Autoedicion): Muestra {
  const v1 = project.videoTrack.clips;
  const vive = (id: string) => !!project.findClip(id);
  const sub = project.subtitleTrack.clips[0]?.text ?? null;
  const textos = project.tracks.find((t) => t.id === "t1")?.clips ?? [];
  return {
    estiloSubtitulo: sub ? estiloActual(a.estiloSubtitulo) : null,
    subtituloFontSize: sub?.fontSize ?? null,
    subtituloY: sub?.y ?? null,
    transicionesPuestas: a.transiciones,
    transicionesFinales: v1.map((c) => c.transition?.id).filter((id): id is string => !!id),
    rotulosPuestos: a.rotulos.length,
    rotulosConservados: a.rotulos.filter((id) => textos.some((c) => c.id === id)).length,
    musicaPuesta: a.musica !== null,
    musicaConservada: a.musica !== null && vive(a.musica),
    momentosPropuestos: a.momentos.length,
    momentosConservados: a.momentos.filter(vive).length,
    duracionClip: v1.length ? v1.reduce((n, c) => n + clipDuration(c), 0) / v1.length : null,
    objetivoSegundos: a.objetivoSegundos || null,
    duracionFinal: project.duration || null,
  };
}

/**
 * Aprende de la edición que se acaba de exportar. Solo cuenta si esa edición
 * salió de la autoedición: si no, no hay nada con lo que comparar.
 */
export async function aprenderDeLaEdicion(): Promise<Aprendido | null> {
  const a = project.autoedit;
  if (!a) return null;
  try {
    const aprendido = await invoke<Aprendido>("learning_record", { muestra: medir(a) });
    // Una edición se aprende una sola vez, por muchas veces que se exporte.
    project.autoedit = null;
    return aprendido;
  } catch {
    return null;
  }
}
