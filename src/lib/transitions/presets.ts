/**
 * Transiciones entre clips de la pista principal. Cada preset tiene su
 * equivalente en el filtro `xfade` de ffmpeg (export) y una aproximación CSS
 * para el preview (dos <video> superpuestos). `p` va de 0 (solo el clip
 * saliente) a 1 (solo el entrante).
 */
export interface TransitionPreset {
  id: string;
  name: string;
  /** Nombre del filtro xfade de ffmpeg. */
  xfade: string;
}

export const TRANSITIONS: TransitionPreset[] = [
  { id: "fade", name: "Fundido", xfade: "fade" },
  { id: "dissolve", name: "Disolver", xfade: "dissolve" },
  { id: "fadeblack", name: "Fundido a negro", xfade: "fadeblack" },
  { id: "flash", name: "Flash blanco", xfade: "fadewhite" },
  { id: "slideleft", name: "Deslizar", xfade: "slideleft" },
  { id: "slideup", name: "Deslizar arriba", xfade: "slideup" },
  { id: "smooth", name: "Barrido suave", xfade: "smoothleft" },
  { id: "wipe", name: "Barrido", xfade: "wipeleft" },
  { id: "zoom", name: "Zoom", xfade: "zoomin" },
  { id: "blur", name: "Desenfoque", xfade: "hblur" },
  { id: "circle", name: "Círculo", xfade: "circleopen" },
  { id: "pixel", name: "Pixelar", xfade: "pixelize" },
  { id: "squeeze", name: "Estirar", xfade: "squeezeh" },
];

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const TRANSITION_MIN = 0.15;
export const TRANSITION_MAX = 2;

const byId = new Map(TRANSITIONS.map((t) => [t.id, t]));
export const getTransition = (id: string) => byId.get(id) ?? null;

export interface TransitionFrame {
  /** CSS inline para el clip saliente. */
  a: string;
  /** CSS inline para el clip entrante. */
  b: string;
  /** Opacidad de la capa de flash (0–1). */
  flash: number;
  flashColor: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Aproximación CSS del preset en el progreso `p` (preview). */
export function transitionFrame(id: string, p: number): TransitionFrame {
  const q = clamp01(p);
  const e = easeInOut(q);
  const none: TransitionFrame = { a: "", b: `opacity:${q}`, flash: 0, flashColor: "#fff" };
  switch (id) {
    case "fade":
    case "dissolve":
    case "pixel":
      return none;
    case "fadeblack":
      return { a: `opacity:${1 - clamp01(q * 2)}`, b: `opacity:${clamp01(q * 2 - 1)}`, flash: 0, flashColor: "#000" };
    case "flash":
      return { a: `opacity:${q < 0.5 ? 1 : 0}`, b: `opacity:${q < 0.5 ? 0 : 1}`, flash: 1 - Math.abs(2 * q - 1), flashColor: "#fff" };
    case "slideleft":
      return { a: `transform:translateX(${-e * 100}%)`, b: `transform:translateX(${(1 - e) * 100}%)`, flash: 0, flashColor: "#fff" };
    case "slideup":
      return { a: `transform:translateY(${-e * 100}%)`, b: `transform:translateY(${(1 - e) * 100}%)`, flash: 0, flashColor: "#fff" };
    case "smooth": {
      const blur = Math.sin(q * Math.PI) * 8;
      return {
        a: `transform:translateX(${-e * 100}%);filter:blur(${blur}px)`,
        b: `transform:translateX(${(1 - e) * 100}%);filter:blur(${blur}px)`,
        flash: 0,
        flashColor: "#fff",
      };
    }
    case "wipe":
      return { a: "", b: `clip-path:inset(0 0 0 ${(1 - e) * 100}%)`, flash: 0, flashColor: "#fff" };
    case "zoom":
      return { a: `transform:scale(${1 + e * 0.6});opacity:${1 - q}`, b: `transform:scale(${1.3 - e * 0.3});opacity:${q}`, flash: 0, flashColor: "#fff" };
    case "blur":
      return { a: `filter:blur(${q * 16}px);opacity:${1 - q}`, b: `filter:blur(${(1 - q) * 16}px);opacity:${q}`, flash: 0, flashColor: "#fff" };
    case "circle":
      return { a: "", b: `clip-path:circle(${e * 75}% at 50% 50%)`, flash: 0, flashColor: "#fff" };
    case "squeeze":
      return { a: `transform:scaleX(${1 - e})`, b: `transform:scaleX(${e})`, flash: 0, flashColor: "#fff" };
    default:
      return none;
  }
}
