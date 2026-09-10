import { invoke } from "@tauri-apps/api/core";
import { clipDuration, clipEnd, project, type Clip } from "$lib/project.svelte";
import { buildCues, SUBTITLE_STYLES } from "$lib/subtitles/cues";
import { TITLE_PRESETS } from "$lib/text/title-presets";
import { transcribe, type TranscribeProvider } from "$lib/tauri/transcribe";
import { probeMedia } from "$lib/tauri/media";
import type { Word } from "$lib/subtitles/cues";
import { DEFAULT_TEXT, type TextData } from "$lib/text/styles";
import { getTransition } from "$lib/transitions/presets";
import { autoLayers } from "./layers";
import { analyzeCandidates, applyHighlights, planHighlights, type Highlight, type Origen } from "./highlights";
import { cargarAprendido, NADA_APRENDIDO, type Aprendido } from "./learning";

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
  /** Momentos elegidos por la IA a partir del material: índice de clip y tramo dentro del archivo. */
  picks?: { clip: number; in: number; out: number; why?: string }[];
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
export type AiProvider = "none" | "groq" | "gemini" | "ollama" | "openai" | "anthropic";

export const AI_PROVIDERS: { id: AiProvider; name: string; note: string; needsKey: string | null }[] = [
  { id: "groq", name: "Groq", note: "gratis · recomendado", needsKey: "groq" },
  { id: "gemini", name: "Google Gemini", note: "gratis", needsKey: "gemini" },
  { id: "ollama", name: "Ollama", note: "en tu ordenador · sin clave", needsKey: null },
  { id: "none", name: "Sin IA", note: "títulos sencillos, sin clave ni internet", needsKey: null },
  { id: "openai", name: "OpenAI", note: "de pago", needsKey: "openai" },
  { id: "anthropic", name: "Claude", note: "de pago · mejor calidad", needsKey: "anthropic" },
];

/** Lo que la IA sabe de cada clip del material. */
export interface MaterialClip {
  index: number;
  name: string;
  duration: number;
  recordedAt: string | null;
  candidates: { in: number; out: number; score: number; words: string }[];
}

export const aiEditPlan = (request: {
  transcript: string;
  duration: number;
  clipCount: number;
  bpm: number | null;
  style: string;
  language: string;
  provider: AiProvider;
  material?: MaterialClip[];
  targetSeconds?: number | null;
}) => invoke<EditPlan>("ai_edit_plan", { request });

/**
 * Resumen del material para la IA: por clip, sus mejores tramos con la
 * puntuación y lo que se dice en cada uno. Así elige con el contexto de
 * todo lo grabado y no solo con una transcripción plana.
 */
function describirMaterial(
  clips: Clip[],
  candidates: { clip: Clip; in: number; out: number; score: number }[],
  words: Word[],
): MaterialClip[] {
  return clips.map((clip, index) => ({
    index,
    name: clip.name,
    duration: Math.round(clipDuration(clip) * 10) / 10,
    recordedAt: project.mediaOf(clip)?.recordedAt ?? null,
    candidates: candidates
      .filter((c) => c.clip.id === clip.id)
      .map((c) => {
        // Palabras dichas dentro del tramo, en tiempo del timeline actual.
        const desde = clip.start + (c.in - clip.in);
        const hasta = desde + (c.out - c.in);
        const dichas = words
          .filter((w) => w.start >= desde && w.start < hasta)
          .map((w) => w.word)
          .join(" ")
          .slice(0, 160);
        return {
          in: Math.round(c.in * 10) / 10,
          out: Math.round(c.out * 10) / 10,
          score: Math.round(c.score * 100) / 100,
          words: dichas,
        };
      }),
  }));
}

/** Lleva una transcripción hecha sobre el material entero al timeline ya cortado. */
function recolocarPalabras(words: Word[], origen: Origen): Word[] {
  const tramos = project.videoTrack.clips
    .map((c) => ({ o: origen.get(c.id), newStart: c.start }))
    .filter((t): t is { o: { origStart: number; origEnd: number }; newStart: number } => !!t.o);
  const out: Word[] = [];
  for (const w of words) {
    const t = tramos.find((t) => w.start >= t.o.origStart && w.start < t.o.origEnd);
    if (!t) continue;
    const d = t.newStart - t.o.origStart;
    out.push({ ...w, start: w.start + d, end: Math.min(w.end + d, t.newStart + (t.o.origEnd - t.o.origStart)) });
  }
  return out;
}

/**
 * Convierte los momentos que devuelve la IA en tramos reales, descartando lo
 * que no cuadre (clip inexistente, tramo fuera del archivo o demasiado corto).
 */
function picksDeLaIA(
  plan: EditPlan,
  clips: Clip[],
  targetSeconds: number,
): Highlight[] {
  const out: Highlight[] = [];
  let total = 0;
  for (const p of plan.picks ?? []) {
    const clip = clips[p.clip];
    if (!clip) continue;
    const a = Math.max(clip.in, Number(p.in));
    const b = Math.min(clip.out, Number(p.out));
    if (!(b - a >= 1)) continue;
    if (out.some((o) => o.clip.id === clip.id && a < o.out && b > o.in)) continue;
    out.push({ clip, in: a, out: b, score: 1 });
    total += b - a;
    if (total >= targetSeconds * 1.25) break;
  }
  const orden = new Map(clips.map((c, i) => [c.id, i]));
  out.sort((x, y) => orden.get(x.clip.id)! - orden.get(y.clip.id)! || x.in - y.in);
  return out;
}

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
    picks: [],
    subtitleStyle,
    transition: transitionId,
    musicQuery: "upbeat background music",
    reasoning: "Plan hecho sin IA, a partir de la propia transcripción.",
  };
}

export interface AutoEditOptions {
  /** Monta lo que haya en Medios sin usar, en orden de grabación. */
  useAllMedia: boolean;
  /** Analiza el material y se queda solo con los mejores momentos. */
  selectHighlights: boolean;
  /** A cuántos segundos dejarlo. */
  targetSeconds: number;
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
  /** Tener en cuenta lo aprendido de montajes anteriores. */
  useLearning: boolean;
  style: string;
  language: string;
  /** Servicio que transcribe el audio. */
  provider: TranscribeProvider;
  /** Servicio que redacta el título y las frases. */
  aiProvider: AiProvider;
}

export const DEFAULT_AUTOEDIT: AutoEditOptions = {
  useAllMedia: true,
  selectHighlights: true,
  targetSeconds: 60,
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
  useLearning: true,
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
  /** Vídeos que se han subido al montaje desde la lista de medios. */
  mounted: number;
  /** Momentos escogidos y a cuánto quedó el vídeo. */
  highlights: { picks: number; seconds: number; originalSeconds: number } | null;
  /** Título de la pista de música que se ha puesto, si se ha puesto alguna. */
  music: string | null;
  /** Capas preparadas: croma, recortes, imagen en imagen y escenas añadidas. */
  layers: { chromaed: number; cutout: number; pip: number; added: number };
  bpm: number | null;
  plan: EditPlan | null;
  /** Cuántas ediciones anteriores se han tenido en cuenta. */
  learned: number;
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
function estiloSubtitulo(id: string, aprendido?: Aprendido) {
  if (id !== "auto") return SUBTITLE_STYLES.find((s) => s.id === id) ?? SUBTITLE_STYLES[0];
  // En "auto" manda el estilo con el que se suele quedar él.
  const suyo = aprendido?.estiloSubtitulo
    ? SUBTITLE_STYLES.find((s) => s.id === aprendido.estiloSubtitulo)
    : null;
  return suyo ?? SUBTITLE_STYLES[0];
}

/** Ajusta un estilo de subtítulo al tamaño y la altura que él acaba poniendo. */
function aSuMedida(data: TextData, aprendido: Aprendido): TextData {
  return {
    ...data,
    ...(aprendido.subtituloFontSize ? { fontSize: aprendido.subtituloFontSize } : {}),
    ...(aprendido.subtituloY ? { y: aprendido.subtituloY } : {}),
  };
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
    mounted: 0,
    highlights: null,
    music: null,
    layers: { chromaed: 0, cutout: 0, pip: 0, added: 0 },
    bpm: null,
    plan: null,
    learned: 0,
    notes: [],
  };
  // Lo aprendido de montajes anteriores: aquí ajusta la duración de los planos,
  // el tamaño de los subtítulos y si conviene poner rótulos o música; a la IA
  // se lo cuenta el backend en el propio encargo.
  const aprendido: Aprendido = options.useLearning ? await cargarAprendido() : NADA_APRENDIDO;
  /** Lo que ponga este montaje, para poder compararlo al exportar. */
  const rotulosPuestos: string[] = [];
  let estiloPuesto: string | null = null;
  let musicaPuesta: string | null = null;
  if (aprendido.ediciones > 0) {
    result.learned = aprendido.ediciones;
  }

  // 0) Subir al montaje lo que esté en Medios y no se haya puesto.
  //
  // Así no hace falta arrastrar nada antes: se importa y se pulsa autoeditar.
  // El orden es el de grabación, que es en el que pasaron las cosas; si un
  // archivo no trae fecha se usa la del archivo en disco y, en último caso,
  // el orden en que se importó.
  if (options.useAllMedia) {
    const yaPuestos = new Set(project.videoTrack.clips.map((c) => c.mediaPath));
    const pendientes = project.media
      .filter((m) => m.video && !m.isImage && !yaPuestos.has(m.path))
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const fa = a.m.recordedAt ?? "";
        const fb = b.m.recordedAt ?? "";
        if (fa && fb && fa !== fb) return fa < fb ? -1 : 1;
        if (fa !== fb) return fa ? -1 : 1;
        return a.i - b.i;
      })
      .map(({ m }) => m);
    if (pendientes.length) {
      onStep(`Montando ${pendientes.length} vídeos en orden…`);
      for (const m of pendientes) project.addClip(m);
      result.mounted = pendientes.length;
      if (pendientes.some((m) => !m.recordedAt)) {
        result.notes.push(
          "Algunos vídeos no traen fecha de grabación: esos van en el orden en que se importaron.",
        );
      }
    }
  }

  if (project.videoTrack.clips.length === 0) {
    throw new Error("No hay vídeos: importa algo en Medios antes de autoeditar");
  }

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

  // 2) Quedarse con lo mejor del material.
  //
  // Va antes que los silencios y los sustituye: si ya se han elegido los
  // momentos buenos, volver a picar por pausas solo estropea lo elegido.
  let haElegido = false;
  // Transcripción y plan pueden llegar ya en este paso, cuando elige la IA;
  // los pasos de más abajo los reutilizan en vez de repetir el trabajo.
  let transcriptText = "";
  let lastWords: Word[] = [];
  let planIA: EditPlan | null = null;
  let origen: Origen | null = null;
  const objetivo = Math.max(5, options.targetSeconds);
  const conIA = options.useAi && options.aiProvider !== "none";
  if (options.selectHighlights) {
    const material = [...project.videoTrack.clips];
    let picks: Highlight[] = [];
    let originalSeconds = material.reduce((n, c) => n + clipDuration(c), 0);

    // Con IA: se le enseña TODO el material —cada clip, sus mejores tramos
    // y lo que se dice en ellos— y elige ella según el estilo pedido.
    if (conIA) {
      try {
        onStep("Transcribiendo todo el material…");
        const transcript = await transcribe({
          provider: options.provider,
          language: options.language || null,
          clips: clipsForBackend(material),
        });
        transcriptText = transcript.text;
        lastWords = transcript.words;
      } catch (e) {
        result.notes.push(`Sin transcripción del material: ${e}`);
      }
      const cand = await analyzeCandidates(material, onStep, () => false);
      result.notes.push(...cand.notes);
      originalSeconds = cand.originalSeconds;
      onStep("La IA está eligiendo los momentos…");
      try {
        planIA = await aiEditPlan({
          transcript: transcriptText,
          duration: originalSeconds,
          clipCount: material.length,
          bpm: result.bpm,
          style: options.style,
          language: options.language || "es",
          provider: options.aiProvider,
          material: describirMaterial(material, cand.candidates, lastWords),
          targetSeconds: objetivo,
        });
        picks = picksDeLaIA(planIA, material, objetivo);
        if (picks.length && planIA.reasoning) result.notes.push(`IA: ${planIA.reasoning}`);
        if (!picks.length) {
          result.notes.push("La IA no devolvió momentos válidos: se eligen por sonido y movimiento.");
        }
      } catch (e) {
        result.notes.push(`No se pudo pedir el plan a la IA: ${e}`);
        planIA = null;
      }
    }

    if (!picks.length) {
      // Si sus montajes acaban con planos de ~3 s, se buscan tramos de ese tamaño.
      const d = aprendido.duracionClip;
      const min = d ? Math.min(4, Math.max(1.4, d * 0.8)) : undefined;
      const max = d ? Math.min(8, Math.max((min ?? 2.2) + 1, d * 1.5)) : undefined;
      const plan = await planHighlights(material, objetivo, onStep, () => false, min, max);
      result.notes.push(...plan.notes);
      picks = plan.picks;
      originalSeconds = plan.originalSeconds;
    }

    if (picks.length) {
      onStep(`Montando ${picks.length} momentos…`);
      origen = applyHighlights(picks);
      const seconds = picks.reduce((n, p) => n + (p.out - p.in), 0);
      result.highlights = { picks: picks.length, seconds, originalSeconds };
      result.cuts = Math.max(0, picks.length - 1);
      result.removedSeconds = Math.max(0, originalSeconds - seconds);
      haElegido = true;
    } else {
      result.notes.push(
        "No se ha podido elegir momentos: se sigue con el vídeo entero y quitando silencios.",
      );
    }
  }

  // 3) Quitar silencios (solo si no se han elegido momentos).
  if (options.removeSilences && !haElegido) {
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

  // 4) Ajustar los cortes al compás moviendo el borde entre clips.
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

  // 5) Transiciones en todos los cortes.
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

  // 6) Capas superpuestas: croma, recorte de personas o imagen en imagen.
  if (options.useLayers) {
    try {
      result.layers = await autoLayers(
        {
          // Si ya se montó todo el material, lo que la selección dejó fuera
          // se quedó fuera a propósito: no vuelve a entrar por aquí.
          addSpare: options.addSpareScenes && !options.useAllMedia,
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

  // 7) Subtítulos.
  if (options.addSubtitles) {
    if (lastWords.length && origen) {
      // Ya se transcribió el material entero: solo hay que recolocar las
      // palabras en el timeline cortado (y ya con las transiciones puestas).
      lastWords = recolocarPalabras(lastWords, origen);
    } else {
      onStep("Transcribiendo el audio…");
      const transcript = await transcribe({
        provider: options.provider,
        language: options.language || null,
        clips: clipsForBackend(project.videoTrack.clips),
      });
      transcriptText = transcript.text;
      lastWords = transcript.words;
    }
    const transcript = { words: lastWords };
    if (transcript.words.length) {
      const style = estiloSubtitulo(options.subtitleStyle, aprendido);
      const cues = buildCues(transcript.words, style.cue);
      project.setSubtitles(cues, aSuMedida(style.data, aprendido));
      result.subtitles = cues.length;
      estiloPuesto = style.id;
    } else {
      result.notes.push("La transcripción no trae tiempos por palabra: no se han creado subtítulos.");
    }
  }

  // 8) Título y frases destacadas con IA.
  if (options.useAi) {
    const local = options.aiProvider === "none";
    if (!planIA) onStep(local ? "Redactando los textos…" : "Pidiendo el plan de edición…");
    try {
      const plan = local
        ? localPlan(lastWords, project.duration, options.subtitleStyle, options.transitionId)
        : planIA ?? (await aiEditPlan({
            transcript: transcriptText,
            duration: project.duration,
            clipCount: project.videoTrack.clips.length,
            bpm: result.bpm,
            style: options.style,
            language: options.language || "es",
            provider: options.aiProvider,
          }));
      result.plan = plan;

      const preset = TITLE_PRESETS.find((p) => p.id === plan.titlePreset) ?? TITLE_PRESETS[1];
      const videoEnd = project.videoTrack.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
      /**
       * Que un rótulo no se quede a caballo de un corte: la imagen cambia y el
       * texto sigue, y eso canta. Se acorta para que acabe antes del corte o,
       * si ya está pegado a él, empieza con el clip siguiente.
       */
      const encajar = (at: number, dur: number): { at: number; dur: number } => {
        const c = project.clipAt(project.videoTrack, at);
        if (!c) return { at, dur };
        const sig = project.nextClip(c);
        // Con transición, el cambio de plano empieza donde arranca el siguiente.
        const fin = sig ? Math.min(clipEnd(c), sig.start) : clipEnd(c);
        if (at + dur <= fin - 0.15) return { at, dur };
        const hueco = fin - at;
        if (hueco >= 1.2) return { at, dur: hueco - 0.15 };
        if (sig) return { at: clipEnd(c) + 0.1, dur: Math.max(0.8, Math.min(dur, clipDuration(sig) - 0.3)) };
        return { at: Math.max(c.start, fin - dur), dur: Math.min(dur, fin - c.start) };
      };
      const textos = project.tracks.find((t) => t.id === "t1");
      const makeText = (text: string, at0: number, data: Partial<TextData>, dur0: number) => {
        // Si ya hay un rótulo ahí (el título), este entra cuando acabe aquel.
        const ocupado = textos?.clips.find((c) => at0 >= c.start && at0 < clipEnd(c));
        const { at, dur } = encajar(ocupado ? clipEnd(ocupado) + 0.1 : at0, dur0);
        const start = Math.min(at, Math.max(0, videoEnd - 0.5));
        const clip = project.addText(start);
        project.updateText(clip.id, { ...DEFAULT_TEXT, ...data, text });
        // Nunca más allá del final del vídeo, para no alargar el proyecto.
        project.trimOut(clip.id, Math.min(dur, Math.max(0.5, videoEnd - clip.start)));
        rotulosPuestos.push(clip.id);
        result.texts++;
      };
      if (plan.title.trim()) {
        makeText(plan.title.trim(), 0, { ...preset.data, fontSize: 0.1, y: 0.42 }, 2.5);
      }
      // Como mucho cuatro rótulos y separados: más de eso es ruido. Y si él
      // los borra siempre, no se ponen: con el título de apertura basta.
      let ultimo = -Infinity;
      if (!aprendido.ponerRotulos && plan.highlights.length) {
        result.notes.push("No he puesto frases sueltas: en tus montajes anteriores las quitas.");
      }
      for (const h of aprendido.ponerRotulos ? plan.highlights.slice(0, 4) : []) {
        const at = Math.min(Math.max(0, h.time), Math.max(0, videoEnd - 1));
        if (!h.text.trim() || at - ultimo < 4) continue;
        makeText(h.text.trim(), at, { ...preset.data, fontSize: 0.06, y: 0.2 }, 2);
        ultimo = at;
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
      if (options.addSubtitles && options.subtitleStyle === "auto" && lastWords.length && plan.subtitleStyle) {
        const style = SUBTITLE_STYLES.find((s) => s.id === plan.subtitleStyle);
        if (style) {
          const cues = buildCues(lastWords, style.cue);
          project.setSubtitles(cues, aSuMedida(style.data, aprendido));
          result.subtitles = cues.length;
          estiloPuesto = style.id;
        }
      }

      // Música libre, si no había ninguna puesta.
      if (options.addMusic && !aprendido.ponerMusica) {
        result.notes.push("No he puesto música: en tus montajes anteriores la quitas.");
      } else if (options.addMusic && project.audioTrack.clips.length === 0 && plan.musicQuery) {
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
            musicaPuesta = project.addClip(info)?.id ?? null;
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

  // Memoria de este montaje: al exportar se compara con lo que haya quedado.
  project.autoedit = {
    at: Date.now(),
    objetivoSegundos: options.selectHighlights ? options.targetSeconds : 0,
    momentos: project.videoTrack.clips.map((c) => c.id),
    transiciones: project.videoTrack.clips
      .map((c) => c.transition?.id)
      .filter((id): id is string => !!id),
    rotulos: rotulosPuestos,
    musica: musicaPuesta,
    estiloSubtitulo: estiloPuesto,
  };

  project.setPlayhead(0);
  return result;
}
