/**
 * Arrastre con pointer events: captura el puntero y avisa del desplazamiento.
 * Los listeners van en `document`, no en el elemento: si el elemento se mueve
 * en el DOM durante el arrastre el navegador suelta la captura, y aun así
 * seguimos recibiendo los eventos.
 */
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

  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* sin captura también funciona gracias a los listeners en document */
  }

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
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
    if (ev.pointerId !== e.pointerId) return;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    handlers.onEnd?.(ev, moved);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
}
