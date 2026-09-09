<script lang="ts">
  import { onMount } from "svelte";
  import { FolderOpen, HardDrive, LoaderCircle, Plus, Trash2, TriangleAlert } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import { session, listProjects } from "$lib/session.svelte";
  import { deleteProject, projectsStorage, type ProjectSummary } from "$lib/tauri/projects";
  import { formatBytes, formatDuration } from "$lib/format";

  let projects = $state<ProjectSummary[]>([]);
  let storage = $state<{ path: string; size: number } | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let confirming = $state<string | null>(null);
  let busy = $state<string | null>(null);

  async function refresh() {
    loading = true;
    try {
      projects = await listProjects();
      const [path, size] = await projectsStorage();
      storage = { path, size };
      error = null;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(refresh);

  async function remove(id: string) {
    busy = id;
    try {
      await deleteProject(id);
      confirming = null;
      await refresh();
    } catch (e) {
      error = String(e);
    } finally {
      busy = null;
    }
  }

  async function open(id: string) {
    busy = id;
    try {
      await session.open_(id);
    } catch (e) {
      error = String(e);
    } finally {
      busy = null;
    }
  }

  /** "hace 5 min", "ayer", "12 mar" — más legible que una fecha completa. */
  function when(ms: number): string {
    const diff = Date.now() - ms;
    const min = Math.round(diff / 60000);
    if (min < 1) return "ahora mismo";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    if (d === 1) return "ayer";
    if (d < 7) return `hace ${d} días`;
    return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  }
</script>

<div class="flex h-screen flex-col bg-bg text-text">
  <header data-tauri-drag-region class="flex h-11 shrink-0 items-center pl-20"></header>

  <div class="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-8 pb-8">
    <div class="flex items-end justify-between gap-4 pt-4 pb-8">
      <div>
        <Logo class="h-8" />
        <p class="mt-2 text-sm text-muted">Tus proyectos. Elige uno para seguir o empieza de cero.</p>
      </div>
      <button class="btn-accent h-10 px-4 text-sm" onclick={() => session.create()}>
        <Plus size={16} /> Proyecto nuevo
      </button>
    </div>

    {#if error}
      <p class="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>
    {/if}

    {#if loading}
      <div class="flex flex-1 items-center justify-center text-muted">
        <LoaderCircle size={22} class="animate-spin" />
      </div>
    {:else if projects.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <FolderOpen size={34} class="text-muted opacity-50" />
        <p class="text-sm text-muted">Todavía no hay proyectos guardados.</p>
        <button class="btn-accent h-9 px-4" onclick={() => session.create()}>
          <Plus size={15} /> Crear el primero
        </button>
      </div>
    {:else}
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {#each projects as p (p.id)}
          <li class="card">
            <button class="cover" onclick={() => open(p.id)} title="Abrir «{p.name}»">
              {#if p.thumbnail}
                <img src={p.thumbnail} alt="" />
              {:else}
                <span class="empty">Sin vídeo</span>
              {/if}
              {#if busy === p.id}
                <span class="overlay"><LoaderCircle size={20} class="animate-spin" /></span>
              {/if}
            </button>

            <div class="flex items-start gap-1 px-2.5 pt-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium" title={p.name}>{p.name}</p>
                <p class="text-[11px] text-muted">
                  {when(p.modifiedAt)} · {p.clipCount}
                  {p.clipCount === 1 ? "clip" : "clips"} · {formatDuration(p.durationSec)}
                </p>
              </div>
              <button
                class="tool h-7 w-7 shrink-0 justify-center px-0"
                title="Borrar proyecto"
                onclick={() => (confirming = confirming === p.id ? null : p.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {#if p.missingMedia > 0}
              <p class="mx-2.5 mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <TriangleAlert size={11} />
                {p.missingMedia}
                {p.missingMedia === 1 ? "archivo no está" : "archivos no están"} donde estaban
              </p>
            {/if}

            <p class="px-2.5 pb-2 text-[11px] text-muted">{formatBytes(p.sizeBytes)} en disco</p>

            {#if confirming === p.id}
              <div class="confirm">
                <p>¿Borrar «{p.name}»? Tus vídeos originales no se tocan.</p>
                <div class="flex gap-1.5">
                  <button class="btn h-7 flex-1 justify-center" onclick={() => (confirming = null)}>Cancelar</button>
                  <button class="btn h-7 flex-1 justify-center text-red-500" disabled={busy === p.id} onclick={() => remove(p.id)}>
                    Borrar
                  </button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if storage}
      <p class="mt-8 flex items-center gap-1.5 text-[11px] text-muted">
        <HardDrive size={12} />
        {projects.length}
        {projects.length === 1 ? "proyecto" : "proyectos"} · {formatBytes(storage.size)} en
        <span class="truncate" title={storage.path}>{storage.path}</span>
      </p>
      <p class="mt-1 text-[11px] text-muted opacity-70">
        Un proyecto solo guarda los cortes y las rutas de tus vídeos, no copias de los archivos: por eso ocupa tan poco
        y borrarlo nunca borra tus vídeos.
      </p>
    {/if}
  </div>
</div>

<style>
  .card {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    transition: border-color 120ms;
  }
  .card:hover {
    border-color: var(--muted);
  }
  .cover {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .empty,
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--muted);
  }
  .overlay {
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border);
    background: var(--panel-2);
    padding: 8px 10px;
    font-size: 11px;
  }
</style>
