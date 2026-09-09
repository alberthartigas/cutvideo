import { invoke } from "@tauri-apps/api/core";

/** Efecto de sonido de los que trae la app. */
export interface SoundAsset {
  id: string;
  name: string;
  category: string;
  path: string;
}

export const builtinSfx = () => invoke<SoundAsset[]>("builtin_sfx");
