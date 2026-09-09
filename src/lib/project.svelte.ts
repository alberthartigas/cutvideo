import type { MediaInfo } from "$lib/tauri/media";
import { DEFAULT_TEXT, TEXT_DEFAULT_DURATION, type TextData } from "$lib/text/styles";
import type { FrameSize } from "$lib/text/layout";
import { DEFAULT_TRANSITION_DURATION, TRANSITION_MAX, TRANSITION_MIN } from "$lib/transitions/presets";
import { DEFAULT_ADJUSTMENTS, isDefaultAdjust, type Adjustments, type ClipEffects } from "$lib/effects/presets";
import { DEFAULT_CHROMA, type ChromaKey } from "$lib/effects/chroma";
import { DEFAULT_PATCH, type PatchData } from "$lib/patches/types";
import { frameForAspect, type AspectId, type FitMode } from "$lib/aspect";
import { DEFAULT_LAYOUT, OVERLAY_TRACK_IDS, type ClipLayout } from "$lib/layers";

/** Duración por defecto de un parche recién puesto (s). */
const PATCH_DEFAULT_DURATION = 4;

export type { FrameSize };
export type TrackKind = "video" | "audio" | "text" | "image";

export interface Clip {
  id: string;
  /** Ruta del archivo de origen (clave en `project.media`). */
  mediaPath: string;
  name: string;
  kind: TrackKind;
  /** Duración total del archivo: límite del recorte. */
  sourceDuration: number;
  fps: number;
  /** Posición en el timeline (s). En pistas magnéticas se recalcula tras cada cambio. */
  start: number;
  /** Punto de entrada en el archivo (s). */
  in: number;
  /** Punto de salida en el archivo (s). */
  out: number;
  /** Solo en clips de texto (kind === "text"): `in` es siempre 0 y `out` la duración. */
  text?: TextData;
  /** Pista magnética: transición hacia el clip siguiente (los dos clips se solapan esa duración). */
  transition?: { id: string; duration: number };
  /** Filtro de color y ajustes del clip. */
  effects?: ClipEffects;
  /** Solo en clips de imagen (kind === "image"): colocación y seguimiento. */
  patch?: PatchData;
  /** Solo en las capas superpuestas (O1, O2): dónde y cómo se ve la capa. */
  layout?: ClipLayout;
}

export interface ActiveTransition {
  out: Clip;
  in: Clip;
  id: string;
  duration: number;
  /** 0 = solo el saliente, 1 = solo el entrante. */
  p: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Pista magnética (principal, estilo CapCut): los clips van pegados en orden, sin huecos. */
  magnetic: boolean;
  clips: Clip[];
}

export interface ClipRef {
  track: Track;
  clip: Clip;
  index: number;
}

export const MIN_CLIP = 0.05;
export const ZOOM_MIN = 4;
export const ZOOM_MAX = 1000;
const HISTORY_MAX = 200;
const EPS = 1e-6;

export const clipDuration = (c: Clip) => c.out - c.in;

/** Duración real de la transición entre dos clips contiguos: nunca más de la mitad de cada uno. */
export function effectiveTransition(prev: Clip, next: Clip): number {
  const t = prev.transition;
  if (!t) return 0;
  return Math.max(0, Math.min(t.duration, clipDuration(prev) / 2, clipDuration(next) / 2));
}
export const clipEnd = (c: Clip) => c.start + c.out - c.in;
export const clipContains = (c: Clip, t: number) => t >= c.start && t < clipEnd(c);

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const DEFAULT_FRAME: FrameSize = { width: 1920, height: 1080, fps: 30 };

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Punto de `points` más cercano a `value` dentro de `threshold`, o null si no hay ninguno. */
export function nearestSnap(value: number, points: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const p of points) {
    const d = Math.abs(p - value);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** Las pistas del proyecto, en el orden en que se pintan (arriba tapa a abajo). */
export function defaultTracks(): Track[] {
  return [
    { id: "t1", kind: "text", name: "T1", magnetic: false, clips: [] },
    { id: "s1", kind: "text", name: "S1", magnetic: false, clips: [] },
    { id: "p1", kind: "image", name: "P1", magnetic: false, clips: [] },
    // Capas superpuestas: se ven por encima del vídeo principal (O1 tapa a O2).
    { id: "o1", kind: "video", name: "O1", magnetic: false, clips: [] },
    { id: "o2", kind: "video", name: "O2", magnetic: false, clips: [] },
    { id: "v1", kind: "video", name: "V1", magnetic: true, clips: [] },
    { id: "f1", kind: "video", name: "F1", magnetic: false, clips: [] },
    { id: "a1", kind: "audio", name: "A1", magnetic: false, clips: [] },
  ];
}

class ProjectStore {
  media = $state<MediaInfo[]>([]);
  tracks = $state<Track[]>(defaultTracks());
  playhead = $state(0);
  playing = $state(false);
  /** Píxeles por segundo. */
  zoom = $state(60);
  /** Proporción de salida elegida en la barra de título. */
  aspect = $state<AspectId>("original");
  /** Qué hacer cuando el vídeo no encaja en esa proporción. */
  fit = $state<FitMode>("cover");
  selectedId = $state<string | null>(null);
  /** true mientras se reordena un clip arrastrándolo (los demás se animan al hacerle sitio). */
  reordering = $state(false);
  canUndo = $state(false);
  canRedo = $state(false);

  /**
   * Devuelve una pista por id. Nunca falla: si un proyecto guardado con una
   * versión anterior no la trae, se crea vacía sobre la marcha.
   */
  #track(id: string): Track {
    const found = this.tracks.find((t) => t.id === id);
    if (found) return found;
    const missing = defaultTracks().find((t) => t.id === id)!;
    this.tracks = defaultTracks().map((def) => this.tracks.find((t) => t.id === def.id) ?? def);
    return this.tracks.find((t) => t.id === id) ?? missing;
  }

  #past: { tracks: Track[]; json: string }[] = [];
  #future: { tracks: Track[]; json: string }[] = [];

  duration = $derived(
    this.tracks.reduce((max, t) => t.clips.reduce((m, c) => Math.max(m, clipEnd(c)), max), 0),
  );
  clipCount = $derived(this.tracks.reduce((n, t) => n + t.clips.length, 0));
  videoTrack = $derived(this.#track("v1"));
  audioTrack = $derived(this.#track("a1"));
  /** Pista de títulos (T1). */
  textTrack = $derived(this.tracks.find((t) => t.id === "t1")!);
  /** Pista de subtítulos (S1). */
  subtitleTrack = $derived(this.#track("s1"));
  /** Pista de parches: imágenes y stickers encima del vídeo (P1). */
  patchTrack = $derived(this.#track("p1"));
  /** Pista de fondo, por debajo del vídeo (F1): lo que se ve tras la pantalla verde. */
  backgroundTrack = $derived(this.#track("f1"));
  /** Capas superpuestas al vídeo principal, de arriba abajo (O1 tapa a O2). */
  overlayTracks = $derived(OVERLAY_TRACK_IDS.map((id) => this.#track(id)));
  /** Todas las pistas de texto, de abajo arriba en el timeline (la primera se pinta encima). */
  textTracks = $derived(this.tracks.filter((t) => t.kind === "text"));
  /** Clips de texto de todas las pistas, en el orden en que se pintan (subtítulos debajo de los títulos). */
  textClips = $derived([...this.textTracks].reverse().flatMap((t) => t.clips));
  selected = $derived.by(() => (this.selectedId ? this.findClip(this.selectedId) : null));
  /**
   * Tamaño del frame del proyecto: el mayor de los clips de vídeo (ya rotados),
   * ajustado a la proporción elegida. 1080p si todavía no hay vídeo.
   */
  frame = $derived.by((): FrameSize => {
    let best: FrameSize | null = null;
    for (const clip of this.videoTrack.clips) {
      const v = this.mediaOf(clip)?.video;
      if (!v || !v.width || !v.height) continue;
      const rotated = v.rotation % 180 !== 0;
      const size: FrameSize = {
        width: even(rotated ? v.height : v.width),
        height: even(rotated ? v.width : v.height),
        fps: best?.fps ?? (v.fps || 30),
      };
      if (!best || size.width * size.height > best.width * best.height) best = size;
    }
    const source = best ?? DEFAULT_FRAME;
    return { ...frameForAspect(source, this.aspect), fps: source.fps };
  });

  // ---- Consultas ----

  findClip(id: string): ClipRef | null {
    for (const track of this.tracks) {
      const index = track.clips.findIndex((c) => c.id === id);
      if (index >= 0) return { track, clip: track.clips[index], index };
    }
    return null;
  }

  clipAt(track: Track, t: number): Clip | null {
    return track.clips.find((c) => clipContains(c, t)) ?? null;
  }

  mediaOf(clip: Clip): MediaInfo | null {
    return this.media.find((m) => m.path === clip.mediaPath) ?? null;
  }

  fpsAt(t: number): number {
    return this.clipAt(this.videoTrack, t)?.fps || 30;
  }

  /** Clip que sigue a `clip` en su pista, si lo hay. */
  nextClip(clip: Clip): Clip | null {
    const ref = this.findClip(clip.id);
    return ref ? (ref.track.clips[ref.index + 1] ?? null) : null;
  }

  /** Transición activa en la pista principal en el instante `t`, si estamos dentro de un solape. */
  transitionAt(t: number): ActiveTransition | null {
    const clips = this.videoTrack.clips;
    for (let i = 0; i < clips.length - 1; i++) {
      const out = clips[i];
      const next = clips[i + 1];
      const d = effectiveTransition(out, next);
      if (d <= 0) continue;
      if (t >= next.start && t < next.start + d) {
        return { out, in: next, id: out.transition!.id, duration: d, p: (t - next.start) / d };
      }
    }
    return null;
  }

  /** Bordes de todos los clips (menos `excludeId`), el playhead y el 0: puntos de imán. */
  snapPoints(excludeId?: string): number[] {
    const pts = [0, this.playhead];
    for (const track of this.tracks) {
      for (const c of track.clips) {
        if (c.id !== excludeId) pts.push(c.start, clipEnd(c));
      }
    }
    return pts;
  }

  // ---- Historial (deshacer / rehacer) ----
  // Instantáneas completas de las pistas: simple y suficiente para proyectos de este tamaño.

  #snapshot() {
    const tracks = $state.snapshot(this.tracks) as Track[];
    return { tracks, json: JSON.stringify(tracks) };
  }

  /** Guarda el estado actual para poder deshacer. Si no ha cambiado desde el último, no hace nada. */
  commit() {
    const snap = this.#snapshot();
    if (this.#past.at(-1)?.json === snap.json) return;
    this.#past.push(snap);
    if (this.#past.length > HISTORY_MAX) this.#past.shift();
    this.#future = [];
    this.#syncHistory();
  }

  undo() {
    const prev = this.#past.pop();
    if (!prev) return;
    this.#future.push(this.#snapshot());
    this.tracks = prev.tracks;
    this.#syncHistory();
  }

  redo() {
    const next = this.#future.pop();
    if (!next) return;
    this.#past.push(this.#snapshot());
    this.tracks = next.tracks;
    this.#syncHistory();
  }

  #syncHistory() {
    this.canUndo = this.#past.length > 0;
    this.canRedo = this.#future.length > 0;
  }

  /** Deja el proyecto en blanco (proyecto nuevo). */
  reset() {
    this.media = [];
    this.tracks = defaultTracks();
    this.playhead = 0;
    this.playing = false;
    this.zoom = 60;
    this.aspect = "original";
    this.fit = "cover";
    this.selectedId = null;
    this.#past = [];
    this.#future = [];
    this.#syncHistory();
  }

  // ---- Biblioteca ----

  /** Añade un archivo a la biblioteca. Devuelve false si ya estaba. */
  addMedia(info: MediaInfo): boolean {
    if (this.media.some((m) => m.path === info.path)) return false;
    this.media.push(info);
    return true;
  }

  // ---- Edición ----

  /** Añade un archivo al timeline: vídeo → V1, audio → A1. `at` = instante destino (por defecto, al final). */
  addClip(info: MediaInfo, at?: number): Clip | null {
    // Las imágenes no traen duración: se les da una por defecto como parche.
    if (info.isImage) return this.addPatch(info, at);
    if (!(info.durationSec > 0)) return null;
    const track = info.video ? this.videoTrack : this.audioTrack;
    const clip: Clip = {
      id: newId(),
      mediaPath: info.path,
      name: info.fileName,
      kind: info.video ? "video" : "audio",
      sourceDuration: info.durationSec,
      fps: info.video?.fps || 30,
      start: 0,
      in: 0,
      out: info.durationSec,
    };
    this.commit();
    if (track.magnetic) {
      const index = at == null ? track.clips.length : this.#indexAt(track, at);
      track.clips.splice(index, 0, clip);
      this.#relayout(track);
    } else {
      clip.start = this.#freeStart(track, clipDuration(clip), at ?? this.#trackEnd(track));
      track.clips.push(clip);
      this.#sort(track);
    }
    this.selectedId = clip.id;
    return clip;
  }

  /**
   * Pone un vídeo o una imagen en una capa superpuesta (O1 u O2).
   * Si no se dice cuál, usa la primera que esté libre en ese instante.
   */
  addOverlay(info: MediaInfo, at = this.playhead, trackId?: string): Clip | null {
    if (!info.video) return null;
    const duration = info.isImage ? 4 : info.durationSec;
    const asked = trackId ? this.tracks.find((t) => t.id === trackId) : undefined;
    const libre = this.overlayTracks.find(
      (t) => !t.clips.some((c) => at < clipEnd(c) && at + duration > c.start),
    );
    const track = asked ?? libre ?? this.overlayTracks[0];
    const clip: Clip = {
      id: newId(),
      mediaPath: info.path,
      name: info.fileName,
      kind: "video",
      sourceDuration: info.isImage ? Number.POSITIVE_INFINITY : info.durationSec,
      fps: info.video.fps || 30,
      start: 0,
      in: 0,
      out: duration,
      layout: { ...DEFAULT_LAYOUT },
    };
    this.commit();
    clip.start = this.#freeStart(track, duration, at);
    track.clips.push(clip);
    this.#sort(track);
    this.selectedId = clip.id;
    return clip;
  }

  /** Cambia la colocación de una capa superpuesta. */
  updateLayout(clipId: string, patch: Partial<ClipLayout>) {
    const ref = this.findClip(clipId);
    if (!ref) return;
    ref.clip.layout = { ...DEFAULT_LAYOUT, ...ref.clip.layout, ...patch };
  }

  /** Pone un vídeo o una imagen en la pista de fondo (F1), por detrás del vídeo. */
  addBackground(info: MediaInfo, at = this.playhead): Clip | null {
    if (!info.video) return null;
    const track = this.backgroundTrack;
    // Una imagen fija de fondo dura lo mismo que un parche por defecto.
    const duration = info.isImage ? PATCH_DEFAULT_DURATION : info.durationSec;
    const clip: Clip = {
      id: newId(),
      mediaPath: info.path,
      name: info.fileName,
      kind: "video",
      sourceDuration: info.isImage ? Number.POSITIVE_INFINITY : info.durationSec,
      fps: info.video.fps || 30,
      start: 0,
      in: 0,
      out: duration,
    };
    this.commit();
    clip.start = this.#freeStart(track, duration, at);
    track.clips.push(clip);
    this.#sort(track);
    this.selectedId = clip.id;
    return clip;
  }

  /** Añade una imagen o sticker como parche sobre el vídeo. */
  addPatch(info: { path: string; fileName: string }, at = this.playhead): Clip {
    const track = this.patchTrack;
    const clip: Clip = {
      id: newId(),
      mediaPath: info.path,
      name: info.fileName,
      kind: "image",
      sourceDuration: Number.POSITIVE_INFINITY,
      fps: 30,
      start: 0,
      in: 0,
      out: PATCH_DEFAULT_DURATION,
      patch: { ...DEFAULT_PATCH },
    };
    this.commit();
    clip.start = this.#freeStart(track, PATCH_DEFAULT_DURATION, at);
    track.clips.push(clip);
    this.#sort(track);
    this.selectedId = clip.id;
    return clip;
  }

  /** Cambia la colocación de un parche. */
  updatePatch(id: string, patch: Partial<PatchData>) {
    const ref = this.findClip(id);
    if (!ref?.clip.patch) return;
    Object.assign(ref.clip.patch, patch);
  }

  /** Añade un clip de texto (3 s) en `at` (por defecto el playhead) o en el hueco libre más cercano. */
  addText(at = this.playhead): Clip {
    const track = this.textTrack;
    const clip: Clip = {
      id: newId(),
      mediaPath: "",
      name: DEFAULT_TEXT.text,
      kind: "text",
      sourceDuration: Number.POSITIVE_INFINITY,
      fps: 30,
      start: 0,
      in: 0,
      out: TEXT_DEFAULT_DURATION,
      text: { ...DEFAULT_TEXT },
    };
    this.commit();
    clip.start = this.#freeStart(track, TEXT_DEFAULT_DURATION, at);
    track.clips.push(clip);
    this.#sort(track);
    this.selectedId = clip.id;
    return clip;
  }

  /**
   * Sustituye los subtítulos (pista S1) por `cues`, ya ordenados y sin solapes.
   * Se recortan al final de la pista principal: un subtítulo suelto no debe
   * alargar el proyecto por encima del vídeo.
   */
  setSubtitles(cues: { text: string; start: number; end: number; wordTimes?: [number, number][] }[], style: TextData) {
    this.commit();
    const track = this.subtitleTrack;
    const limit = this.videoTrack.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    if (limit > 0) {
      cues = cues
        .filter((c) => c.start < limit - MIN_CLIP)
        .map((c) => ({ ...c, end: Math.min(c.end, limit) }));
    }
    track.clips = cues.map((cue) => ({
      id: newId(),
      mediaPath: "",
      name: cue.text.split("\n")[0].trim() || "Subtítulo",
      kind: "text" as const,
      sourceDuration: Number.POSITIVE_INFINITY,
      fps: 30,
      start: cue.start,
      in: 0,
      out: Math.max(MIN_CLIP, cue.end - cue.start),
      text: { ...style, text: cue.text, wordTimes: cue.wordTimes },
    }));
    this.selectedId = null;
  }

  /** Cambia propiedades de un texto. Llamar a `commit()` antes del primer cambio de una edición. */
  updateText(id: string, patch: Partial<TextData>) {
    const ref = this.findClip(id);
    if (!ref?.clip.text) return;
    Object.assign(ref.clip.text, patch);
    if (patch.text !== undefined) ref.clip.name = patch.text.split("\n")[0].trim() || "Texto";
  }

  /**
   * Quita de la pista principal los tramos `[inicio, fin]` indicados (en tiempo de
   * timeline) y recompacta. Se usa para eliminar silencios automáticamente.
   * Devuelve los segundos eliminados.
   */
  removeRanges(ranges: [number, number][]): number {
    const track = this.videoTrack;
    if (track.clips.length === 0 || ranges.length === 0) return 0;
    // Fusionamos los rangos para poder recorrerlos una sola vez.
    const merged: [number, number][] = [];
    for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }

    this.commit();
    const out: Clip[] = [];
    let removed = 0;
    for (const clip of track.clips) {
      const from = clip.start;
      const to = clipEnd(clip);
      // Trozos del clip que sobreviven, en tiempo de timeline.
      let cursor = from;
      const keep: [number, number][] = [];
      for (const [s, e] of merged) {
        if (e <= cursor || s >= to) continue;
        if (s > cursor) keep.push([cursor, Math.min(s, to)]);
        cursor = Math.max(cursor, Math.min(e, to));
      }
      if (cursor < to) keep.push([cursor, to]);
      removed += to - from - keep.reduce((n, [s, e]) => n + (e - s), 0);
      for (const [s, e] of keep) {
        if (e - s < MIN_CLIP) continue;
        out.push({
          ...clip,
          id: out.length === 0 && s === from ? clip.id : newId(),
          in: clip.in + (s - from),
          out: clip.in + (e - from),
          start: s,
          // La transición solo tiene sentido en el último trozo del clip original.
          transition: e === to ? clip.transition : undefined,
          effects: clip.effects ? { preset: clip.effects.preset, adjust: { ...clip.effects.adjust } } : undefined,
        });
      }
    }
    track.clips = out;
    this.#relayout(track);

    // Lo que va encima o detrás del vídeo tiene que seguir al corte: si no,
    // una capa colocada en el segundo 8 se quedaría donde ya no hay nada.
    const quitadoAntes = (t: number) =>
      merged.reduce((n, [s, e]) => n + Math.max(0, Math.min(e, t) - Math.min(s, t)), 0);
    for (const otra of [...this.overlayTracks, this.backgroundTrack]) {
      for (const c of otra.clips) c.start = Math.max(0, c.start - quitadoAntes(c.start));
      this.#sort(otra);
    }

    this.selectedId = null;
    return removed;
  }

  /** Instantes de los cortes de la pista principal (el inicio de cada clip menos el primero). */
  cutPoints(): number[] {
    return this.videoTrack.clips.slice(1).map((c) => c.start);
  }

  /** Aplica un preset de efecto (o lo quita con null) al clip. */
  setEffect(clipId: string, presetId: string | null) {
    const ref = this.findClip(clipId);
    if (!ref || ref.clip.kind === "text") return;
    this.commit();
    const fx = ref.clip.effects ?? { preset: null, adjust: { ...DEFAULT_ADJUSTMENTS } };
    fx.preset = presetId;
    ref.clip.effects = fx.preset === null && isDefaultAdjust(fx.adjust) ? undefined : fx;
  }

  /** Enciende, apaga o ajusta la pantalla verde de un clip. */
  setChroma(clipId: string, patch: Partial<ChromaKey>) {
    const ref = this.findClip(clipId);
    if (!ref || ref.clip.kind === "text") return;
    const fx = ref.clip.effects ?? { preset: null, adjust: { ...DEFAULT_ADJUSTMENTS } };
    fx.chroma = { ...DEFAULT_CHROMA, ...fx.chroma, ...patch };
    ref.clip.effects = fx;
  }

  /** Cambia los ajustes manuales de color del clip. */
  setAdjust(clipId: string, patch: Partial<Adjustments>) {
    const ref = this.findClip(clipId);
    if (!ref || ref.clip.kind === "text") return;
    const fx = ref.clip.effects ?? { preset: null, adjust: { ...DEFAULT_ADJUSTMENTS } };
    fx.adjust = { ...fx.adjust, ...patch };
    ref.clip.effects = fx.preset === null && isDefaultAdjust(fx.adjust) ? undefined : fx;
  }

  /** Copia el efecto y los ajustes del clip a todos los de su pista. */
  applyEffectToAll(clipId: string) {
    const ref = this.findClip(clipId);
    if (!ref) return;
    this.commit();
    const fx = ref.clip.effects;
    for (const c of ref.track.clips) {
      c.effects = fx ? { preset: fx.preset, adjust: { ...fx.adjust } } : undefined;
    }
  }

  /** Pone (o quita, con `id` null) la transición entre `clipId` y el clip siguiente. */
  setTransition(clipId: string, id: string | null, duration = DEFAULT_TRANSITION_DURATION) {
    const ref = this.findClip(clipId);
    if (!ref || !ref.track.magnetic) return;
    this.commit();
    ref.clip.transition = id ? { id, duration: clamp(duration, TRANSITION_MIN, TRANSITION_MAX) } : undefined;
    this.#relayout(ref.track);
  }

  /** Aplica la misma transición a todos los cortes de la pista principal. */
  applyTransitionToAll(id: string | null, duration = DEFAULT_TRANSITION_DURATION) {
    const track = this.videoTrack;
    this.commit();
    track.clips.forEach((c, i) => {
      c.transition = id && i < track.clips.length - 1 ? { id, duration: clamp(duration, TRANSITION_MIN, TRANSITION_MAX) } : undefined;
    });
    this.#relayout(track);
  }

  /** Mueve un clip de una pista libre a `start`, evitando solapar otros clips. */
  moveClip(id: string, start: number) {
    const ref = this.findClip(id);
    if (!ref || ref.track.magnetic) return;
    ref.clip.start = this.#freeStart(ref.track, clipDuration(ref.clip), Math.max(0, start), id);
    this.#sort(ref.track);
  }

  /**
   * Reordena un clip de una pista magnética mientras se arrastra: `leftEdge` es
   * dónde queda su borde izquierdo (s). Cambia de sitio al pasar el centro de un vecino.
   */
  reorderClipAt(id: string, leftEdge: number) {
    const ref = this.findClip(id);
    if (!ref || !ref.track.magnetic) return;
    const { track, index } = ref;
    let acc = 0;
    let newIndex = 0;
    for (const c of track.clips) {
      if (c.id === id) continue;
      const d = clipDuration(c);
      if (acc + d / 2 < leftEdge) newIndex++;
      acc += d;
    }
    if (newIndex === index) return;
    const [clip] = track.clips.splice(index, 1);
    track.clips.splice(newIndex, 0, clip);
    this.#relayout(track);
  }

  /**
   * Cambia el punto de entrada. El borde izquierdo del clip se desplaza con él
   * (el contenido no se mueve en el timeline). Con `live` (durante el arrastre)
   * la pista magnética no se recompacta hasta la llamada final.
   */
  trimIn(id: string, newIn: number, live = false) {
    const ref = this.findClip(id);
    if (!ref) return;
    const { track, clip, index } = ref;
    const prev = track.clips[index - 1];
    const floor = !track.magnetic && prev ? clipEnd(prev) : 0;
    if (clip.kind === "text" || clip.kind === "image") {
      // Textos y parches no tienen "entrada": mover el borde izquierdo acorta la duración por delante.
      const newStart = clamp(clip.start + (newIn - clip.in), floor, clipEnd(clip) - MIN_CLIP);
      clip.out -= newStart - clip.start;
      clip.start = newStart;
      return;
    }
    let min = 0;
    if (!track.magnetic) {
      // El borde no puede invadir el clip anterior: start' = start + (in' - in) ≥ fin del anterior.
      min = Math.max(0, clip.in + floor - clip.start);
    }
    newIn = clamp(newIn, min, clip.out - MIN_CLIP);
    clip.start += newIn - clip.in;
    clip.in = newIn;
    if (track.magnetic && !live) this.#relayout(track);
  }

  /** Cambia el punto de salida (el borde derecho). */
  trimOut(id: string, newOut: number) {
    const ref = this.findClip(id);
    if (!ref) return;
    const { track, clip, index } = ref;
    let max = clip.sourceDuration;
    if (!track.magnetic) {
      const next = track.clips[index + 1];
      if (next) max = Math.min(max, clip.in + (next.start - clip.start));
    }
    clip.out = clamp(newOut, clip.in + MIN_CLIP, max);
    if (track.magnetic) this.#relayout(track);
  }

  /** Corta en el playhead: el clip seleccionado si lo atraviesa; si no, todos los clips bajo el playhead. */
  splitAtPlayhead(): boolean {
    const t = this.playhead;
    const canSplit = (c: Clip) => t > c.start + MIN_CLIP && t < clipEnd(c) - MIN_CLIP;
    let targets: ClipRef[] = [];
    if (this.selected && canSplit(this.selected.clip)) {
      targets = [this.selected];
    } else {
      for (const track of this.tracks) {
        const index = track.clips.findIndex(canSplit);
        if (index >= 0) targets.push({ track, clip: track.clips[index], index });
      }
    }
    if (targets.length === 0) return false;

    this.commit();
    let lastRight: Clip | null = null;
    for (const { track, clip, index } of targets) {
      const offset = t - clip.start;
      const right: Clip =
        clip.kind === "text"
          ? { ...clip, id: newId(), text: { ...clip.text! }, in: 0, out: clip.out - offset, start: t }
          : clip.kind === "image"
            ? { ...clip, id: newId(), patch: { ...clip.patch! }, in: 0, out: clip.out - offset, start: t }
            : { ...clip, id: newId(), in: clip.in + offset, start: t };
      clip.out = clip.in + offset;
      // La transición hacia el siguiente clip se queda con la parte derecha.
      if (clip.transition) clip.transition = undefined;
      track.clips.splice(index + 1, 0, right);
      lastRight = right;
    }
    // Tras cortar queda seleccionada la parte derecha: "corta aquí y borra el resto".
    this.selectedId = targets.length === 1 && lastRight ? lastRight.id : null;
    return true;
  }

  deleteSelected(): boolean {
    const ref = this.selected;
    if (!ref) return false;
    this.commit();
    ref.track.clips.splice(ref.index, 1);
    if (ref.track.magnetic) this.#relayout(ref.track);
    this.selectedId = null;
    return true;
  }

  // ---- Transporte ----

  setPlayhead(t: number) {
    this.playhead = Math.max(0, t);
  }

  togglePlay() {
    if (this.playing) {
      this.playing = false;
      return;
    }
    if (this.duration <= 0) return;
    if (this.playhead >= this.duration - EPS) this.playhead = 0;
    this.playing = true;
  }

  stepFrames(n: number) {
    this.playing = false;
    const fps = this.fpsAt(n < 0 ? this.playhead - EPS : this.playhead);
    this.setPlayhead((Math.round(this.playhead * fps) + n) / fps);
  }

  nudge(sec: number) {
    this.playing = false;
    this.setPlayhead(this.playhead + sec);
  }

  setZoom(z: number) {
    this.zoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
  }

  // ---- Internos ----

  /** Pista magnética: recoloca los clips pegados en orden desde 0, solapando las transiciones. */
  #relayout(track: Track) {
    let t = 0;
    track.clips.forEach((c, i) => {
      const prev = track.clips[i - 1];
      if (prev) t -= effectiveTransition(prev, c);
      c.start = t;
      t += clipDuration(c);
    });
  }

  #sort(track: Track) {
    track.clips.sort((a, b) => a.start - b.start);
  }

  #trackEnd(track: Track): number {
    return track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  }

  /** Índice de inserción en una pista magnética para el instante `t`. */
  #indexAt(track: Track, t: number): number {
    let i = 0;
    for (const c of track.clips) if (c.start + clipDuration(c) / 2 < t) i++;
    return i;
  }

  /** Posición libre más cercana a `candidate` en una pista libre, sin solapar otros clips. */
  #freeStart(track: Track, dur: number, candidate: number, excludeId?: string): number {
    const others = track.clips.filter((c) => c.id !== excludeId).sort((a, b) => a.start - b.start);
    let best = Math.max(0, candidate);
    let bestDist = Infinity;
    let gapStart = 0;
    for (let i = 0; i <= others.length; i++) {
      const gapEnd = i < others.length ? others[i].start : Infinity;
      if (gapEnd - gapStart >= dur - EPS) {
        const pos = clamp(candidate, gapStart, gapEnd - dur);
        const dist = Math.abs(pos - candidate);
        if (dist < bestDist) {
          best = pos;
          bestDist = dist;
        }
      }
      if (i < others.length) gapStart = Math.max(gapStart, clipEnd(others[i]));
    }
    return best;
  }
}

export const project = new ProjectStore();
