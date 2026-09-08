/** Arrastre con pointer events: captura el puntero y avisa del desplazamiento. */
export interface DragHandlers {
  /** Primer movimiento real (más de 3 px): momento de guardar el estado para deshacer. */
  onStart?(e: PointerEvent): void;
  onMove(dx: number, dy: number, e: PointerEvent): void;
  onEnd?(e: PointerEvent, moved: boolean): void;
}

export function startDrag(e: PointerEvent, handlers: DragHandlers) {
  const el = e.currentTarget as HTMLElement;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;

  el.setPointerCapture(e.pointerId);

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!moved) {
      if (Math.hypot(dx, dy) < 3) return;
      moved = true;
      handlers.onStart?.(ev);
    }
    handlers.onMove(dx, dy, ev);
  };
  const onUp = (ev: PointerEvent) => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    handlers.onEnd?.(ev, moved);
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}
