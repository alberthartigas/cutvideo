import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Tamaño de la ventana según dónde estés.
 *
 * La pantalla de inicio se ve bien pequeña —es una lista de proyectos—, pero el
 * editor necesita sitio: el timeline, el preview y el inspector a la vez. Así
 * que al abrir un proyecto la ventana se maximiza sola y al salir vuelve a su
 * tamaño, en vez de tener que agrandarla a mano cada vez.
 */
export async function fitToWork(editing: boolean): Promise<void> {
  try {
    const win = getCurrentWindow();
    // Si el usuario ya la había maximizado, no hay nada que tocar.
    if ((await win.isMaximized()) === editing) return;
    await (editing ? win.maximize() : win.unmaximize());
  } catch {
    /* en modo navegador no hay ventana nativa */
  }
}
