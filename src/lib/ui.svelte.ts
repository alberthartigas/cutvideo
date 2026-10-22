/** Estado de la interfaz que no pertenece al proyecto (diálogos abiertos, etc.). */
export type PanelId =
  | "media"
  | "audio"
  | "text"
  | "subtitles"
  | "patches"
  | "effects"
  | "transitions"
  | "autoedit";

export type ScopeKind = "waveform" | "parade" | "vectorscope";

/** Los scopes se recuerdan abiertos o cerrados entre sesiones. */
function savedScopes(): boolean {
  try {
    return localStorage.getItem("cutvideo.scopes") === "1";
  } catch {
    return false;
  }
}

export function toggleScopes() {
  ui.scopesOpen = !ui.scopesOpen;
  try {
    localStorage.setItem("cutvideo.scopes", ui.scopesOpen ? "1" : "0");
  } catch {
    // Sin almacenamiento (ventana privada): solo dura esta sesión.
  }
}

export const ui = $state({
  /** Scopes en lo alto del inspector, y cuál se ve. */
  scopesOpen: savedScopes(),
  scope: "waveform" as ScopeKind,
  settingsOpen: false,
  aboutOpen: false,
  exportOpen: false,
  subtitlesOpen: false,
  /** Sección abierta en la barra lateral izquierda. */
  panel: "media" as PanelId,
});

export function openPanel(id: PanelId) {
  ui.panel = id;
}

export const anyDialogOpen = () => ui.settingsOpen || ui.exportOpen || ui.subtitlesOpen || ui.aboutOpen;
