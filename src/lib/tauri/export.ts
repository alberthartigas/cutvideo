import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { project, type Clip } from "$lib/project.svelte";

// Espejo de src-tauri/src/export.rs.
export interface ExportClip {
  path: string;
  in: number;
  out: number;
  start: number;
  hasAudio: boolean;
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

export interface FrameSize {
  width: number;
  height: number;
  fps: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Tamaño "original": el del primer clip de vídeo, ya rotado según sus metadatos. */
export function originalSize(): FrameSize | null {
  const first = project.videoTrack.clips[0];
  if (!first) return null;
  const v = project.mediaOf(first)?.video;
  if (!v || !v.width || !v.height) return null;
  const rotated = v.rotation % 180 !== 0;
  return {
    width: even(rotated ? v.height : v.width),
    height: even(rotated ? v.width : v.height),
    fps: v.fps || 30,
  };
}

/** Escala manteniendo la proporción para que el lado corto mida `shortSide` (null = original). */
export function targetSize(orig: FrameSize, shortSide: number | null): FrameSize {
  if (!shortSide) return orig;
  const scale = shortSide / Math.min(orig.width, orig.height);
  return { width: even(orig.width * scale), height: even(orig.height * scale), fps: orig.fps };
}

export function buildExportPlan(output: string, size: FrameSize, encoder: ExportEncoder): ExportPlan {
  const toClip = (c: Clip): ExportClip => ({
    path: c.mediaPath,
    in: c.in,
    out: c.out,
    start: c.start,
    hasAudio: project.mediaOf(c)?.audio != null,
  });
  return {
    output,
    width: size.width,
    height: size.height,
    fps: Math.round(size.fps * 1000) / 1000,
    video: project.videoTrack.clips.map(toClip),
    audio: project.audioTrack.clips.map(toClip),
    encoder,
  };
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
