import { invoke } from "@tauri-apps/api/core";
import { mediaSrc } from "$lib/tauri/media";
import type { MediaInfo } from "$lib/tauri/media";

/**
 * Copias ligeras para editar sin tirones.
 *
 * El preview no puede con varios vídeos de móvil a la vez (HEVC de 6 Mpx a
 * 30 Mb/s): en cada corte monta y desmonta decodificadores y se ve a
 * trompicones. Aquí se pide una copia pequeña de cada archivo y el preview la
 * usa en su lugar. La exportación sigue leyendo el original, así que la calidad
 * final no cambia.
 */
class Proxies {
  /** Ruta original → ruta del proxy. */
  #listos = $state<Record<string, string>>({});
  #enCurso = new Set<string>();
  /** Cuántos quedan por preparar, para poder avisarlo en la interfaz. */
  pendientes = $state(0);
  error = $state<string | null>(null);

  /** Ruta que debe usar el preview: el proxy si lo hay, si no el original. */
  src(path: string): string {
    return mediaSrc(this.#listos[path] ?? path);
  }

  ready(path: string): boolean {
    return this.#listos[path] !== undefined;
  }

  /**
   * Prepara los proxies de lo que se importe. Va de uno en uno a propósito:
   * lanzar ocho ffmpeg a la vez deja la máquina inservible justo cuando el
   * usuario quiere empezar a editar.
   */
  async prepare(medios: MediaInfo[]) {
    const faltan = medios.filter(
      (m) => m.video && !m.isImage && !this.#listos[m.path] && !this.#enCurso.has(m.path),
    );
    if (!faltan.length) return;
    faltan.forEach((m) => this.#enCurso.add(m.path));
    this.pendientes += faltan.length;
    for (const m of faltan) {
      try {
        const existente = await invoke<string | null>("proxy_for", { path: m.path });
        this.#listos[m.path] = existente ?? (await invoke<string>("make_proxy", { path: m.path }));
      } catch (e) {
        // Sin proxy se sigue editando con el original: más lento, pero funciona.
        this.error = String(e);
      } finally {
        this.#enCurso.delete(m.path);
        this.pendientes--;
      }
    }
  }
}

export const proxies = new Proxies();
