import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_LAYOUT } from "$lib/layers";
import { mediaSrc } from "$lib/tauri/media";
import { segmenter } from "./segmenter.svelte";
import type { Clip, FrameSize } from "$lib/project.svelte";

/**
 * Recorte de personas para la exportación: recorre el clip fotograma a
 * fotograma, pide la silueta al segmentador y la escribe como bytes en gris
 * (uno por píxel, sin comprimir). ffmpeg lee ese flujo como `rawvideo` y lo
 * usa de canal alfa, así que el vídeo final sale igual que el preview.
 *
 * Se escribe en crudo a propósito: comprimir cada silueta a PNG costaba más
 * que buscar el fotograma y pasar la IA juntos, y aquí no hace falta, porque
 * el archivo es temporal y se borra al acabar.
 */
export interface MaskSequence {
  /** Segmento dentro de la carpeta temporal; el backend arma la ruta. */
  segment: number;
  fps: number;
  width: number;
  height: number;
}

/** El modelo trabaja a 256 px: por encima de esto la máscara ya no gana detalle. */
const MASK_LONG_SIDE = 512;

/**
 * Espera a un evento del vídeo. Con `estricto` un plantón es un error (no se
 * puede recortar lo que no carga); sin él seguimos con el fotograma que haya,
 * que es lo suyo cuando una búsqueda concreta se atasca.
 */
function wait(el: HTMLVideoElement, event: string, ms: number, estricto = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const limpiar = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fallo);
      clearTimeout(timer);
    };
    const ok = () => (limpiar(), resolve());
    const fallo = () => (limpiar(), reject(new Error("No se pudo leer el vídeo del recorte")));
    const timer = setTimeout(estricto ? fallo : ok, ms);
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
 * Genera una silueta por clip con recorte. Los segmentos se numeran a partir
 * de `firstSegment` porque comparten carpeta temporal con las capas de texto.
 */
export async function renderCutoutMasks(
  clips: Clip[],
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

  // El fotograma se reduce aquí, con el mismo encaje que usa el preview. Así
  // la silueta sale ya del tamaño final y no hay que reescalarla después.
  const lienzo = document.createElement("canvas");
  lienzo.width = mw;
  lienzo.height = mh;
  const ctx = lienzo.getContext("2d")!;
  const gris = new Uint8Array(mw * mh);

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const totalFrames = clips.reduce((n, c) => n + Math.ceil((c.out - c.in) * fps), 0);
  let hechos = 0;
  /** Escritura en vuelo: se solapa con la búsqueda del fotograma siguiente. */
  let enVuelo: Promise<unknown> | null = null;

  try {
    for (const [k, clip] of clips.entries()) {
      const segmento = firstSegment + k;
      const feather = clip.layout?.feather ?? DEFAULT_LAYOUT.feather;
      const half = Math.max(feather * 0.5, 0.01);
      const lo = 0.5 - half;
      const alto = 0.5 + half;

      video.src = mediaSrc(clip.mediaPath);
      video.load();
      await wait(video, "loadeddata", 15000, true);

      const frames = Math.ceil((clip.out - clip.in) * fps);
      const buscar = (i: number) => {
        video.currentTime = clip.in + (i + 0.5) / fps;
        return wait(video, "seeked", 4000);
      };
      let conSilueta = 0;
      let siguiente: Promise<void> | null = buscar(0);

      for (let i = 0; i < frames; i++) {
        if (isCancelled()) throw new Error("Exportación cancelada");
        await siguiente;
        // Reducimos el fotograma antes de pasárselo al modelo y la máscara
        // vuelve ya del tamaño final.
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, mw, mh);
        const r = fitRect(video.videoWidth || mw, video.videoHeight || mh, mw, mh, fit);
        ctx.drawImage(video, r.x, r.y, r.w, r.h);
        const mask = segmenter.segment(lienzo);
        // La máscara se copia, así que el vídeo queda libre: mandamos ya la
        // búsqueda del siguiente fotograma y la GPU trabaja mientras la CPU
        // prepara este y lo escribe.
        siguiente = i + 1 < frames ? buscar(i + 1) : null;
        // Si abortamos, esa búsqueda queda a medias: la damos por atendida
        // para que no salte como promesa rechazada sin dueño.
        siguiente?.catch(() => {});

        if (mask) {
          conSilueta++;
          // Gris = alfa, con el mismo suavizado que el shader del preview.
          for (let j = 0; j < gris.length; j++) {
            const t = Math.min(1, Math.max(0, (mask.data[j] - lo) / (alto - lo)));
            gris[j] = Math.round(t * t * (3 - 2 * t) * 255); // smoothstep
          }
        } else {
          gris.fill(0);
        }

        // Los fotogramas van en fila en el mismo archivo, así que se escriben
        // en orden: esperamos al anterior justo antes de mandar el siguiente.
        if (enVuelo) await enVuelo;
        enVuelo = invoke("export_write_raw", gris.slice(), {
          headers: { "x-segment": String(segmento), "x-frame": String(i) },
        });
        onProgress(++hechos / totalFrames);
      }
      if (enVuelo) {
        await enVuelo;
        enVuelo = null;
      }
      // Sin una sola silueta la capa saldría invisible: mejor avisar.
      if (conSilueta === 0) {
        throw new Error(
          `No se pudo recortar "${clip.name}": el segmentador no devolvió ninguna silueta.`,
        );
      }
      out.set(clip.id, { segment: segmento, fps, width: mw, height: mh });
    }
  } finally {
    await enVuelo?.catch(() => {});
    video.removeAttribute("src");
    video.load();
  }
  return out;
}
