import { invoke } from "@tauri-apps/api/core";
import { project } from "$lib/project.svelte";
import { buildExportPlan, NO_ASSETS, type ExportPlan } from "./export";

// Espejo de src-tauri/src/loudness.rs.
export interface LoudnessReport {
  integrated: number;
  range: number;
  truePeak: number;
  step: number;
  momentary: number[];
  shortTerm: number[];
}

/** Objetivos de sonoridad habituales (LUFS integrados). */
export const LOUDNESS_TARGETS = [
  { lufs: -14, name: "YouTube, Spotify, TikTok" },
  { lufs: -16, name: "Apple, pódcast" },
  { lufs: -23, name: "Televisión (EBU R128)" },
] as const;

/** Lo que importa del plan para el audio: si cambia, la medida está vieja. */
function audioKey(p: ExportPlan): string {
  const c = (x: { path: string; in: number; out: number; start: number; hasAudio: boolean }) =>
    [x.path, x.in, x.out, x.start, x.hasAudio];
  return JSON.stringify([
    p.video.map((v) => [...c(v), v.transition?.duration ?? 0]),
    p.audio.map(c),
    p.background.map(c),
    p.layers.map((l) => c(l.clip)),
  ]);
}

function currentPlan(): ExportPlan {
  // El vídeo no se mide: tamaño y codificador dan igual.
  return buildExportPlan("", project.frame, "auto", NO_ASSETS);
}

export const loudness = $state({
  report: null as LoudnessReport | null,
  /** `audioKey` del montaje que se midió. */
  key: "",
  measuring: false,
  error: null as string | null,
});

/** true si el montaje cambió desde la última medida. */
export const loudnessStale = () =>
  loudness.report !== null && project.videoTrack.clips.length > 0 && audioKey(currentPlan()) !== loudness.key;

export async function measureLoudness() {
  if (loudness.measuring || project.videoTrack.clips.length === 0) return;
  const plan = currentPlan();
  loudness.measuring = true;
  loudness.error = null;
  try {
    loudness.report = await invoke<LoudnessReport>("measure_loudness", { plan });
    loudness.key = audioKey(plan);
  } catch (e) {
    loudness.error = String(e);
  } finally {
    loudness.measuring = false;
  }
}

/** Lectura en el instante `t` de una curva de la medida. */
export function readingAt(curve: number[], step: number, t: number): number {
  if (curve.length === 0) return -70;
  // La muestra k cubre hasta (k+1)·step: la del instante es la siguiente marca.
  const k = Math.min(curve.length - 1, Math.max(0, Math.ceil(t / step) - 1));
  return curve[k];
}
