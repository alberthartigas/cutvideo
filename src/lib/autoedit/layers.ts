import { clipEnd, project, type Clip } from "$lib/project.svelte";
import { DEFAULT_LAYOUT, LAYOUT_PRESETS } from "$lib/layers";
import { segmenter } from "$lib/segment/segmenter.svelte";
import { mediaSrc } from "$lib/tauri/media";
import type { MediaInfo } from "$lib/tauri/media";

/**
 * Capas para la edición inteligente: mira un fotograma de cada clip
 * superpuesto y decide solo si hay que quitarle la pantalla verde, recortar a
 * la persona o dejarlo como imagen en imagen.
 */
export interface LayerLook {
  /** Color de la pantalla de fondo si el clip es un croma, o null. */
  screen: string | null;
  /** Parte del frame ocupada por personas, 0–1. */
  person: number;
}

const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Carga un vídeo y lo deja parado en `t` segundos. */
async function frameAt(path: string, t: number): Promise<HTMLVideoElement | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = mediaSrc(path);
  const listo = new Promise<boolean>((resolve) => {
    const fin = setTimeout(() => resolve(false), 8000);
    video.addEventListener("error", () => (clearTimeout(fin), resolve(false)), { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        video.currentTime = t;
        video.addEventListener("seeked", () => (clearTimeout(fin), resolve(true)), { once: true });
      },
      { once: true },
    );
  });
  return (await listo) ? video : null;
}

/**
 * Mira un fotograma del clip: si los bordes son de un verde o un azul plano,
 * es una pantalla de croma; si no, mide cuánta persona hay.
 */
export async function analyzeLayer(clip: Clip): Promise<LayerLook> {
  const mitad = clip.in + (clip.out - clip.in) / 2;
  const video = await frameAt(clip.mediaPath, mitad);
  if (!video) return { screen: null, person: 0 };

  const w = 192;
  const h = Math.max(2, Math.round((video.videoHeight / (video.videoWidth || 1)) * w)) || 108;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  // Un croma llega hasta los bordes y es de un color plano: miramos el marco.
  const margenX = Math.max(1, Math.round(w * 0.12));
  const margenY = Math.max(1, Math.round(h * 0.12));
  let borde = 0;
  let verde = 0;
  let azul = 0;
  const suma = { r: 0, g: 0, b: 0 };
  const cuad = { r: 0, g: 0, b: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= margenX && x < w - margenX && y >= margenY && y < h - margenY) continue;
      const o = (y * w + x) * 4;
      const [r, g, b] = [px[o], px[o + 1], px[o + 2]];
      borde++;
      suma.r += r;
      suma.g += g;
      suma.b += b;
      cuad.r += r * r;
      cuad.g += g * g;
      cuad.b += b * b;
      if (g > 55 && g > r * 1.35 && g > b * 1.2) verde++;
      else if (b > 55 && b > r * 1.35 && b > g * 1.2) azul++;
    }
  }
  let screen: string | null = null;
  if (borde > 0) {
    const media = { r: suma.r / borde, g: suma.g / borde, b: suma.b / borde };
    // Una pared o un cielo azul también tiran a azul, pero tienen degradado y
    // sombras: solo lo damos por croma si el marco es de un color casi liso.
    const desv = Math.max(
      Math.sqrt(Math.max(0, cuad.r / borde - media.r ** 2)),
      Math.sqrt(Math.max(0, cuad.g / borde - media.g ** 2)),
      Math.sqrt(Math.max(0, cuad.b / borde - media.b ** 2)),
    );
    const liso = desv < 26;
    if (liso && verde / borde > 0.6) screen = rgbToHex(media.r, media.g, media.b);
    // El azul se confunde más, así que le pedimos casi todo el marco.
    else if (liso && azul / borde > 0.85) screen = rgbToHex(media.r, media.g, media.b);
  }

  let person = 0;
  if (!screen && (await segmenter.load())) {
    const mask = segmenter.segment(video);
    if (mask) {
      let dentro = 0;
      for (const v of mask.data) if (v > 0.6) dentro++;
      person = dentro / mask.data.length;
    }
  }
  video.removeAttribute("src");
  video.load();
  return { screen, person };
}

/** ¿Sigue la capa tal y como se creó? Si el usuario la tocó, no la movemos. */
const sinTocar = (clip: Clip) => {
  const l = { ...DEFAULT_LAYOUT, ...clip.layout };
  return l.x === DEFAULT_LAYOUT.x && l.y === DEFAULT_LAYOUT.y && l.scale === DEFAULT_LAYOUT.scale;
};

export interface LayerPlan {
  chromaed: number;
  cutout: number;
  pip: number;
  added: number;
}

/**
 * Prepara las capas superpuestas del proyecto: croma o recorte donde toca,
 * imagen en imagen para el resto y, si se pide, sube al montaje las escenas
 * que estaban sin usar en la lista de medios.
 */
export async function autoLayers(
  opts: { addSpare: boolean; maxSpare: number; beats: number[] },
  onStep: (message: string) => void,
): Promise<LayerPlan> {
  const plan: LayerPlan = { chromaed: 0, cutout: 0, pip: 0, added: 0 };
  const videoEnd = project.videoTrack.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);

  // 1) Escenas de sobra: las que están en medios pero no en ninguna pista.
  // Van al final de la pista principal, en orden de grabación y con
  // transición: encimarlas quedaba raro y el sonido de las dos se pisaba.
  if (opts.addSpare && videoEnd >= 2.5) {
    const usadas = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.mediaPath)));
    const sobran = project.media
      .filter((m: MediaInfo) => m.video && !m.isImage && !usadas.has(m.path))
      .sort((a, b) => (a.recordedAt ?? "").localeCompare(b.recordedAt ?? ""));
    const cuantos = Math.min(opts.maxSpare, sobran.length);
    if (cuantos > 0) {
      onStep(`Añadiendo ${cuantos} escena${cuantos > 1 ? "s" : ""} al final…`);
      for (const info of sobran.slice(0, cuantos)) {
        const anterior = project.videoTrack.clips.at(-1);
        const clip = project.addClip(info);
        if (!clip) continue;
        // Cada escena aporta su tramo central, de 3 s como mucho.
        const largo = Math.min(3, info.durationSec);
        const desde = Math.max(0, (info.durationSec - largo) / 2);
        project.trimIn(clip.id, desde, false);
        project.trimOut(clip.id, desde + largo);
        if (anterior) project.setTransition(anterior.id, "fade", 0.35);
        plan.added++;
      }
    }
  }

  // 2) Cada capa se mira por dentro y se coloca según lo que sea.
  const capas = project.overlayTracks.flatMap((t) => t.clips);
  if (capas.length === 0) return plan;
  const esquinas = ["pip-br", "pip-bl"];
  let pip = 0;
  for (const [i, clip] of capas.entries()) {
    onStep(`Analizando la capa ${i + 1} de ${capas.length}…`);
    const look = await analyzeLayer(clip);
    if (look.screen) {
      project.setChroma(clip.id, { enabled: true, color: look.screen });
      plan.chromaed++;
    } else if (look.person > 0.02 && look.person < 0.8) {
      project.updateLayout(clip.id, { cutout: true });
      plan.cutout++;
    } else if (sinTocar(clip)) {
      // Sin croma ni persona tapa el vídeo entero: mejor en una esquina.
      const preset = LAYOUT_PRESETS.find((p) => p.id === esquinas[pip % esquinas.length]);
      if (preset) project.updateLayout(clip.id, preset.layout);
      pip++;
      plan.pip++;
    }
    // Que la capa entre en un pulso, como los cortes.
    if (opts.beats.length > 1) {
      const periodo = opts.beats[1] - opts.beats[0];
      let mejor = clip.start;
      let dist = Math.min(periodo / 2, 0.35);
      for (const b of opts.beats) {
        const d = Math.abs(b - clip.start);
        if (d < dist) {
          dist = d;
          mejor = b;
        }
      }
      if (Math.abs(mejor - clip.start) > 0.01) project.moveClip(clip.id, mejor);
    }
  }
  return plan;
}
