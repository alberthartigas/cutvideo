import { invoke } from "@tauri-apps/api/core";
import { clipEnd, project, type Clip } from "$lib/project.svelte";
import { buildCues, SUBTITLE_STYLES } from "$lib/subtitles/cues";
import { TITLE_PRESETS } from "$lib/text/title-presets";
import { transcribe, type TranscribeProvider } from "$lib/tauri/transcribe";
import { DEFAULT_TEXT, type TextData } from "$lib/text/styles";
import { getTransition } from "$lib/transitions/presets";

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
export const aiEditPlan = (request: {
  transcript: string;
  duration: number;
  clipCount: number;
  bpm: number | null;
  style: string;
  language: string;
}) => invoke<EditPlan>("ai_edit_plan", { request });

export interface AutoEditOptions {
  removeSilences: boolean;
  /** dBFS por debajo del cual se considera silencio. */
  silenceThreshold: number;
  /** Silencio mínimo para recortarlo (s). */
  silenceMin: number;
  /** Deja este margen a cada lado para no comerse el principio de las palabras. */
  silencePad: number;
  addTransitions: boolean;
  transitionId: string;
  syncToBeat: boolean;
  addSubtitles: boolean;
  subtitleStyle: string;
  useAi: boolean;
  style: string;
  language: string;
  provider: TranscribeProvider;
}

export const DEFAULT_AUTOEDIT: AutoEditOptions = {
  removeSilences: true,
  silenceThreshold: -32,
  silenceMin: 0.6,
  silencePad: 0.12,
  addTransitions: true,
  transitionId: "fade",
  syncToBeat: true,
  addSubtitles: true,
  subtitleStyle: "karaoke",
  useAi: true,
  style: "dinámico, para redes sociales",
  language: "es",
  provider: "groq",
};

export interface AutoEditResult {
  removedSeconds: number;
  cuts: number;
  transitions: number;
  subtitles: number;
  texts: number;
  bpm: number | null;
  plan: EditPlan | null;
  /** Avisos para enseñar al final (p. ej. que el ritmo no estaba claro). */
  notes: string[];
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
    const ranges = silences
      .map(({ start, end }): [number, number] => [start + options.silencePad, end - options.silencePad])
      .filter(([s, e]) => e - s > 0.2)
      .map(([s, e]): [number, number] => [Math.max(0, s), Math.min(total, e)]);
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
    const id = getTransition(options.transitionId) ? options.transitionId : "fade";
    project.applyTransitionToAll(id, 0.35);
    result.transitions = project.videoTrack.clips.length - 1;
  }

  // 5) Subtítulos.
  let transcriptText = "";
  if (options.addSubtitles) {
    onStep("Transcribiendo el audio…");
    const transcript = await transcribe({
      provider: options.provider,
      language: options.language || null,
      clips: clipsForBackend(project.videoTrack.clips),
    });
    transcriptText = transcript.text;
    if (transcript.words.length) {
      const style = SUBTITLE_STYLES.find((s) => s.id === options.subtitleStyle) ?? SUBTITLE_STYLES[0];
      const cues = buildCues(transcript.words, style.cue);
      project.setSubtitles(cues, style.data);
      result.subtitles = cues.length;
    } else {
      result.notes.push("La transcripción no trae tiempos por palabra: no se han creado subtítulos.");
    }
  }

  // 6) Título y frases destacadas con IA.
  if (options.useAi) {
    onStep("Pidiendo a Claude el plan de edición…");
    try {
      const plan = await aiEditPlan({
        transcript: transcriptText,
        duration: project.duration,
        clipCount: project.videoTrack.clips.length,
        bpm: result.bpm,
        style: options.style,
        language: options.language || "es",
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
      if (plan.transition && options.addTransitions && getTransition(plan.transition)) {
        project.applyTransitionToAll(plan.transition, 0.35);
      }
    } catch (e) {
      result.notes.push(`No se pudo generar el plan con IA: ${e}`);
    }
  }

  project.setPlayhead(0);
  return result;
}
