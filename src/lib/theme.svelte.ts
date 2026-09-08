import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemeMode = "system" | "light" | "dark";

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

const STORAGE_KEY = "quickcut.theme";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* sin localStorage (p. ej. vista previa) */
  }
  return "system";
}

class ThemeStore {
  mode: ThemeMode = $state(readStored());
  systemDark = $state(false);
  resolved: "light" | "dark" = $derived(
    this.mode === "system" ? (this.systemDark ? "dark" : "light") : this.mode,
  );

  /** Escucha la preferencia del sistema. Llamar una vez desde el layout; devuelve el cleanup. */
  init(): () => void {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    this.systemDark = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      this.systemDark = e.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }

  set(mode: ThemeMode) {
    this.mode = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignorar */
    }
  }

  /**
   * Aplica el tema al DOM (clase `.dark`) y a la ventana nativa (barra de título,
   * diálogos del sistema). Es reactivo si se llama dentro de un `$effect`.
   */
  apply() {
    document.documentElement.classList.toggle("dark", this.resolved === "dark");
    if (inTauri()) {
      getCurrentWindow()
        .setTheme(this.mode === "system" ? null : this.mode)
        .catch(() => {});
    }
  }
}

export const theme = new ThemeStore();
