import { clipEnd, project, type Clip } from "$lib/project.svelte";
import { mediaSrc } from "$lib/tauri/media";
import type { PatchTrack } from "./types";

/**
 * Seguimiento de objetos por plantilla: toma un recorte del vídeo justo debajo
 * del parche y lo busca en los frames siguientes, quedándose con la posición
 * que más se le parece.
 *
 * No usa ningún modelo ni descarga nada: funciona sin conexión y sirve para
 * cualquier cosa (una cabeza, un coche, un cartel). A cambio, si el objeto se
 * tapa, sale de cuadro o cambia mucho de aspecto, el seguimiento se pierde.
 */

/** Resolución a la que se analiza: suficiente para seguir y rápido de procesar. */
const WORK_W = 320;
/** Muestras por segundo (se interpolan al reproducir). */
export const TRACK_FPS = 10;
/** Radio de búsqueda alrededor de la última posición, en píxeles de trabajo. */
const SEARCH = 22;

interface Gray {
  data: Float32Array;
  w: number;
  h: number;
}

function toGray(ctx: CanvasRenderingContext2D, w: number, h: number): Gray {
  const src = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    data[p] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  }
  return { data, w, h };
}

/** Recorta una plantilla centrada en (cx, cy). */
function cutTemplate(img: Gray, cx: number, cy: number, size: number): Gray | null {
  const half = Math.floor(size / 2);
  const x0 = Math.round(cx) - half;
  const y0 = Math.round(cy) - half;
  if (x0 < 0 || y0 < 0 || x0 + size > img.w || y0 + size > img.h) return null;
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[y * size + x] = img.data[(y0 + y) * img.w + x0 + x];
    }
  }
  return { data, w: size, h: size };
}

/** Media y desviación de una plantilla, para la correlación normalizada. */
function stats(t: Gray) {
  let sum = 0;
  for (const v of t.data) sum += v;
  const mean = sum / t.data.length;
  let acc = 0;
  for (const v of t.data) acc += (v - mean) * (v - mean);
  return { mean, norm: Math.sqrt(acc) || 1 };
}

/**
 * Correlación cruzada normalizada de `tpl` sobre `img` alrededor de (cx, cy).
 * Devuelve el mejor centro y su parecido (0–1).
 */
function match(
  img: Gray,
  tpl: Gray,
  ts: { mean: number; norm: number },
  cx: number,
  cy: number,
  radius: number,
  step: number,
): { x: number; y: number; score: number } {
  const half = Math.floor(tpl.w / 2);
  let best = { x: cx, y: cy, score: -1 };
  for (let dy = -radius; dy <= radius; dy += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      const x0 = Math.round(cx + dx) - half;
      const y0 = Math.round(cy + dy) - half;
      if (x0 < 0 || y0 < 0 || x0 + tpl.w > img.w || y0 + tpl.h > img.h) continue;
      let sum = 0;
      for (let y = 0; y < tpl.h; y++) {
        const row = (y0 + y) * img.w + x0;
        for (let x = 0; x < tpl.w; x++) sum += img.data[row + x];
      }
      const mean = sum / (tpl.w * tpl.h);
      let num = 0;
      let den = 0;
      for (let y = 0; y < tpl.h; y++) {
        const row = (y0 + y) * img.w + x0;
        const trow = y * tpl.w;
        for (let x = 0; x < tpl.w; x++) {
          const a = img.data[row + x] - mean;
          num += a * (tpl.data[trow + x] - ts.mean);
          den += a * a;
        }
      }
      const score = num / (Math.sqrt(den || 1) * ts.norm);
      if (score > best.score) best = { x: cx + dx, y: cy + dy, score };
    }
  }
  return best;
}

/** Coloca el vídeo en `t` y espera a que el frame esté listo. */
function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = t;
    // Si el vídeo ya estaba ahí, `seeked` no salta.
    setTimeout(done, 500);
  });
}

export interface TrackResult {
  track: PatchTrack;
  /** Parecido medio (0–1): por debajo de 0,5 conviene revisar el resultado. */
  confidence: number;
  /** Instante donde el seguimiento se perdió, si se perdió. */
  lostAt: number | null;
}

/**
 * Sigue lo que hay bajo el parche durante toda su duración.
 * `onProgress` recibe 0–1.
 */
export async function trackPatch(
  patchClip: Clip,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<TrackResult> {
  const patch = patchClip.patch;
  if (!patch) throw new Error("Ese clip no es un parche");

  const from = patchClip.start;
  const to = clipEnd(patchClip);
  // El objeto que se sigue está en el vídeo de la pista principal.
  const source = project.clipAt(project.videoTrack, from) ?? project.videoTrack.clips[0];
  if (!source) throw new Error("No hay vídeo debajo del parche para seguir");

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = mediaSrc(source.mediaPath);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("No se pudo leer el vídeo para seguir el objeto"));
  });

  const w = WORK_W;
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const grab = async (timelineT: number): Promise<Gray> => {
    // Del tiempo de timeline al tiempo dentro del archivo de origen.
    await seek(video, source.in + (timelineT - source.start));
    ctx.drawImage(video, 0, 0, w, h);
    return toGray(ctx, w, h);
  };

  const size = Math.max(16, Math.round(w * Math.min(patch.width, 0.35) * 0.9) | 1);
  const points: [number, number][] = [];
  const scales: number[] = [];
  let scoreSum = 0;
  let lostAt: number | null = null;

  const total = Math.max(1, Math.round((to - from) * TRACK_FPS));
  let cx = patch.x * w;
  let cy = patch.y * h;
  let first = await grab(from);
  let tpl = cutTemplate(first, cx, cy, size);
  if (!tpl) throw new Error("Coloca el parche más dentro del cuadro para poder seguirlo");
  let ts = stats(tpl);

  for (let i = 0; i < total; i++) {
    if (isCancelled()) throw new Error("Seguimiento cancelado");
    const t = from + i / TRACK_FPS;
    const img = i === 0 ? first : await grab(t);
    if (i > 0) {
      // Primero una pasada gruesa y luego una fina: mismo resultado, mucho más rápido.
      const coarse = match(img, tpl, ts, cx, cy, SEARCH, 2);
      const fine = match(img, tpl, ts, coarse.x, coarse.y, 2, 1);
      const best = fine.score >= coarse.score ? fine : coarse;
      if (best.score < 0.45 && lostAt === null) lostAt = t;
      cx = best.x;
      cy = best.y;
      scoreSum += Math.max(0, best.score);
      // La plantilla se actualiza poco a poco para aguantar cambios de luz o giro.
      if (best.score > 0.6) {
        const fresh = cutTemplate(img, cx, cy, size);
        if (fresh) {
          for (let k = 0; k < tpl.data.length; k++) {
            tpl.data[k] = tpl.data[k] * 0.85 + fresh.data[k] * 0.15;
          }
          ts = stats(tpl);
        }
      }
    } else {
      scoreSum += 1;
    }
    points.push([cx / w, cy / h]);
    scales.push(1);
    onProgress((i + 1) / total);
  }

  video.removeAttribute("src");
  video.load();
  return {
    track: { start: from, fps: TRACK_FPS, points, scales },
    confidence: scoreSum / total,
    lostAt,
  };
}
