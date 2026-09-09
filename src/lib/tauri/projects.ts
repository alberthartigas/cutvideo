import { invoke } from "@tauri-apps/api/core";
import type { Track } from "$lib/project.svelte";
import type { MediaInfo } from "$lib/tauri/media";

// Espejo de src-tauri/src/projects.rs.
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  sizeBytes: number;
  clipCount: number;
  durationSec: number;
  thumbnail: string | null;
  /** Archivos referenciados que ya no están en su sitio. */
  missingMedia: number;
}

export interface ProjectFile {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  clipCount: number;
  durationSec: number;
  mediaPaths: string[];
  data: { media: MediaInfo[]; tracks: Track[]; aspect?: string; fit?: string };
}

export const PROJECT_VERSION = 1;

export const listProjects = () => invoke<ProjectSummary[]>("list_projects");
export const loadProjectFile = (id: string) => invoke<ProjectFile>("load_project", { id });
export const deleteProject = (id: string) => invoke<void>("delete_project", { id });
export const projectsStorage = () => invoke<[string, number]>("projects_storage");
export const saveProjectFile = (file: ProjectFile, thumbnail: string | null) =>
  invoke<ProjectSummary>("save_project", { file, thumbnail });

export function newProjectId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
