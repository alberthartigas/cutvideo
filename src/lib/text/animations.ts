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
  /** Grados. */
  rotate: number;
  /** Desenfoque en "em". */
  blur: number;
  /** 0–1: mezcla hacia el color de resaltado. */
  highlight: number;
}

export interface TextAnimation {
  id: string;
  name: string;
  /** "inout" sirve de entrada y de salida; "emphasis" se aplica durante todo el clip. */
  kind: "inout" | "emphasis";
  unit: Unit;
  state(p: number, u: UnitInfo): Partial<UnitState>;
}

export const BASE_STATE: UnitState = { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0, highlight: 0 };

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
    id: "karaoke",
    name: "Karaoke",
    kind: "emphasis",
    unit: "word",
    state: (p, u) => ({ highlight: clamp01(p * u.n - u.i) }),
  },
];

export const INOUT_ANIMATIONS = TEXT_ANIMATIONS.filter((a) => a.kind === "inout");
export const EMPHASIS_ANIMATIONS: TextAnimation[] = [
  { id: "none", name: "Ninguno", kind: "emphasis", unit: "block", state: () => ({}) },
  ...TEXT_ANIMATIONS.filter((a) => a.kind === "emphasis"),
];

const byId = new Map(TEXT_ANIMATIONS.map((a) => [a.id, a]));
export const getAnimation = (id: string): TextAnimation => byId.get(id) ?? TEXT_ANIMATIONS[0];
