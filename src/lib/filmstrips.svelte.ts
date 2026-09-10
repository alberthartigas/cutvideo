import { invoke } from "@tauri-apps/api/core";
import { mediaSrc } from "$lib/tauri/media";
import type { MediaInfo } from "$lib/tauri/media";

/**
 * Tiras de fotogramas para ver por encima qué hay en cada vídeo.
 *
 * Son una sola imagen con 20 fotogramas en fila. Al pasar el ratón se enseña
 * el que toca moviendo el fondo, así que recorrer un clip no decodifica nada:
 * es tan barato como mover una imagen.
 */
export const FOTOGRAMAS = 20;

class Filmstrips {
  #listas = $state<Record<string, string>>({});
  #enCurso = new Set<string>();

  /** URL de la tira, o null si todavía no está. */
  src(path: string): string | null {
    const tira = this.#listas[path];
    return tira ? mediaSrc(tira) : null;
  }

  /** Pide las tiras que falten, de una en una para no ahogar la máquina. */
  async prepare(medios: MediaInfo[]) {
    const faltan = medios.filter(
      (m) => m.video && !m.isImage && !this.#listas[m.path] && !this.#enCurso.has(m.path),
    );
    faltan.forEach((m) => this.#enCurso.add(m.path));
    for (const m of faltan) {
      try {
        this.#listas[m.path] = await invoke<string>("make_filmstrip", { path: m.path });
      } catch {
        /* sin tira se enseña el icono de siempre */
      } finally {
        this.#enCurso.delete(m.path);
      }
    }
  }
}

export const filmstrips = new Filmstrips();

/** Estilo de fondo para enseñar el fotograma `i` de la tira. */
export function frameStyle(src: string, i: number): string {
  const pos = FOTOGRAMAS > 1 ? (Math.min(FOTOGRAMAS - 1, Math.max(0, i)) / (FOTOGRAMAS - 1)) * 100 : 0;
  return `background-image:url("${src}");background-size:${FOTOGRAMAS * 100}% 100%;background-position:${pos}% 0`;
}
