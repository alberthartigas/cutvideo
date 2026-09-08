/** 83.4 -> "01:23.40"; 3725 -> "1:02:05.00" */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "--:--";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const cs = Math.floor((sec - total) * 100);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const cc = String(cs).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}.${cc}` : `${mm}:${ss}.${cc}`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatBitrate(bps: number | null): string {
  if (!bps) return "—";
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mb/s` : `${Math.round(bps / 1000)} kb/s`;
}

export function formatFps(fps: number): string {
  if (!fps) return "—";
  return Number.isInteger(fps) ? `${fps}` : fps.toFixed(2);
}

/** Último segmento de una ruta, tanto con "/" (Mac) como con "\" (Windows). */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
