import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_LAYOUT } from "$lib/layers";
import { mediaSrc } from "$lib/tauri/media";
import { segmenter } from "./segmenter.svelte";
import type { Clip, FrameSize } from "$lib/project.svelte";

/**
 * Recorte de personas para la exportación: recorre el clip frame a frame,
 * pide la silueta al segmentador y la guarda como secuencia PNG en gris.
 * ffmpeg la usa luego como canal alfa (`alphamerge`), así que lo que se ve
 * en el vídeo final es exactamente lo mismo que en el preview.
 */
export interface MaskSequence {
  pattern: string;
  fps: number;
  start: number;
}

/** El modelo trabaja a 256 px: por encima de esto la máscara ya no gana detalle. */
const MASK_LONG_SIDE = 512;

function wait(el: HTMLVideoElement, event: string, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const limpiar = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fallo);
      clearTimeout(timer);
    };
    const ok = () => (limpiar(), resolve());
    const fallo = () => (limpiar(), reject(new Error("No se pudo leer el vídeo del recorte")));
    const timer = setTimeout(ok, ms); // Si el vídeo se atasca seguimos con lo que haya.
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", fallo, { once: true });
  });
}

/** Recorte "cover"/"contain" de la máscara dentro de la caja, como hace el preview. */
function fitRect(sw: number, sh: number, dw: number, dh: number, fit: string) {
  const escala = fit === "contain" ? Math.min(dw / sw, dh / sh) : Math.max(dw / sw, dh / sh);
  const w = sw * escala;
  const h = sh * escala;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

/**
 * Genera una secuencia por clip con recorte. Los segmentos se numeran a partir
 * de `firstSegment` porque comparten carpeta temporal con las capas de texto.
 */
export async function renderCutoutMasks(
  clips: Clip[],
  base: string,
  firstSegment: number,
  size: FrameSize,
  fit: string,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<Map<string, MaskSequence>> {
  const out = new Map<string, MaskSequence>();
  if (clips.length === 0) return out;
  if (!(await segmenter.load())) throw new Error(segmenter.error ?? "No se pudo cargar el recorte");

  const fps = size.fps;
  // La máscara mantiene la proporción del frame; el lado largo manda.
  const largo = Math.max(size.width, size.height);
  const mw = Math.max(2, Math.round((size.width / largo) * MASK_LONG_SIDE));
  const mh = Math.max(2, Math.round((size.height / largo) * MASK_LONG_SIDE));

  const lienzo = document.createElement("canvas");
  lienzo.width = mw;
  lienzo.height = mh;
  const ctx = lienzo.getContext("2d")!;
  const fuente = document.createElement("canvas");
  const fctx = fuente.getContext("2d")!;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const totalFrames = clips.reduce((n, c) => n + Math.ceil((c.out - c.in) * fps), 0);
  let hechos = 0;

  try {
    for (const [k, clip] of clips.entries()) {
      const segmento = firstSegment + k;
      const feather = clip.layout?.feather ?? DEFAULT_LAYOUT.feather;
      const half = Math.max(feather * 0.5, 0.01);
      const lo = 0.5 - half;
      const alto = 0.5 + half;

      video.src = mediaSrc(clip.mediaPath);
      video.load();
      await wait(video, "loadeddata");

      const frames = Math.ceil((clip.out - clip.in) * fps);
      for (let i = 0; i < frames; i++) {
        if (isCancelled()) throw new Error("Exportación cancelada");
        video.currentTime = clip.in + (i + 0.5) / fps;
        await wait(video, "seeked", 4000);
        const mask = segmenter.segment(video);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, mw, mh);
        if (mask) {
          // Gris = alfa. Mismo suavizado que el shader del preview.
          if (fuente.width !== mask.width || fuente.height !== mask.height) {
            fuente.width = mask.width;
            fuente.height = mask.height;
          }
          const img = fctx.createImageData(mask.width, mask.height);
          const px = img.data;
          for (let j = 0; j < mask.data.length; j++) {
            const t = Math.min(1, Math.max(0, (mask.data[j] - lo) / (alto - lo)));
            const v = Math.round(t * t * (3 - 2 * t) * 255); // smoothstep
            const o = j * 4;
            px[o] = px[o + 1] = px[o + 2] = v;
            px[o + 3] = 255;
          }
          fctx.putImageData(img, 0, 0);
          const r = fitRect(mask.width, mask.height, mw, mh, fit);
          ctx.drawImage(fuente, r.x, r.y, r.w, r.h);
        }
        const blob = await new Promise<Blob>((resolve, reject) =>
          lienzo.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo codificar la máscara"))), "image/png"),
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await invoke("export_write_frame", bytes, {
          headers: { "x-segment": String(segmento), "x-frame": String(i) },
        });
        onProgress(++hechos / totalFrames);
      }
      out.set(clip.id, { pattern: `${base}/${segmento}/%05d.png`, fps, start: clip.start });
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
  return out;
}
