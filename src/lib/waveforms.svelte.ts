import { invoke } from "@tauri-apps/api/core";
import type { MediaInfo } from "$lib/tauri/media";

/**
 * Formas de onda para el timeline.
 *
 * Por cada archivo con audio se guardan sus picos (0–255) a 50 por segundo; se
 * calculan una vez con ffmpeg y desde ahí pintar un clip es recorrer un array.
 */
export const PICOS_POR_SEGUNDO = 50;

class Waveforms {
  #listas = $state<Record<string, Uint8Array>>({});
  #enCurso = new Set<string>();

  /** Picos del archivo, o null si todavía no están. */
  get(path: string): Uint8Array | null {
    return this.#listas[path] ?? null;
  }

  /** Pide las ondas que falten, de una en una para no ahogar la máquina. */
  async prepare(medios: MediaInfo[]) {
    const faltan = medios.filter((m) => m.audio && !this.#listas[m.path] && !this.#enCurso.has(m.path));
    faltan.forEach((m) => this.#enCurso.add(m.path));
    for (const m of faltan) {
      try {
        const picos = await invoke<number[]>("make_waveform", { path: m.path });
        this.#listas[m.path] = Uint8Array.from(picos);
      } catch {
        /* sin onda el clip se ve liso, como antes */
      } finally {
        this.#enCurso.delete(m.path);
      }
    }
  }
}

export const waveforms = new Waveforms();
