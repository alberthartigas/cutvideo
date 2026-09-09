/**
 * Animaciones de texto como funciones puras del tiempo (idea "Remotion"):
 * dado el progreso (0 = invisible, 1 = visible) y la unidad (letra / palabra /
 * línea / bloque), devuelven el estado visual. Sin timers: el mismo código
 * sirve para el preview y para el export, frame a frame.
 *
 * Añadir una animación = añadir una entrada a TEXT_ANIMATIONS.
 */

export type Unit = "char" | "word" | "line" | "block";

export interface UnitInfo {
  /** Índice de la unidad dentro del texto (según `unit`). */
  i: number;
  /** Número total de unidades. */
  n: number;
}

export interface UnitState {
  opacity: number;
  /** Desplazamiento en "em" (múltiplos del tamaño de fuente). */
  dx: number;
  dy: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  /** Grados. */
  rotate: number;
  /** Desenfoque en "em". */
  blur: number;
  /** 0–1: mezcla hacia el color de resaltado. */
  highlight: number;
  /** 0–1: caja de color detrás de la palabra (estilo "palabra resaltada"). */
  box: number;
}

export interface AnimContext {
  /** Segundos desde el inicio del clip. */
  time: number;
  duration: number;
  /** Tiempos [inicio, fin] por palabra, relativos al clip (subtítulos transcritos). */
  wordTimes?: [number, number][];
}

export interface TextAnimation {
  id: string;
  name: string;
  /** "inout" sirve de entrada y de salida; "emphasis" se aplica durante todo el clip. */
  kind: "inout" | "emphasis";
  unit: Unit;
  state(p: number, u: UnitInfo, ctx: AnimContext): Partial<UnitState>;
}

export const BASE_STATE: UnitState = {
  opacity: 1, dx: 0, dy: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, blur: 0, highlight: 0, box: 0,
};

/** Progreso 0→1 de una ventana de `len` segundos que empieza en `start` (para animar palabras al pronunciarse). */
const window01 = (time: number, start: number, len: number) => clamp01((time - start) / len);

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** Muelle subamortiguado 0 → 1 con rebote, normalizado para asentarse en t = 1. */
export function spring(t: number, stiffness = 12, damping = 0.55): number {
  const x = clamp01(t);
  if (x >= 1) return 1;
  const wd = stiffness * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * stiffness * x) * (Math.cos(wd * x) + ((damping * stiffness) / wd) * Math.sin(wd * x));
}

/**
 * Progreso local de la unidad `i` de `n` cuando las unidades entran escalonadas.
 * `overlap` 0 = una tras otra; 1 = todas a la vez.
 */
export function stagger(p: number, i: number, n: number, overlap: number): number {
  if (n <= 1) return clamp01(p);
  const d = 1 / ((n - 1) * (1 - overlap) + 1);
  const start = i * d * (1 - overlap);
  return clamp01((p - start) / d);
}

/** Ruido determinista en [0, 1): mismo resultado para el mismo (i, k) en preview y export. */
export function noise(i: number, k: number): number {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export const TEXT_ANIMATIONS: TextAnimation[] = [
  { id: "none", name: "Ninguna", kind: "inout", unit: "block", state: () => ({}) },
  { id: "fade", name: "Fundido", kind: "inout", unit: "block", state: (p) => ({ opacity: p }) },
  {
    id: "typewriter",
    name: "Máquina de escribir",
    kind: "inout",
    unit: "char",
    state: (p, u) => ({ opacity: p * u.n > u.i ? 1 : 0 }),
  },
  {
    id: "pop",
    name: "Pop",
    kind: "inout",
    unit: "word",
    state: (p, u) => {
      const l = stagger(p, u.i, u.n, 0.6);
      return { scale: spring(l), opacity: Math.min(1, l * 4) };
    },
  },
  {
    id: "rise",
    name: "Subir",
    kind: "inout",
    unit: "line",
    state: (p, u) => {
      const l = easeOut(stagger(p, u.i, u.n, 0.5));
      return { dy: (1 - l) * 0.6, opacity: l };
    },
  },
  {
    id: "slide",
    name: "Deslizar",
    kind: "inout",
    unit: "block",
    state: (p) => {
      const l = easeOut(p);
      return { dx: -(1 - l) * 2, opacity: Math.min(1, p * 2) };
    },
  },
  {
    id: "words",
    name: "Palabra a palabra",
    kind: "inout",
    unit: "word",
    state: (p, u) => {
      const l = easeOut(stagger(p, u.i, u.n, 0.3));
      return { opacity: l, dy: (1 - l) * 0.3 };
    },
  },
  {
    id: "wave",
    name: "Ola",
    kind: "inout",
    unit: "char",
    state: (p, u) => {
      const l = stagger(p, u.i, u.n, 0.8);
      return { opacity: Math.min(1, l * 2), dy: -Math.sin(l * Math.PI) * 0.35 };
    },
  },
  {
    id: "blur",
    name: "Desenfoque",
    kind: "inout",
    unit: "block",
    state: (p) => ({ opacity: p, blur: (1 - p) * 0.3, scale: 1 + (1 - p) * 0.1 }),
  },
  {
    id: "glitch",
    name: "Glitch",
    kind: "inout",
    unit: "char",
    state: (p, u) => {
      if (p >= 1) return {};
      const k = Math.floor(p * 14);
      const r1 = noise(u.i, k);
      const r2 = noise(u.i + 97, k);
      const amount = 1 - p;
      return {
        opacity: r1 < amount * 0.6 ? 0.1 : 1,
        dx: (r2 - 0.5) * amount * 0.5,
        dy: (r1 - 0.5) * amount * 0.2,
      };
    },
  },
  {
    id: "fadezoom",
    name: "Fundido con zoom",
    kind: "inout",
    unit: "block",
    state: (p) => ({ opacity: p, scale: 0.8 + 0.2 * easeOut(p) }),
  },
  {
    id: "bounce",
    name: "Rebote",
    kind: "inout",
    unit: "word",
    state: (p, u) => {
      const l = stagger(p, u.i, u.n, 0.6);
      return { dy: -(1 - spring(l, 11, 0.4)) * 1.2, opacity: Math.min(1, l * 3) };
    },
  },
  {
    id: "zoom",
    name: "Zoom",
    kind: "inout",
    unit: "block",
    state: (p) => ({ scale: 1 + (1 - easeOut(p)) * 1.5, opacity: p }),
  },
  {
    id: "spin",
    name: "Giro",
    kind: "inout",
    unit: "word",
    state: (p, u) => {
      const l = easeOut(stagger(p, u.i, u.n, 0.6));
      return { rotate: (1 - l) * -90, scale: 0.4 + 0.6 * l, opacity: l };
    },
  },
  {
    id: "flash",
    name: "Flash",
    kind: "inout",
    unit: "block",
    state: (p) => ({ opacity: p >= 1 ? 1 : noise(3, Math.floor(p * 10)) > 0.45 ? 1 : 0.15 }),
  },
  {
    id: "stretch",
    name: "Estirar",
    kind: "inout",
    unit: "block",
    state: (p) => ({ scaleX: 1 + (1 - easeOut(p)) * 1.6, opacity: p }),
  },
  {
    id: "elastic",
    name: "Elástico",
    kind: "inout",
    unit: "word",
    state: (p, u) => {
      const l = stagger(p, u.i, u.n, 0.5);
      return { scaleX: spring(l, 9, 0.3), scaleY: spring(l, 10, 0.35), opacity: Math.min(1, l * 4) };
    },
  },
  {
    id: "wipe",
    name: "Barrido (máscara)",
    kind: "inout",
    unit: "char",
    state: (p, u) => ({ opacity: clamp01((p * (u.n + 2) - u.i) / 2) }),
  },
  {
    id: "karaoke",
    name: "Karaoke",
    kind: "emphasis",
    unit: "word",
    state: (p, u, ctx) => {
      // Con tiempos reales por palabra (transcripción) el resaltado va sincronizado.
      const wt = ctx.wordTimes?.[u.i];
      if (wt) return { highlight: clamp01((ctx.time - wt[0]) / 0.12) };
      return { highlight: clamp01(p * u.n - u.i) };
    },
  },
  {
    id: "wordbox",
    name: "Palabra en caja",
    kind: "emphasis",
    unit: "word",
    state: (p, u, ctx) => {
      const wt = ctx.wordTimes?.[u.i];
      const next = ctx.wordTimes?.[u.i + 1];
      if (wt) {
        const end = next ? next[0] : wt[1] + 0.3;
        return { box: ctx.time >= wt[0] && ctx.time < end ? 1 : 0 };
      }
      return { box: Math.floor(p * u.n) === u.i ? 1 : 0 };
    },
  },
  {
    id: "wordpop",
    name: "Pop por palabra",
    kind: "emphasis",
    unit: "word",
    state: (p, u, ctx) => {
      const wt = ctx.wordTimes?.[u.i];
      const start = wt ? wt[0] : (u.i / u.n) * ctx.duration;
      const l = window01(ctx.time, start, 0.28);
      return { scale: 1 + 0.3 * (1 - easeOut(l)) * (ctx.time >= start ? 1 : 0), highlight: ctx.time >= start ? 1 : 0 };
    },
  },
  {
    id: "wordbounce",
    name: "Rebote por palabra",
    kind: "emphasis",
    unit: "word",
    state: (p, u, ctx) => {
      const wt = ctx.wordTimes?.[u.i];
      const start = wt ? wt[0] : (u.i / u.n) * ctx.duration;
      const l = window01(ctx.time, start, 0.32);
      return { dy: -Math.sin(l * Math.PI) * 0.25, highlight: ctx.time >= start ? 1 : 0 };
    },
  },
  {
    id: "shake",
    name: "Temblor",
    kind: "emphasis",
    unit: "word",
    state: (p, u, ctx) => {
      const k = Math.floor(ctx.time * 24);
      return { dx: (noise(u.i, k) - 0.5) * 0.08, dy: (noise(u.i + 31, k) - 0.5) * 0.08 };
    },
  },
  {
    id: "pulse",
    name: "Pulso",
    kind: "emphasis",
    unit: "block",
    state: (p, u, ctx) => ({ scale: 1 + 0.05 * Math.sin(ctx.time * Math.PI * 2 * 1.2) }),
  },
  {
    id: "float",
    name: "Flotar",
    kind: "emphasis",
    unit: "block",
    state: (p, u, ctx) => ({ dy: Math.sin(ctx.time * Math.PI) * 0.12, rotate: Math.sin(ctx.time * Math.PI * 0.7) * 1.5 }),
  },
  {
    id: "lightsweep",
    name: "Destello",
    kind: "emphasis",
    unit: "char",
    state: (p, u, ctx) => {
      const pos = ((ctx.time % 2.2) / 2.2) * (u.n + 8) - 4;
      return { highlight: clamp01(1 - Math.abs(u.i - pos) / 2.5) };
    },
  },
];

export const INOUT_ANIMATIONS = TEXT_ANIMATIONS.filter((a) => a.kind === "inout");
export const EMPHASIS_ANIMATIONS: TextAnimation[] = [
  { id: "none", name: "Ninguno", kind: "emphasis", unit: "block", state: () => ({}) },
  ...TEXT_ANIMATIONS.filter((a) => a.kind === "emphasis"),
];

const byId = new Map(TEXT_ANIMATIONS.map((a) => [a.id, a]));
export const getAnimation = (id: string): TextAnimation => byId.get(id) ?? TEXT_ANIMATIONS[0];
