/** Un parche: imagen, sticker o página de PDF colocada sobre el vídeo. */
export interface PatchData {
  /** Centro del parche, normalizado al frame (0–1). */
  x: number;
  y: number;
  /** Ancho como fracción del ancho del frame. */
  width: number;
  /** Grados. */
  rotation: number;
  opacity: number;
  /** Espejo horizontal (útil al seguir a alguien que se gira). */
  flip: boolean;
  /** Seguimiento: si está, el parche va pegado al objeto que se siguió. */
  track?: PatchTrack;
}

/** Posiciones del objeto seguido, muestreadas a intervalos regulares. */
export interface PatchTrack {
  /** Instante (s, en tiempo de timeline) de la primera muestra. */
  start: number;
  /** Muestras por segundo. */
  fps: number;
  /** Centro del objeto en cada muestra, normalizado al frame. */
  points: [number, number][];
  /** Escala relativa en cada muestra (1 = como al empezar). */
  scales: number[];
}

export const DEFAULT_PATCH: PatchData = {
  x: 0.5,
  y: 0.5,
  width: 0.25,
  rotation: 0,
  opacity: 1,
  flip: false,
};

/** Posición y escala del parche en el instante `t` (s de timeline). */
export function patchAt(patch: PatchData, t: number): { x: number; y: number; scale: number } {
  const tr = patch.track;
  if (!tr || tr.points.length === 0) return { x: patch.x, y: patch.y, scale: 1 };
  const i = (t - tr.start) * tr.fps;
  const i0 = Math.max(0, Math.min(tr.points.length - 1, Math.floor(i)));
  const i1 = Math.min(tr.points.length - 1, i0 + 1);
  const f = Math.max(0, Math.min(1, i - i0));
  const [x0, y0] = tr.points[i0];
  const [x1, y1] = tr.points[i1];
  const s0 = tr.scales[i0] ?? 1;
  const s1 = tr.scales[i1] ?? 1;
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, scale: s0 + (s1 - s0) * f };
}
