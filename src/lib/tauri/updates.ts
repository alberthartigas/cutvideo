import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

/**
 * Actualizaciones desde las releases de GitHub. Tauri comprueba la firma del
 * paquete con la clave pública que va dentro de la app, así que solo se instala
 * lo que se haya firmado con la clave privada del autor.
 */
export { getVersion };

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "found"; version: string; notes: string | null; date: string | null }
  | { kind: "downloading"; percent: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

let pending: Update | null = null;

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check();
    pending = update;
    if (!update) return { kind: "none" };
    return {
      kind: "found",
      version: update.version,
      notes: update.body ?? null,
      date: update.date ?? null,
    };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

/** Descarga e instala lo que encontró `checkForUpdate`. */
export async function installUpdate(onProgress: (percent: number) => void): Promise<UpdateState> {
  if (!pending) return { kind: "error", message: "No hay ninguna actualización preparada" };
  try {
    let total = 0;
    let hechos = 0;
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        hechos += event.data.chunkLength;
        onProgress(total > 0 ? Math.min(100, (hechos / total) * 100) : 0);
      }
    });
    return { kind: "ready" };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

export const restart = () => relaunch();
