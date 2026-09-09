/** Colocación de un clip en una capa superpuesta (imagen en imagen). */
export interface ClipLayout {
  /** Centro de la capa, normalizado al frame (0–1). */
  x: number;
  y: number;
  /** Tamaño respecto al frame: 1 = pantalla completa. */
  scale: number;
  opacity: number;
  /** Recorta a la persona y deja el resto transparente. */
  cutout: boolean;
  /** Suavizado del borde del recorte, 0–1. */
  feather: number;
}

export const DEFAULT_LAYOUT: ClipLayout = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  opacity: 1,
  cutout: false,
  feather: 0.35,
};

/** Colocaciones típicas para una capa superpuesta. */
export const LAYOUT_PRESETS: { id: string; label: string; hint: string; layout: Partial<ClipLayout> }[] = [
  { id: "full", label: "Pantalla", hint: "Ocupa todo", layout: { x: 0.5, y: 0.5, scale: 1 } },
  { id: "pip-br", label: "Esquina", hint: "Abajo a la derecha", layout: { x: 0.76, y: 0.76, scale: 0.34 } },
  { id: "pip-bl", label: "Esquina izq.", hint: "Abajo a la izquierda", layout: { x: 0.24, y: 0.76, scale: 0.34 } },
  { id: "half-top", label: "Mitad arriba", hint: "Vídeo partido", layout: { x: 0.5, y: 0.25, scale: 0.5 } },
  { id: "half-bottom", label: "Mitad abajo", hint: "Vídeo partido", layout: { x: 0.5, y: 0.75, scale: 0.5 } },
  { id: "center", label: "Centrado", hint: "Más pequeño, en medio", layout: { x: 0.5, y: 0.5, scale: 0.62 } },
];

/** Ids de las pistas que se superponen al vídeo principal, de arriba abajo. */
export const OVERLAY_TRACK_IDS = ["o1", "o2"] as const;
