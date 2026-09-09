import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// Espejo de las structs de src-tauri/src/media.rs (serde rename_all = camelCase).
export interface VideoStream {
  codec: string;
  codecLong: string;
  width: number;
  height: number;
  fps: number;
  pixFmt: string | null;
  rotation: number;
  frameCount: number | null;
}

export interface AudioStream {
  codec: string;
  codecLong: string;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
}

export interface MediaInfo {
  path: string;
  fileName: string;
  container: string;
  durationSec: number;
  sizeBytes: number;
  bitRate: number | null;
  video: VideoStream | null;
  audio: AudioStream | null;
  videoStreamCount: number;
  audioStreamCount: number;
  /** true para imágenes y stickers: van a la pista de parches. */
  isImage: boolean;
}

export const VIDEO_EXTENSIONS = [
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "ts", "3gp", "wmv", "flv", "mxf", "gif",
];
export const AUDIO_EXTENSIONS = ["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "aiff"];
/** Parches: imágenes, stickers de WhatsApp (.webp) y PDF. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "heic", "pdf"];

/** Abre el diálogo nativo y devuelve las rutas elegidas (vacío si se cancela). */
export async function pickMediaFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    directory: false,
    title: "Importar medios",
    filters: [
      { name: "Vídeo", extensions: VIDEO_EXTENSIONS },
      { name: "Audio", extensions: AUDIO_EXTENSIONS },
      { name: "Imágenes y stickers", extensions: IMAGE_EXTENSIONS },
      { name: "Todos los archivos", extensions: ["*"] },
    ],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export function probeMedia(path: string): Promise<MediaInfo> {
  return invoke<MediaInfo>("probe_media", { path });
}

/** Archivos pasados por línea de comandos al abrir la app. */
export function startupFiles(): Promise<string[]> {
  return invoke<string[]>("startup_files");
}

export function ffmpegVersion(): Promise<string> {
  return invoke<string>("ffmpeg_version");
}

/** URL `asset://` que el WebView puede usar en <video src>. */
export function mediaSrc(path: string): string {
  return convertFileSrc(path);
}
