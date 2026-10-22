import type { Clip } from "$lib/project.svelte";

/**
 * El <video> que se ve ahora en V1 y su clip. Lo apunta el preview en cada
 * sincronización y lo leen los scopes. No es estado reactivo a propósito: se
 * escribe a cada fotograma y no debe disparar efectos.
 */
export const currentFrame: { el: HTMLVideoElement | null; clip: Clip | null } = { el: null, clip: null };
