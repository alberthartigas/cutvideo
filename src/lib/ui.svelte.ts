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

export const ui = $state({
  settingsOpen: false,
  exportOpen: false,
  subtitlesOpen: false,
  /** Sección abierta en la barra lateral izquierda. */
  panel: "media" as PanelId,
});

export function openPanel(id: PanelId) {
  ui.panel = id;
}

export const anyDialogOpen = () => ui.settingsOpen || ui.exportOpen || ui.subtitlesOpen;
