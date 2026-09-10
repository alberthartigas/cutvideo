import type { Component } from "svelte";

/**
 * Menú contextual propio.
 *
 * El del WebView solo trae "Recargar" y no sabe nada del editor. Aquí cada
 * sitio (un clip, un archivo de Medios) abre el suyo con las acciones que
 * tienen sentido allí. Solo puede haber uno abierto.
 */
export interface MenuItem {
  label: string;
  icon?: Component<{ size?: number | string }>;
  run: () => void;
  disabled?: boolean;
  /** Acciones que destruyen algo: se pintan en rojo. */
  danger?: boolean;
  /** Atajo que se enseña a la derecha, solo informativo. */
  shortcut?: string;
}

export const contextMenu = $state<{ current: { x: number; y: number; items: MenuItem[] } | null }>({
  current: null,
});

export function openMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.current = { x: e.clientX, y: e.clientY, items };
}

export function closeMenu() {
  contextMenu.current = null;
}
