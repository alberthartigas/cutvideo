import { OVERLAY_TRACK_IDS } from "$lib/layers";

/**
 * Vídeos que pueden llevar el reloj de la reproducción.
 *
 * El preview sigue al vídeo activo de la pista principal. Pero si V1 está
 * vacía y lo único que hay es una capa —pasa más de lo que parece: se
 * arrastra un clip y cae en O1—, nadie manda y se vuelve al temporizador, que
 * es justo lo que hacía ir a saltos. Cada capa se apunta aquí y el preview
 * coge la primera que esté reproduciendo de verdad.
 */
export interface ClockSource {
  el: HTMLMediaElement;
  clip: { start: number; in: number };
}

const fuentes = new Map<string, ClockSource>();

export const clock = {
  set(trackId: string, src: ClockSource | null) {
    if (src) fuentes.set(trackId, src);
    else fuentes.delete(trackId);
  },
  /** De arriba abajo, la primera capa que esté sonando; si no, el fondo. */
  fallback(): ClockSource | null {
    for (const id of [...OVERLAY_TRACK_IDS, "f1"]) {
      const s = fuentes.get(id);
      if (s && !s.el.paused && !s.el.seeking && s.el.readyState >= 2) return s;
    }
    return null;
  },
};
