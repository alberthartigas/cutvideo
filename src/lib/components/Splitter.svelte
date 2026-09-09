<script lang="ts">
  import { startDrag } from "$lib/drag";
  import { clampLayout, layout, LAYOUT_DEFAULTS, saveLayout, type LayoutKey } from "$lib/layout.svelte";

  /**
   * Divisor arrastrable entre dos paneles. `invert` es para los paneles que
   * crecen hacia la izquierda o hacia arriba (inspector y timeline).
   */
  let {
    key,
    axis = "x",
    invert = false,
    label,
  }: { key: LayoutKey; axis?: "x" | "y"; invert?: boolean; label: string } = $props();

  const STEP = 16;
  let dragging = $state(false);

  function set(value: number) {
    layout[key] = clampLayout(key, value);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const start = layout[key];
    startDrag(e, {
      onStart: () => (dragging = true),
      onMove(dx, dy) {
        const d = axis === "x" ? dx : dy;
        set(start + (invert ? -d : d));
      },
      onEnd() {
        dragging = false;
        saveLayout();
      },
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const fwd = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    const d = (e.key === fwd ? STEP : -STEP) * (invert ? -1 : 1);
    set(layout[key] + d);
    saveLayout();
  }

  /** Doble clic: vuelve al tamaño de fábrica. */
  function reset() {
    set(LAYOUT_DEFAULTS[key]);
    saveLayout();
  }
</script>

<!--
  ARIA llama a esto un "window splitter": un separator con tabindex y
  aria-valuenow sí es interactivo, aunque svelte-check no lo reconozca.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="splitter {axis}"
  class:dragging
  role="separator"
  aria-label={label}
  aria-orientation={axis === "x" ? "vertical" : "horizontal"}
  aria-valuenow={Math.round(layout[key])}
  tabindex="0"
  onpointerdown={onPointerDown}
  onkeydown={onKeyDown}
  ondblclick={reset}
  title="{label} · arrastra para ajustar, doble clic para restablecer"
></div>

<style>
  .splitter {
    position: relative;
    flex-shrink: 0;
    touch-action: none;
  }
  .splitter.x {
    width: 8px;
    cursor: col-resize;
  }
  .splitter.y {
    height: 8px;
    cursor: row-resize;
  }
  /* La línea sólo se ve al acercar el ratón, para no ensuciar la interfaz. */
  .splitter::after {
    content: "";
    position: absolute;
    border-radius: 999px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 120ms;
  }
  .splitter.x::after {
    top: 8px;
    bottom: 8px;
    left: 3px;
    width: 2px;
  }
  .splitter.y::after {
    left: 8px;
    right: 8px;
    top: 3px;
    height: 2px;
  }
  .splitter:hover::after,
  .splitter:focus-visible::after,
  .splitter.dragging::after {
    opacity: 0.8;
  }
  .splitter:focus-visible {
    outline: none;
  }
</style>
