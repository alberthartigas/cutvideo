import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { clipEnd, effectiveTransition, project, type Clip, type FrameSize } from "$lib/project.svelte";
import { renderTextClips } from "$lib/text/render";
import { getTransition } from "$lib/transitions/presets";

export type { FrameSize };

// Espejo de src-tauri/src/export.rs.
export interface ExportClip {
  path: string;
  in: number;
  out: number;
  start: number;
  hasAudio: boolean;
  /** Transición hacia el clip siguiente (solo pista principal). */
  transition?: { xfade: string; duration: number } | null;
}

export interface ExportOverlay {
  pattern: string;
  fps: number;
  start: number;
}

export type ExportEncoder = "auto" | "x264";

export interface ExportPlan {
  output: string;
  width: number;
  height: number;
  fps: number;
  video: ExportClip[];
  audio: ExportClip[];
  encoder: ExportEncoder;
  overlays: ExportOverlay[];
}

export interface ExportProgress {
  percent: number;
  outTime: number;
  speed: number | null;
}

export interface ExportResult {
  output: string;
  encoder: string;
  seconds: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Tamaño "original" del proyecto, o null si no hay clips de vídeo. */
export function originalSize(): FrameSize | null {
  return project.videoTrack.clips.length ? project.frame : null;
}

/** Escala manteniendo la proporción para que el lado corto mida `shortSide` (null = original). */
export function targetSize(orig: FrameSize, shortSide: number | null): FrameSize {
  if (!shortSide) return orig;
  const scale = shortSide / Math.min(orig.width, orig.height);
  return { width: even(orig.width * scale), height: even(orig.height * scale), fps: orig.fps };
}

export function buildExportPlan(
  output: string,
  size: FrameSize,
  encoder: ExportEncoder,
  overlays: ExportOverlay[],
): ExportPlan {
  const toClip = (c: Clip): ExportClip => ({
    path: c.mediaPath,
    in: c.in,
    out: c.out,
    start: c.start,
    hasAudio: project.mediaOf(c)?.audio != null,
  });
  const videoClips = project.videoTrack.clips;
  return {
    output,
    width: size.width,
    height: size.height,
    fps: Math.round(size.fps * 1000) / 1000,
    video: videoClips.map((c, i) => {
      const next = videoClips[i + 1];
      const preset = c.transition ? getTransition(c.transition.id) : null;
      const duration = next ? effectiveTransition(c, next) : 0;
      return { ...toClip(c), transition: preset && duration > 0 ? { xfade: preset.xfade, duration } : null };
    }),
    audio: project.audioTrack.clips.map(toClip),
    encoder,
    overlays,
  };
}

/** Intervalos [inicio, fin] donde hay algún texto, fusionando los que se tocan. */
function textSegments(clips: Clip[]): [number, number][] {
  const spans = clips
    .filter((c) => c.text)
    .map((c): [number, number] => [c.start, clipEnd(c)])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1e-6) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Renderiza los textos a secuencias PNG con alfa (una por tramo con texto) y las
 * deja en una carpeta temporal para que ffmpeg las superponga. Devuelve las capas.
 */
export async function renderTextOverlays(
  size: FrameSize,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<ExportOverlay[]> {
  const clips = project.textClips;
  const segments = textSegments(clips);
  if (segments.length === 0) return [];

  const base = await invoke<string>("export_overlay_begin");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d")!;
  const fps = size.fps;

  const ranges = segments.map(([s, e]) => ({ from: Math.floor(s * fps), to: Math.ceil(e * fps) }));
  const total = ranges.reduce((n, r) => n + (r.to - r.from), 0);
  let done = 0;
  const overlays: ExportOverlay[] = [];

  for (const [k, r] of ranges.entries()) {
    for (let i = 0; i < r.to - r.from; i++) {
      if (isCancelled()) throw new Error("Exportación cancelada");
      // Muestreamos en el centro del frame, igual que hará el vídeo.
      renderTextClips(ctx, clips, (r.from + i + 0.5) / fps, size);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo codificar el PNG"))), "image/png"),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await invoke("export_write_frame", bytes, { headers: { "x-segment": String(k), "x-frame": String(i) } });
      onProgress(++done / total);
    }
    overlays.push({ pattern: `${base}/${k}/%05d.png`, fps, start: r.from / fps });
  }
  return overlays;
}

export function endTextOverlays(): Promise<void> {
  return invoke<void>("export_overlay_end");
}

export function exportVideo(plan: ExportPlan): Promise<ExportResult> {
  return invoke<ExportResult>("export_video", { plan });
}

export function cancelExport(): Promise<void> {
  return invoke<void>("cancel_export");
}

export function onExportProgress(cb: (p: ExportProgress) => void): Promise<UnlistenFn> {
  return listen<ExportProgress>("export:progress", (e) => cb(e.payload));
}

/** Diálogo nativo "Guardar como". Devuelve null si se cancela. */
export async function pickOutputPath(defaultName: string): Promise<string | null> {
  const path = await save({
    title: "Exportar vídeo",
    defaultPath: defaultName,
    filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
  });
  if (!path) return null;
  return /\.mp4$/i.test(path) ? path : `${path}.mp4`;
}

export function revealInFolder(path: string): Promise<void> {
  return revealItemInDir(path);
}
