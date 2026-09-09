/** Tamaños de los paneles, ajustables arrastrando los divisores y recordados entre sesiones. */
const STORAGE_KEY = "cutvideo.layout";

export const LAYOUT_DEFAULTS = {
  /** Ancho del panel de la sección activa (Medios, Efectos, Transiciones…). */
  panelWidth: 248,
  inspectorWidth: 300,
  timelineHeight: 240,
};

export const LAYOUT_LIMITS = {
  panelWidth: { min: 180, max: 560 },
  inspectorWidth: { min: 220, max: 560 },
  timelineHeight: { min: 120, max: 640 },
} satisfies Record<keyof typeof LAYOUT_DEFAULTS, { min: number; max: number }>;

export type LayoutKey = keyof typeof LAYOUT_DEFAULTS;

function read(): typeof LAYOUT_DEFAULTS {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...LAYOUT_DEFAULTS };
    const saved = JSON.parse(raw) as Partial<typeof LAYOUT_DEFAULTS>;
    const out = { ...LAYOUT_DEFAULTS };
    for (const key of Object.keys(LAYOUT_DEFAULTS) as LayoutKey[]) {
      const v = saved[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        const { min, max } = LAYOUT_LIMITS[key];
        out[key] = Math.min(max, Math.max(min, v));
      }
    }
    return out;
  } catch {
    return { ...LAYOUT_DEFAULTS };
  }
}

export const layout = $state(read());

export function saveLayout() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(layout)));
  } catch {
    /* sin localStorage: los tamaños duran solo esta sesión */
  }
}

/** Deja un tamaño dentro de sus límites. */
export function clampLayout(key: LayoutKey, value: number): number {
  const { min, max } = LAYOUT_LIMITS[key];
  return Math.min(max, Math.max(min, value));
}
