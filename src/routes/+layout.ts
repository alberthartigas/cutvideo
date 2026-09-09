// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
export const ssr = false;

/** En dev y fuera de Tauri (navegador normal) se simula la API nativa antes de montar la UI. */
export async function load() {
  if (import.meta.env.DEV && typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    const { installDevMock } = await import("$lib/dev-mock");
    installDevMock();
  }
}
