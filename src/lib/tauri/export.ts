import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { clipEnd, effectiveTransition, project, type Clip, type FrameSize } from "$lib/project.svelte";
import { renderTextClips } from "$lib/text/render";
import { getTransition } from "$lib/transitions/presets";
import { effectsFfmpeg } from "$lib/effects/presets";
import { chromaFfmpeg } from "$lib/effects/chroma";
import { drawPatches, loadPatchImages } from "$lib/patches/render";
import { renderCutoutMasks, type MaskSequence } from "$lib/segment/masks";
import { DEFAULT_LAYOUT } from "$lib/layers";

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
  /** Cadena de filtros de color de ffmpeg, o null. */
  filters?: string | null;
  /** Cadena de filtros de pantalla verde, o null. */
  chroma?: string | null;
}

export interface ExportOverlay {
  pattern: string;
  fps: number;
  start: number;
}

export interface ExportLayer {
  clip: ExportClip;
  layout: { x: number; y: number; scale: number; opacity: number };
  /** Secuencia PNG en gris con la silueta de la persona, o null. */
  mask?: MaskSequence | null;
}

/** Todo lo que hay que renderizar antes de llamar a ffmpeg. */
export interface OverlayAssets {
  overlays: ExportOverlay[];
  masks: Map<string, MaskSequence>;
}

export const NO_ASSETS: OverlayAssets = { overlays: [], masks: new Map() };

export type ExportEncoder = "auto" | "x264";

export interface ExportPlan {
  output: string;
  width: number;
  height: number;
  fps: number;
  video: ExportClip[];
  audio: ExportClip[];
  background: ExportClip[];
  encoder: ExportEncoder;
  fit: "cover" | "contain";
  overlays: ExportOverlay[];
  layers: ExportLayer[];
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
/** Presets por lado corto, del más grande al más pequeño. */
export const RESOLUTIONS: { shortSide: number; label: string; hint: string }[] = [
  { shortSide: 2160, label: "4K", hint: "Máxima calidad, archivos grandes" },
  { shortSide: 1440, label: "2K", hint: "Muy buena calidad" },
  { shortSide: 1080, label: "1080p", hint: "Lo habitual en redes" },
  { shortSide: 720, label: "720p", hint: "Ligero" },
  { shortSide: 480, label: "480p", hint: "Muy ligero" },
];

export function targetSize(orig: FrameSize, shortSide: number | null): FrameSize {
  if (!shortSide) return orig;
  const scale = shortSide / Math.min(orig.width, orig.height);
  return { width: even(orig.width * scale), height: even(orig.height * scale), fps: orig.fps };
}

/** Clips de las capas superpuestas, de abajo arriba (O2 primero, O1 encima). */
export function overlayLayerClips(): Clip[] {
  return [...project.overlayTracks].reverse().flatMap((t) => t.clips);
}

/** Clips de capa que llevan recorte de persona activado. */
export function cutoutClips(): Clip[] {
  return overlayLayerClips().filter((c) => c.layout?.cutout);
}

export function buildExportPlan(
  output: string,
  size: FrameSize,
  encoder: ExportEncoder,
  assets: OverlayAssets,
): ExportPlan {
  const toClip = (c: Clip): ExportClip => ({
    path: c.mediaPath,
    in: c.in,
    out: c.out,
    start: c.start,
    hasAudio: project.mediaOf(c)?.audio != null && !c.muted,
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
      const filters = effectsFfmpeg(c.effects, size.height);
      const chroma = chromaFfmpeg(c.effects?.chroma);
      return {
        ...toClip(c),
        transition: preset && duration > 0 ? { xfade: preset.xfade, duration } : null,
        filters: filters || null,
        chroma: chroma || null,
      };
    }),
    background: project.backgroundTrack.clips.map((c) => ({
      ...toClip(c),
      filters: effectsFfmpeg(c.effects, size.height) || null,
    })),
    audio: project.audioTrack.clips.map(toClip),
    layers: overlayLayerClips().map((c): ExportLayer => {
      const l = { ...DEFAULT_LAYOUT, ...c.layout };
      return {
        clip: {
          ...toClip(c),
          hasAudio: project.mediaOf(c)?.audio != null && !c.muted,
          filters: effectsFfmpeg(c.effects, size.height) || null,
          chroma: chromaFfmpeg(c.effects?.chroma) || null,
        },
        layout: { x: l.x, y: l.y, scale: l.scale, opacity: l.opacity },
        mask: assets.masks.get(c.id) ?? null,
      };
    }),
    encoder,
    fit: project.fit,
    overlays: assets.overlays,
  };
}

/** Intervalos [inicio, fin] donde hay algo que dibujar encima, fusionando los que se tocan. */
function overlaySegments(clips: Clip[]): [number, number][] {
  const spans = clips
    .filter((c) => c.text || c.patch)
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
 * Renderiza a PNG todo lo que ffmpeg no sabe hacer: las siluetas de los
 * recortes de persona y las capas de texto y parches. Comparten carpeta
 * temporal, así que las máscaras ocupan los primeros segmentos.
 */
export async function renderOverlayAssets(
  size: FrameSize,
  onProgress: (stage: "mask" | "text", fraction: number) => void,
  isCancelled: () => boolean,
): Promise<OverlayAssets> {
  const textClips = project.textClips;
  const patchClips = project.patchTrack.clips;
  const segments = overlaySegments([...patchClips, ...textClips]);
  const recortes = cutoutClips();
  if (segments.length === 0 && recortes.length === 0) return NO_ASSETS;

  const base = await invoke<string>("export_overlay_begin");
  const masks = await renderCutoutMasks(
    recortes,
    0,
    size,
    project.fit,
    (f) => onProgress("mask", f),
    isCancelled,
  );
  if (segments.length === 0) return { overlays: [], masks };

  // Los parches se dibujan en la misma capa que los textos: así la posición,
  // el giro y el seguimiento salen exactamente igual que en el preview.
  const images = await loadPatchImages(patchClips);
  const fps = size.fps;
  // Dos lienzos que se van turnando: mientras uno se comprime a PNG y se
  // escribe, el otro ya está dibujando el fotograma siguiente. Cada capa de
  // texto es un archivo suelto, así que no importa en qué orden se escriban.
  const lienzos = [0, 1].map(() => {
    const c = document.createElement("canvas");
    c.width = size.width;
    c.height = size.height;
    return { canvas: c, ctx: c.getContext("2d")! };
  });
  const trabajos: (Promise<void> | null)[] = [null, null];

  const ranges = segments.map(([s, e]) => ({ from: Math.floor(s * fps), to: Math.ceil(e * fps) }));
  const total = ranges.reduce((n, r) => n + (r.to - r.from), 0);
  let done = 0;
  const overlays: ExportOverlay[] = [];

  const escribir = async (canvas: HTMLCanvasElement, segmento: number, frame: number) => {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo codificar el PNG"))), "image/png"),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await invoke("export_write_frame", bytes, {
      headers: { "x-segment": String(segmento), "x-frame": String(frame) },
    });
    onProgress("text", ++done / total);
  };

  try {
    for (const [k, r] of ranges.entries()) {
      for (let i = 0; i < r.to - r.from; i++) {
        if (isCancelled()) throw new Error("Exportación cancelada");
        const turno = i % 2;
        // Ese lienzo no se puede tocar hasta que se haya escrito lo anterior.
        if (trabajos[turno]) await trabajos[turno];
        const { canvas, ctx } = lienzos[turno];
        // Muestreamos en el centro del frame, igual que hará el vídeo.
        const t = (r.from + i + 0.5) / fps;
        ctx.clearRect(0, 0, size.width, size.height);
        drawPatches(ctx, patchClips, images, t, size);
        renderTextClips(ctx, textClips, t, size, false);
        trabajos[turno] = escribir(canvas, recortes.length + k, i);
      }
      await Promise.all(trabajos);
      trabajos[0] = trabajos[1] = null;
      overlays.push({ pattern: `${base}/${recortes.length + k}/%05d.png`, fps, start: r.from / fps });
    }
  } finally {
    await Promise.allSettled(trabajos);
  }
  return { overlays, masks };
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
