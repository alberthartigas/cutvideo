/** Estado de la interfaz que no pertenece al proyecto (diálogos abiertos, etc.). */
export const ui = $state({
  settingsOpen: false,
  exportOpen: false,
  subtitlesOpen: false,
});

export const anyDialogOpen = () => ui.settingsOpen || ui.exportOpen || ui.subtitlesOpen;
