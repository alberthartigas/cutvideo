import { project } from "$lib/project.svelte";
import { mediaSrc } from "$lib/tauri/media";

/**
 * Dos imágenes de muestra para las miniaturas de transiciones y efectos: si hay
 * vídeo en el proyecto se capturan frames reales (como CapCut); si no, patrones.
 */
const svg = (a: string, b: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><text x="80" y="52" font-family="sans-serif" font-size="26" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text></svg>`,
  )}`;

const FALLBACK_A = svg("#6b5cf6", "#c026d3", "A");
const FALLBACK_B = svg("#0ea5e9", "#10b981", "B");

export const samples = $state({ a: FALLBACK_A, b: FALLBACK_B });

/** Captura un frame de `path` en el instante `t` como data URL. */
function grab(path: string, t: number): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const done = (value: string | null) => {
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 4000);
    video.onseeked = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        const scale = 160 / (video.videoWidth || 160);
        canvas.width = 160;
        canvas.height = Math.max(1, Math.round((video.videoHeight || 90) * scale));
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        done(null); // El WebView puede marcar el canvas como "tainted".
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    video.onloadeddata = () => {
      video.currentTime = t;
    };
    video.src = mediaSrc(path);
  });
}

let lastKey = "";

/** Rehace las muestras a partir de los clips actuales (no hace nada si no han cambiado). */
export async function refreshSamples() {
  const clips = project.videoTrack.clips;
  const key = clips.map((c) => `${c.mediaPath}:${c.in.toFixed(2)}`).join("|");
  if (key === lastKey) return;
  lastKey = key;
  if (clips.length === 0) {
    samples.a = FALLBACK_A;
    samples.b = FALLBACK_B;
    return;
  }
  const first = clips[0];
  const second = clips[1] ?? first;
  const [a, b] = await Promise.all([
    grab(first.mediaPath, first.in + Math.min(0.3, (first.out - first.in) / 2)),
    grab(second.mediaPath, second.in + Math.min(1.2, (second.out - second.in) / 2)),
  ]);
  samples.a = a ?? FALLBACK_A;
  samples.b = b ?? FALLBACK_B;
}
