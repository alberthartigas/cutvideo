import { invoke } from "@tauri-apps/api/core";

/** Un parche guardado en la biblioteca de la app (espejo de patches.rs). */
export interface PatchAsset {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
}

/**
 * Biblioteca de parches del usuario. Vive en los datos de la app, así que los
 * parches siguen ahí en cualquier proyecto, hoy y mañana.
 */
class PatchLibrary {
  items = $state<PatchAsset[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  #loaded = false;

  /** Carga la lista una sola vez (o de nuevo si `force`). */
  async load(force = false) {
    if (this.#loaded && !force) return;
    this.loading = true;
    try {
      this.items = await invoke<PatchAsset[]>("list_patches");
      this.#loaded = true;
      this.error = null;
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  }

  /** Copia imágenes a la biblioteca. Devuelve cuántas entraron. */
  async add(paths: string[]): Promise<number> {
    let added = 0;
    this.error = null;
    for (const path of paths) {
      try {
        const asset = await invoke<PatchAsset>("import_patch", { path });
        this.items = [...this.items.filter((i) => i.id !== asset.id), asset].sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
        added++;
      } catch (e) {
        this.error = String(e);
      }
    }
    return added;
  }

  async remove(id: string) {
    try {
      await invoke("delete_patch", { id });
      this.items = this.items.filter((i) => i.id !== id);
    } catch (e) {
      this.error = String(e);
    }
  }
}

export const patchLibrary = new PatchLibrary();
