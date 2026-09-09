/**
 * Efectos de color por clip. Cada preset tiene su versión CSS (preview, filtro
 * sobre el <video>) y su versión ffmpeg (export). No son idénticas al píxel,
 * pero sí la misma intención visual.
 */
export interface EffectPreset {
  id: string;
  name: string;
  css: string;
  ffmpeg: string;
  /** Viñeta añadida por el preset (0–1). */
  vignette?: number;
}

export const EFFECTS: EffectPreset[] = [
  { id: "bw", name: "Blanco y negro", css: "grayscale(1)", ffmpeg: "hue=s=0" },
  { id: "noir", name: "Noir", css: "grayscale(1) contrast(1.3) brightness(0.95)", ffmpeg: "hue=s=0,eq=contrast=1.3:brightness=-0.03", vignette: 0.5 },
  {
    id: "sepia",
    name: "Sepia",
    css: "sepia(0.85)",
    ffmpeg: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
  },
  {
    id: "vintage",
    name: "Vintage",
    css: "sepia(0.4) contrast(1.1) brightness(0.95) saturate(0.9)",
    ffmpeg: "colorchannelmixer=.6:.3:.1:0:.2:.7:.1:0:.15:.35:.5,eq=contrast=1.1:brightness=-0.03",
    vignette: 0.45,
  },
  { id: "vivid", name: "Vívido", css: "saturate(1.5) contrast(1.1)", ffmpeg: "eq=saturation=1.5:contrast=1.1" },
  { id: "pop", name: "Pop", css: "saturate(1.9) contrast(1.2)", ffmpeg: "eq=saturation=1.9:contrast=1.2" },
  { id: "warm", name: "Cálido", css: "sepia(0.25) saturate(1.2) brightness(1.03)", ffmpeg: "colorbalance=rs=.12:gs=.02:bs=-.12,eq=saturation=1.15" },
  { id: "cool", name: "Frío", css: "hue-rotate(-12deg) saturate(1.1) brightness(1.02)", ffmpeg: "colorbalance=rs=-.1:bs=.16,eq=saturation=1.1" },
  { id: "cinematic", name: "Cinemático", css: "contrast(1.15) saturate(0.9) sepia(0.15)", ffmpeg: "eq=contrast=1.15:saturation=0.9,colorbalance=rs=-.04:bs=.08", vignette: 0.35 },
  { id: "faded", name: "Desvaído", css: "contrast(0.85) brightness(1.1) saturate(0.8)", ffmpeg: "eq=contrast=0.85:brightness=0.06:saturation=0.8" },
  { id: "dreamy", name: "Soñador", css: "blur(1.5px) brightness(1.06) saturate(1.15)", ffmpeg: "gblur=sigma=2.5,eq=brightness=0.04:saturation=1.15" },
  { id: "vignette", name: "Viñeta", css: "", ffmpeg: "", vignette: 0.7 },
  { id: "invert", name: "Negativo", css: "invert(1)", ffmpeg: "negate" },
];

const byId = new Map(EFFECTS.map((e) => [e.id, e]));
export const getEffect = (id: string) => byId.get(id) ?? null;

/** Ajustes manuales por clip (además del preset). */
export interface Adjustments {
  /** -1..1 */
  brightness: number;
  /** 0.5..2 */
  contrast: number;
  /** 0..2 */
  saturation: number;
  /** Grados, -180..180 */
  hue: number;
  /** 0..1 (fracción del alto del frame, ×0.02) */
  blur: number;
  /** 0..1 */
  vignette: number;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0, vignette: 0 };

export interface ClipEffects {
  preset: string | null;
  adjust: Adjustments;
}

export const isDefaultAdjust = (a: Adjustments) =>
  a.brightness === 0 && a.contrast === 1 && a.saturation === 1 && a.hue === 0 && a.blur === 0 && a.vignette === 0;

/** Filtro CSS para el preview. `viewH` en px para escalar el desenfoque. */
export function effectsCss(fx: ClipEffects | undefined, viewH: number): string {
  if (!fx) return "";
  const parts: string[] = [];
  const preset = fx.preset ? getEffect(fx.preset) : null;
  if (preset?.css) parts.push(preset.css);
  const a = fx.adjust;
  if (a.brightness !== 0) parts.push(`brightness(${(1 + a.brightness).toFixed(3)})`);
  if (a.contrast !== 1) parts.push(`contrast(${a.contrast.toFixed(3)})`);
  if (a.saturation !== 1) parts.push(`saturate(${a.saturation.toFixed(3)})`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue.toFixed(1)}deg)`);
  if (a.blur > 0) parts.push(`blur(${(a.blur * 0.02 * viewH).toFixed(2)}px)`);
  return parts.join(" ");
}

/** Viñeta total (preset + ajuste), 0–1. */
export function effectsVignette(fx: ClipEffects | undefined): number {
  if (!fx) return 0;
  const preset = fx.preset ? getEffect(fx.preset) : null;
  return Math.min(1, (preset?.vignette ?? 0) + fx.adjust.vignette);
}

/** Cadena de filtros ffmpeg (sin corchetes), o "" si no hay nada que aplicar. `frameH` para el desenfoque. */
export function effectsFfmpeg(fx: ClipEffects | undefined, frameH: number): string {
  if (!fx) return "";
  const parts: string[] = [];
  const preset = fx.preset ? getEffect(fx.preset) : null;
  if (preset?.ffmpeg) parts.push(preset.ffmpeg);
  const a = fx.adjust;
  const eq: string[] = [];
  if (a.brightness !== 0) eq.push(`brightness=${(a.brightness * 0.5).toFixed(3)}`);
  if (a.contrast !== 1) eq.push(`contrast=${a.contrast.toFixed(3)}`);
  if (a.saturation !== 1) eq.push(`saturation=${a.saturation.toFixed(3)}`);
  if (eq.length) parts.push(`eq=${eq.join(":")}`);
  if (a.hue !== 0) parts.push(`hue=h=${a.hue.toFixed(1)}`);
  if (a.blur > 0) parts.push(`gblur=sigma=${(a.blur * 0.02 * frameH * 0.6).toFixed(2)}`);
  const v = effectsVignette(fx);
  if (v > 0) parts.push(`vignette=angle=${(v * Math.PI * 0.32).toFixed(3)}`);
  return parts.join(",");
}
