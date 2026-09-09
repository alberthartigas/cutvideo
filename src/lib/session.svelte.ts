import { project } from "$lib/project.svelte";
import { refreshSamples } from "$lib/preview/samples.svelte";
import { mediaSrc } from "$lib/tauri/media";
import {
  listProjects,
  loadProjectFile,
  newProjectId,
  PROJECT_VERSION,
  saveProjectFile,
  type ProjectFile,
  type ProjectSummary,
} from "$lib/tauri/projects";
import type { MediaInfo } from "$lib/tauri/media";
import { defaultTracks, type Track } from "$lib/project.svelte";

/** Empaqueta el estado actual del editor para guardarlo. */
function snapshotProject(id: string, name: string, createdAt: number): ProjectFile {
  const media = $state.snapshot(project.media) as MediaInfo[];
  const tracks = $state.snapshot(project.tracks) as Track[];
  return {
    version: PROJECT_VERSION,
    id,
    name,
    createdAt,
    modifiedAt: Date.now(),
    clipCount: project.clipCount,
    durationSec: project.duration,
    mediaPaths: media.map((m) => m.path),
    data: { media, tracks, aspect: project.aspect, fit: project.fit },
  };
}

/** Vuelca un proyecto guardado en el editor. */
function restoreProject(file: ProjectFile) {
  project.reset();
  project.media = file.data.media ?? [];
  // Un proyecto guardado con una versión anterior puede no traer todas las
  // pistas: se conservan las suyas y se añaden vacías las que falten.
  const saved = file.data.tracks ?? [];
  project.tracks = defaultTracks().map((def) => saved.find((t) => t.id === def.id) ?? def);
  if (file.data.aspect) project.aspect = file.data.aspect as typeof project.aspect;
  if (file.data.fit) project.fit = file.data.fit as typeof project.fit;
}

/**
 * Proyecto abierto. Sin proyecto abierto se enseña la pantalla de inicio.
 * El guardado es automático: cada cambio del timeline programa un guardado.
 */
class Session {
  id = $state<string | null>(null);
  name = $state("Proyecto sin título");
  createdAt = $state(0);
  saving = $state(false);
  /** Momento del último guardado correcto (ms). */
  savedAt = $state(0);
  error = $state<string | null>(null);

  #timer: ReturnType<typeof setTimeout> | undefined;
  #dirty = false;

  get open() {
    return this.id !== null;
  }

  /** Crea un proyecto en blanco y entra al editor. */
  create(name = "Proyecto sin título", aspect?: typeof project.aspect) {
    project.reset();
    if (aspect) project.aspect = aspect;
    this.id = newProjectId();
    this.name = name;
    this.createdAt = Date.now();
    this.savedAt = 0;
    this.error = null;
    this.#dirty = true;
    // Se guarda ya para que aparezca en la lista aunque no se toque nada.
    this.save();
  }

  async open_(id: string) {
    const file = await loadProjectFile(id);
    restoreProject(file);
    this.id = file.id;
    this.name = file.name;
    this.createdAt = file.createdAt;
    this.savedAt = file.modifiedAt;
    this.error = null;
    this.#dirty = false;
    refreshSamples();
  }

  /** Cierra el proyecto (guardando lo pendiente) y vuelve a la pantalla de inicio. */
  async close() {
    if (this.#dirty) await this.save();
    clearTimeout(this.#timer);
    this.id = null;
    project.reset();
  }

  rename(name: string) {
    this.name = name.trim() || "Proyecto sin título";
    this.touch();
  }

  /** Marca que hay cambios y programa el guardado. */
  touch() {
    if (!this.id) return;
    this.#dirty = true;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.save(), 1200);
  }

  async save(): Promise<ProjectSummary | null> {
    if (!this.id) return null;
    clearTimeout(this.#timer);
    this.saving = true;
    this.error = null;
    try {
      const file = snapshotProject(this.id, this.name, this.createdAt);
      const summary = await saveProjectFile(file, await thumbnail());
      this.createdAt = summary.createdAt;
      this.savedAt = summary.modifiedAt;
      this.#dirty = false;
      return summary;
    } catch (e) {
      this.error = String(e);
      return null;
    } finally {
      this.saving = false;
    }
  }
}

/** Captura un frame del primer clip para la portada del proyecto. */
function thumbnail(): Promise<string | null> {
  const clip = project.videoTrack.clips[0];
  if (!clip) return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const done = (v: string | null) => {
      video.removeAttribute("src");
      video.load();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 4000);
    video.onseeked = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = Math.max(1, Math.round((video.videoHeight / (video.videoWidth || 1)) * 320));
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        done(null);
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    video.onloadeddata = () => {
      video.currentTime = clip.in + Math.min(0.5, (clip.out - clip.in) / 2);
    };
    video.src = mediaSrc(clip.mediaPath);
  });
}

export const session = new Session();
export { listProjects };
