import type { MediaInfo } from "$lib/tauri/media";
import { DEFAULT_TEXT, TEXT_DEFAULT_DURATION, type TextData } from "$lib/text/styles";
import type { FrameSize } from "$lib/text/layout";

export type { FrameSize };
export type TrackKind = "video" | "audio" | "text";

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

class ProjectStore {
  media = $state<MediaInfo[]>([]);
  tracks = $state<Track[]>([
    { id: "t1", kind: "text", name: "T1", magnetic: false, clips: [] },
    { id: "v1", kind: "video", name: "V1", magnetic: true, clips: [] },
    { id: "a1", kind: "audio", name: "A1", magnetic: false, clips: [] },
  ]);
  playhead = $state(0);
  playing = $state(false);
  /** Píxeles por segundo. */
  zoom = $state(60);
  selectedId = $state<string | null>(null);
  /** true mientras se reordena un clip arrastrándolo (los demás se animan al hacerle sitio). */
  reordering = $state(false);
  canUndo = $state(false);
  canRedo = $state(false);

  #past: { tracks: Track[]; json: string }[] = [];
  #future: { tracks: Track[]; json: string }[] = [];

  duration = $derived(
    this.tracks.reduce((max, t) => t.clips.reduce((m, c) => Math.max(m, clipEnd(c)), max), 0),
  );
  clipCount = $derived(this.tracks.reduce((n, t) => n + t.clips.length, 0));
  videoTrack = $derived(this.tracks.find((t) => t.kind === "video")!);
  audioTrack = $derived(this.tracks.find((t) => t.kind === "audio")!);
  textTrack = $derived(this.tracks.find((t) => t.kind === "text")!);
  selected = $derived.by(() => (this.selectedId ? this.findClip(this.selectedId) : null));
  /** Tamaño del frame del proyecto: el mayor de los clips de vídeo (ya rotados); 1080p si no hay. */
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
    return best ?? DEFAULT_FRAME;
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
    if (!(info.durationSec > 0)) return null;
    const kind: TrackKind = info.video ? "video" : "audio";
    const track = this.tracks.find((t) => t.kind === kind);
    if (!track) return null;
    const clip: Clip = {
      id: newId(),
      mediaPath: info.path,
      name: info.fileName,
      kind,
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

  /** Cambia propiedades de un texto. Llamar a `commit()` antes del primer cambio de una edición. */
  updateText(id: string, patch: Partial<TextData>) {
    const ref = this.findClip(id);
    if (!ref?.clip.text) return;
    Object.assign(ref.clip.text, patch);
    if (patch.text !== undefined) ref.clip.name = patch.text.split("\n")[0].trim() || "Texto";
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
    if (clip.kind === "text") {
      // Los textos no tienen "entrada": mover el borde izquierdo acorta la duración por delante.
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
          : { ...clip, id: newId(), in: clip.in + offset, start: t };
      clip.out = clip.in + offset;
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

  /** Pista magnética: recoloca los clips pegados en orden desde 0. */
  #relayout(track: Track) {
    let t = 0;
    for (const c of track.clips) {
      c.start = t;
      t += clipDuration(c);
    }
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
