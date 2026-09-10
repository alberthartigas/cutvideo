import { invoke } from "@tauri-apps/api/core";
import { clipEnd, project, type Clip } from "$lib/project.svelte";
import { buildCues, SUBTITLE_STYLES } from "$lib/subtitles/cues";
import { TITLE_PRESETS } from "$lib/text/title-presets";
import { transcribe, type TranscribeProvider } from "$lib/tauri/transcribe";
import { probeMedia } from "$lib/tauri/media";
import type { Word } from "$lib/subtitles/cues";
import { DEFAULT_TEXT, type TextData } from "$lib/text/styles";
import { getTransition } from "$lib/transitions/presets";
import { autoLayers } from "./layers";

// Espejo de src-tauri/src/analyze.rs, music_rights.rs y ai.rs.
export interface Silence {
  start: number;
  end: number;
}

export interface BeatAnalysis {
  bpm: number;
  beats: number[];
  downbeats: number[];
  duration: number;
  confidence: number;
}

export type Verdict = "copyrighted" | "risky" | "unknown";

export interface RightsReport {
  verdict: Verdict;
  confidence: number;
  tags: {
    title: string | null;
    artist: string | null;
    album: string | null;
    isrc: string | null;
    copyright: string | null;
    publisher: string | null;
  };
  findings: string[];
  limitations: string[];
  identifiedAs: string | null;
}

export interface FreeTrack {
  title: string;
  creator: string;
  license: string;
  url: string;
  duration: number | null;
  audioUrl: string | null;
}

export interface EditPlan {
  title: string;
  titlePreset: string;
  highlights: { time: number; text: string }[];
  subtitleStyle: string;
  transition: string;
  musicQuery: string;
  reasoning: string;
}

const clipsForBackend = (clips: Clip[]) =>
  clips.map((c) => ({
    path: c.mediaPath,
    in: c.in,
    out: c.out,
    start: c.start,
    hasAudio: project.mediaOf(c)?.audio != null,
  }));

export function detectSilences(thresholdDb: number, minDuration: number): Promise<Silence[]> {
  return invoke<Silence[]>("detect_silences", {
    request: { clips: clipsForBackend(project.videoTrack.clips), thresholdDb, minDuration },
  });
}

export const analyzeBeats = (path: string) => invoke<BeatAnalysis>("analyze_beats", { path });
export const checkMusicRights = (path: string) => invoke<RightsReport>("check_music_rights", { path });
export const suggestFreeMusic = (query: string) => invoke<FreeTrack[]>("suggest_free_music", { query });
/** Descarga una pista sugerida y devuelve la ruta local donde quedó. */
export const downloadTrack = (url: string, name: string) => invoke<string>("download_track", { url, name });
/** Servicio que redacta el plan. "none" no llama a ninguna API. */
export type AiProvider = "none" | "groq" | "gemini" | "openai" | "anthropic";

export const AI_PROVIDERS: { id: AiProvider; name: string; note: string; needsKey: string | null }[] = [
  { id: "groq", name: "Groq", note: "gratis · recomendado", needsKey: "groq" },
  { id: "gemini", name: "Google Gemini", note: "gratis", needsKey: "gemini" },
  { id: "none", name: "Sin IA", note: "títulos sencillos, sin clave ni internet", needsKey: null },
  { id: "openai", name: "OpenAI", note: "de pago", needsKey: "openai" },
  { id: "anthropic", name: "Claude", note: "de pago · mejor calidad", needsKey: "anthropic" },
];

export const aiEditPlan = (request: {
  transcript: string;
  duration: number;
  clipCount: number;
  bpm: number | null;
  style: string;
  language: string;
  provider: AiProvider;
}) => invoke<EditPlan>("ai_edit_plan", { request });

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Plan sin IA: saca el título y las frases de la propia transcripción.
 * No es tan bueno como un modelo, pero no necesita clave ni internet.
 */
export function localPlan(words: Word[], duration: number, subtitleStyle: string, transitionId: string): EditPlan {
  const clean = (w: string) => w.replace(/[.,;:!?¿¡"«»]/g, "").trim();
  const usable = words.map((w) => ({ ...w, word: clean(w.word) })).filter((w) => w.word.length > 0);

  // Título: las primeras palabras que formen una frase corta.
  const title = usable.slice(0, 5).map((w) => w.word).join(" ");

  // Frases destacadas: una por cada tramo del vídeo, saltándose el principio.
  const highlights: { time: number; text: string }[] = [];
  const slots = Math.min(3, Math.max(0, Math.floor(duration / 6)));
  for (let i = 1; i <= slots; i++) {
    const at = (duration * i) / (slots + 1);
    const from = usable.findIndex((w) => w.start >= at);
    if (from < 0) continue;
    const text = usable.slice(from, from + 3).map((w) => w.word).join(" ");
    if (text) highlights.push({ time: usable[from].start, text: capitalize(text) });
  }

  return {
    title: capitalize(title) || "Mi vídeo",
    titlePreset: "pop",
    highlights,
    subtitleStyle,
    transition: transitionId,
    musicQuery: "upbeat background music",
    reasoning: "Plan hecho sin IA, a partir de la propia transcripción.",
  };
}

export interface AutoEditOptions {
  removeSilences: boolean;
  /** dBFS por debajo del cual se considera silencio. */
  silenceThreshold: number;
  /** Silencio mínimo para recortarlo (s). */
  silenceMin: number;
  /** Deja este margen a cada lado para no comerse el principio de las palabras. */
  silencePad: number;
  addTransitions: boolean;
  /** Id de transición, o "auto" para que varíe según el corte. */
  transitionId: string;
  /** Busca y pone música libre si la pista de audio está vacía. */
  addMusic: boolean;
  syncToBeat: boolean;
  addSubtitles: boolean;
  subtitleStyle: string;
  /** Prepara las capas superpuestas: croma, recorte de personas o imagen en imagen. */
  useLayers: boolean;
  /** Sube al montaje las escenas que estén en medios pero sin usar. */
  addSpareScenes: boolean;
  /** Cuántas escenas de sobra como mucho. */
  maxSpareScenes: number;
  useAi: boolean;
  style: string;
  language: string;
  /** Servicio que transcribe el audio. */
  provider: TranscribeProvider;
  /** Servicio que redacta el título y las frases. */
  aiProvider: AiProvider;
}

export const DEFAULT_AUTOEDIT: AutoEditOptions = {
  removeSilences: true,
  silenceThreshold: -32,
  silenceMin: 0.9,
  silencePad: 0.12,
  addTransitions: true,
  transitionId: "auto",
  addMusic: true,
  syncToBeat: true,
  addSubtitles: true,
  subtitleStyle: "auto",
  useLayers: true,
  addSpareScenes: true,
  maxSpareScenes: 2,
  useAi: true,
  style: "dinámico, para redes sociales",
  language: "es",
  provider: "groq",
  // Groq tiene plan gratuito y es la misma clave que los subtítulos.
  aiProvider: "groq",
};

export interface AutoEditResult {
  removedSeconds: number;
  cuts: number;
  transitions: number;
  subtitles: number;
  texts: number;
  /** Título de la pista de música que se ha puesto, si se ha puesto alguna. */
  music: string | null;
  /** Capas preparadas: croma, recortes, imagen en imagen y escenas añadidas. */
  layers: { chromaed: number; cutout: number; pip: number; added: number };
  bpm: number | null;
  plan: EditPlan | null;
  /** Avisos para enseñar al final (p. ej. que el ritmo no estaba claro). */
  notes: string[];
}

/**
 * Lo que tiene que durar como mínimo lo que queda entre dos pausas quitadas.
 *
 * Sin esto, un vídeo hablado con muchas micropausas acaba troceado en decenas
 * de fragmentos de medio segundo: el resultado no es un montaje ágil, es un
 * tartamudeo. Un trozo por debajo de esto no se percibe como un corte.
 */
const MIN_TROZO = 1.2;

/**
 * Quita de la lista las pausas cuyo recorte dejaría un trozo demasiado corto.
 * Se prefiere dejar una pausa de más antes que picar el vídeo.
 */
function sinTrocitos(ranges: [number, number][], total: number, minimo: number): [number, number][] {
  const out: [number, number][] = [];
  let finAnterior = 0;
  for (const [s, e] of ranges) {
    // Lo que se queda entre el corte anterior y este.
    if (s - finAnterior < minimo) continue;
    out.push([s, e]);
    finAnterior = e;
  }
  // Y que no quede un rabo suelto al final.
  const ultimo = out[out.length - 1];
  if (ultimo && total - ultimo[1] < minimo) out.pop();
  return out;
}

/** El estilo de subtítulo pedido, o uno con gancho si está en "auto". */
function estiloSubtitulo(id: string) {
  if (id !== "auto") return SUBTITLE_STYLES.find((s) => s.id === id) ?? SUBTITLE_STYLES[0];
  return SUBTITLE_STYLES[0];
}

/**
 * Elige la transición de cada corte cuando está en "auto".
 *
 * Poner el mismo fundido en los cincuenta cortes es lo que hace que un montaje
 * parezca de plantilla. Aquí se reparte según lo que pide el corte: los clips
 * largos aguantan una transición con presencia, los cortos piden algo rápido,
 * y nunca se repite la misma dos veces seguidas.
 */
function transicionAuto(preferida: string | null): (i: number, c: Clip, next: Clip) => string {
  const suaves = ["fade", "dissolve", "smooth"];
  const conNervio = ["zoom", "flash", "slideleft", "blur", "wipe"];
  let anterior = "";
  return (i, c, next) => {
    const corto = Math.min(clipEnd(c) - c.start, clipEnd(next) - next.start);
    const banco = corto < 2 ? conNervio : i % 3 === 0 ? conNervio : suaves;
    // La que sugiera la IA entra de vez en cuando, para dar carácter al vídeo.
    const opciones = preferida && i % 4 === 0 ? [preferida, ...banco] : banco;
    const elegida = opciones.find((t) => t !== anterior && getTransition(t)) ?? opciones[0];
    anterior = elegida;
    return elegida;
  };
}

/** Mueve `t` al pulso más cercano si está a menos de `tolerance` segundos. */
function snapToBeat(t: number, beats: number[], tolerance: number): number {
  let best = t;
  let bestDist = tolerance;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

/**
 * Ejecuta la autoedición completa sobre el proyecto actual.
 * `onStep` recibe el nombre del paso para enseñarlo en la UI.
 */
export async function runAutoEdit(
  options: AutoEditOptions,
  onStep: (message: string) => void,
): Promise<AutoEditResult> {
  const result: AutoEditResult = {
    removedSeconds: 0,
    cuts: 0,
    transitions: 0,
    subtitles: 0,
    texts: 0,
    music: null,
    layers: { chromaed: 0, cutout: 0, pip: 0, added: 0 },
    bpm: null,
    plan: null,
    notes: [],
  };
  if (project.videoTrack.clips.length === 0) throw new Error("No hay clips de vídeo en el timeline");

  // 1) Ritmo de la música, si hay algo en la pista de audio.
  let beats: number[] = [];
  const music = project.audioTrack.clips[0];
  if (music && (options.syncToBeat || options.useAi)) {
    onStep("Analizando el ritmo de la música…");
    try {
      const analysis = await analyzeBeats(music.mediaPath);
      result.bpm = analysis.bpm || null;
      if (analysis.confidence >= 0.25 && analysis.beats.length) {
        // Los pulsos vienen en tiempo del archivo: los pasamos al timeline.
        beats = analysis.beats.map((b) => b - music.in + music.start).filter((t) => t >= 0);
      } else if (options.syncToBeat) {
        result.notes.push("El ritmo de la música no está claro, así que no se han ajustado los cortes al compás.");
      }
    } catch (e) {
      result.notes.push(`No se pudo analizar la música: ${e}`);
    }
  }

  // 2) Quitar silencios.
  if (options.removeSilences) {
    onStep("Buscando silencios…");
    const silences = await detectSilences(options.silenceThreshold, options.silenceMin);
    const total = project.duration;
    const crudos = silences
      .map(({ start, end }): [number, number] => [start + options.silencePad, end - options.silencePad])
      .filter(([s, e]) => e - s > 0.2)
      .map(([s, e]): [number, number] => [Math.max(0, s), Math.min(total, e)])
      .sort((a, b) => a[0] - b[0]);
    const ranges = sinTrocitos(crudos, total, MIN_TROZO);
    const descartados = crudos.length - ranges.length;
    if (descartados > 0) {
      result.notes.push(
        `Se han dejado ${descartados} pausas sin quitar: cortarlas habría dejado trozos de menos de ${MIN_TROZO} s, que no se leen como un corte sino como un parpadeo.`,
      );
    }
    if (ranges.length) {
      onStep(`Quitando ${ranges.length} silencios…`);
      result.removedSeconds = project.removeRanges(ranges);
      result.cuts = Math.max(0, project.videoTrack.clips.length - 1);
    } else {
      result.notes.push("No se han encontrado silencios que quitar con el umbral elegido.");
    }
  }

  // 3) Ajustar los cortes al compás moviendo el borde entre clips.
  if (options.syncToBeat && beats.length > 1) {
    onStep("Ajustando los cortes al compás…");
    const period = beats[1] - beats[0];
    const clips = [...project.videoTrack.clips];
    let moved = 0;
    for (let i = 0; i < clips.length - 1; i++) {
      const cut = clipEnd(clips[i]);
      const target = snapToBeat(cut, beats, Math.min(period / 2, 0.35));
      const delta = target - cut;
      // Alargamos o acortamos el clip saliente sin pasarnos de su material.
      if (Math.abs(delta) > 0.01) {
        project.trimOut(clips[i].id, clips[i].out + delta);
        moved++;
      }
    }
    if (moved === 0) result.notes.push("Los cortes ya caían en el compás.");
  }

  // 4) Transiciones en todos los cortes.
  if (options.addTransitions && project.videoTrack.clips.length > 1) {
    onStep("Poniendo transiciones…");
    if (options.transitionId === "auto") {
      project.applyTransitionToAll("fade", 0.35, transicionAuto(null));
    } else {
      const id = getTransition(options.transitionId) ? options.transitionId : "fade";
      project.applyTransitionToAll(id, 0.35);
    }
    result.transitions = project.videoTrack.clips.filter((c) => c.transition).length;
  }

  // 5) Capas superpuestas: croma, recorte de personas o imagen en imagen.
  if (options.useLayers) {
    try {
      result.layers = await autoLayers(
        {
          addSpare: options.addSpareScenes,
          maxSpare: Math.max(0, Math.min(3, options.maxSpareScenes)),
          beats,
        },
        onStep,
      );
      const { chromaed, cutout, pip, added } = result.layers;
      if (chromaed + cutout + pip + added === 0 && project.overlayTracks.every((t) => !t.clips.length)) {
        result.notes.push(
          "No había nada que encimar: manda un clip a una capa (O1/O2) desde Medios para superponer escenas.",
        );
      }
    } catch (e) {
      result.notes.push(`No se pudieron preparar las capas: ${e}`);
    }
  }

  // 6) Subtítulos.
  let transcriptText = "";
  let lastWords: Word[] = [];
  if (options.addSubtitles) {
    onStep("Transcribiendo el audio…");
    const transcript = await transcribe({
      provider: options.provider,
      language: options.language || null,
      clips: clipsForBackend(project.videoTrack.clips),
    });
    transcriptText = transcript.text;
    lastWords = transcript.words;
    if (transcript.words.length) {
      const style = estiloSubtitulo(options.subtitleStyle);
      const cues = buildCues(transcript.words, style.cue);
      project.setSubtitles(cues, style.data);
      result.subtitles = cues.length;
    } else {
      result.notes.push("La transcripción no trae tiempos por palabra: no se han creado subtítulos.");
    }
  }

  // 7) Título y frases destacadas con IA.
  if (options.useAi) {
    const local = options.aiProvider === "none";
    onStep(local ? "Redactando los textos…" : "Pidiendo el plan de edición…");
    try {
      const plan = local
        ? localPlan(lastWords, project.duration, options.subtitleStyle, options.transitionId)
        : await aiEditPlan({
            transcript: transcriptText,
            duration: project.duration,
            clipCount: project.videoTrack.clips.length,
            bpm: result.bpm,
            style: options.style,
            language: options.language || "es",
            provider: options.aiProvider,
          });
      result.plan = plan;

      const preset = TITLE_PRESETS.find((p) => p.id === plan.titlePreset) ?? TITLE_PRESETS[1];
      const videoEnd = project.videoTrack.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
      const makeText = (text: string, at: number, data: Partial<TextData>, dur: number) => {
        const start = Math.min(at, Math.max(0, videoEnd - 0.5));
        const clip = project.addText(start);
        project.updateText(clip.id, { ...DEFAULT_TEXT, ...data, text });
        // Nunca más allá del final del vídeo, para no alargar el proyecto.
        project.trimOut(clip.id, Math.min(dur, Math.max(0.5, videoEnd - clip.start)));
        result.texts++;
      };
      if (plan.title.trim()) {
        makeText(plan.title.trim(), 0, { ...preset.data, fontSize: 0.1, y: 0.42 }, 2.5);
      }
      for (const h of plan.highlights) {
        const at = Math.min(Math.max(0, h.time), Math.max(0, videoEnd - 1));
        if (h.text.trim()) makeText(h.text.trim(), at, { ...preset.data, fontSize: 0.07, y: 0.2 }, 2);
      }
      // Con la transición en "auto" la IA aporta su propuesta a la mezcla,
      // pero sin que se repita en los cincuenta cortes.
      if (options.addTransitions && project.videoTrack.clips.length > 1) {
        if (options.transitionId === "auto") {
          project.applyTransitionToAll("fade", 0.35, transicionAuto(plan.transition || null));
          result.transitions = project.videoTrack.clips.filter((c) => c.transition).length;
        } else if (plan.transition && getTransition(plan.transition) && options.transitionId === plan.transition) {
          project.applyTransitionToAll(plan.transition, 0.35);
        }
      }

      // Si el estilo estaba en "auto", manda el que proponga la IA.
      if (options.subtitleStyle === "auto" && lastWords.length && plan.subtitleStyle) {
        const style = SUBTITLE_STYLES.find((s) => s.id === plan.subtitleStyle);
        if (style) {
          const cues = buildCues(lastWords, style.cue);
          project.setSubtitles(cues, style.data);
          result.subtitles = cues.length;
        }
      }

      // Música libre, si no había ninguna puesta.
      if (options.addMusic && project.audioTrack.clips.length === 0 && plan.musicQuery) {
        onStep("Buscando música que pegue…");
        try {
          const pistas = await suggestFreeMusic(plan.musicQuery);
          const elegida = pistas.find((t) => t.audioUrl) ?? pistas[0];
          if (elegida) {
            onStep(`Descargando «${elegida.title}»…`);
            const ruta = await downloadTrack(
              elegida.audioUrl ?? elegida.url,
              `${elegida.title} - ${elegida.creator}`,
            );
            const info = await probeMedia(ruta);
            project.addMedia(info);
            project.addClip(info);
            result.music = `${elegida.title} · ${elegida.creator} · ${elegida.license}`;
          } else {
            result.notes.push("No se ha encontrado música libre que encaje con el vídeo.");
          }
        } catch (e) {
          result.notes.push(`No se pudo poner música: ${e}`);
        }
      }
    } catch (e) {
      result.notes.push(`No se pudo generar el plan con IA: ${e}`);
    }
  }

  project.setPlayhead(0);
  return result;
}
