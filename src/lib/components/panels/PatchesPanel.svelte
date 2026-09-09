<script lang="ts">
  import { FlipHorizontal2, Image as ImageIcon, Plus, Trash2 } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import { project, type Clip } from "$lib/project.svelte";
  import { IMAGE_EXTENSIONS, pickMediaFiles, probeMedia, type MediaInfo } from "$lib/tauri/media";
  import { mediaSrc } from "$lib/tauri/media";
  import { DEFAULT_PATCH } from "$lib/patches/types";
  import TrackObjectButton from "../TrackObjectButton.svelte";

  let importing = $state(false);
  let error = $state<string | null>(null);

  let images = $derived(project.media.filter((m) => m.isImage));
  /** Parche seleccionado en el timeline, si lo hay. */
  let selected = $derived(project.selected?.clip.kind === "image" ? project.selected.clip : null);
  let patch = $derived(selected?.patch ?? DEFAULT_PATCH);

  async function importImages() {
    importing = true;
    error = null;
    try {
      for (const path of await pickMediaFiles()) {
        if (!IMAGE_EXTENSIONS.some((e) => path.toLowerCase().endsWith(`.${e}`))) continue;
        if (project.media.some((m) => m.path === path)) continue;
        project.addMedia(await probeMedia(path));
      }
    } catch (e) {
      error = String(e);
    } finally {
      importing = false;
    }
  }

  const set = (p: Parameters<typeof project.updatePatch>[1]) => selected && project.updatePatch(selected.id, p);
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

  const POSITIONS: { label: string; x: number; y: number }[] = [
    { label: "↖", x: 0.2, y: 0.2 },
    { label: "↑", x: 0.5, y: 0.18 },
    { label: "↗", x: 0.8, y: 0.2 },
    { label: "←", x: 0.18, y: 0.5 },
    { label: "•", x: 0.5, y: 0.5 },
    { label: "→", x: 0.82, y: 0.5 },
    { label: "↙", x: 0.2, y: 0.8 },
    { label: "↓", x: 0.5, y: 0.82 },
    { label: "↘", x: 0.8, y: 0.8 },
  ];
</script>

<PanelShell
  title="Parches"
  hint="Imágenes, PNG con transparencia y stickers de WhatsApp encima del vídeo"
>
  {#snippet action()}
    <button class="btn-accent" disabled={importing} onclick={importImages}>
      <Plus size={13} />
      {importing ? "Añadiendo…" : "Añadir"}
    </button>
  {/snippet}

  {#if error}
    <p class="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{error}</p>
  {/if}

  {#if images.length}
    <div class="mb-3 grid grid-cols-3 gap-2">
      {#each images as img (img.path)}
        <button class="tile" title="Poner «{img.fileName}» en el playhead" onclick={() => project.addClip(img)}>
          <img src={mediaSrc(img.path)} alt={img.fileName} />
        </button>
      {/each}
    </div>
  {:else}
    <p class="mb-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
      <ImageIcon size={20} class="mx-auto mb-2 opacity-50" />
      Añade PNG, JPG, WebP o stickers y aparecerán aquí.
    </p>
  {/if}

  {#if selected}
    <h3 class="mb-2 px-1 text-[11px] font-semibold tracking-wider text-muted uppercase">
      {selected.name}
    </h3>

    <TrackObjectButton clip={selected} />

    <div class="mt-2 flex flex-col gap-2 px-1 text-xs">
      <div class="flex items-center gap-2">
        <span class="w-16 shrink-0 text-muted">Colocar</span>
        <div class="grid grid-cols-3 gap-0.5">
          {#each POSITIONS as p (p.label)}
            <button
              class="pos"
              class:active={Math.abs(patch.x - p.x) < 0.02 && Math.abs(patch.y - p.y) < 0.02}
              onclick={() => { project.commit(); set({ x: p.x, y: p.y }); }}
            >{p.label}</button>
          {/each}
        </div>
        <button
          class="tool ml-auto h-7 w-7 justify-center px-0"
          class:text-accent={patch.flip}
          title="Voltear"
          onclick={() => { project.commit(); set({ flip: !patch.flip }); }}
        >
          <FlipHorizontal2 size={14} />
        </button>
        <button class="tool h-7 w-7 justify-center px-0" title="Quitar del timeline" onclick={() => project.deleteSelected()}>
          <Trash2 size={14} />
        </button>
      </div>

      <label class="row"><span>Tamaño</span>
        <input type="range" min="0.05" max="1.5" step="0.01" value={patch.width}
          onpointerdown={() => project.commit()} oninput={(e) => set({ width: num(e) })} />
        <span class="val">{Math.round(patch.width * 100)}%</span>
      </label>
      <label class="row"><span>Horizontal</span>
        <input type="range" min="-0.2" max="1.2" step="0.005" value={patch.x}
          onpointerdown={() => project.commit()} oninput={(e) => set({ x: num(e) })} />
      </label>
      <label class="row"><span>Vertical</span>
        <input type="range" min="-0.2" max="1.2" step="0.005" value={patch.y}
          onpointerdown={() => project.commit()} oninput={(e) => set({ y: num(e) })} />
      </label>
      <label class="row"><span>Giro</span>
        <input type="range" min="-180" max="180" step="1" value={patch.rotation}
          onpointerdown={() => project.commit()} oninput={(e) => set({ rotation: num(e) })} />
        <span class="val">{Math.round(patch.rotation)}°</span>
      </label>
      <label class="row"><span>Opacidad</span>
        <input type="range" min="0" max="1" step="0.02" value={patch.opacity}
          onpointerdown={() => project.commit()} oninput={(e) => set({ opacity: num(e) })} />
      </label>
    </div>
  {:else if project.patchTrack.clips.length === 0}
    <p class="px-1 text-[11px] text-muted">Pulsa una imagen para ponerla en el playhead.</p>
  {:else}
    <p class="px-1 text-[11px] text-muted">Selecciona un parche en la pista P1 para colocarlo.</p>
  {/if}
</PanelShell>

<style>
  .tile {
    display: grid;
    aspect-ratio: 1;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background:
      repeating-conic-gradient(var(--panel-2) 0% 25%, var(--panel) 0% 50%) 50% / 12px 12px;
    padding: 4px;
  }
  .tile:hover {
    border-color: var(--accent);
  }
  .tile img {
    max-height: 100%;
    max-width: 100%;
    object-fit: contain;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row > span:first-child {
    width: 64px;
    flex-shrink: 0;
    color: var(--muted);
  }
  .row input[type="range"] {
    min-width: 0;
    flex: 1;
    accent-color: var(--accent);
  }
  .val {
    width: 38px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .pos {
    height: 18px;
    width: 18px;
    border-radius: 4px;
    background: var(--panel-2);
    font-size: 10px;
    line-height: 1;
    color: var(--muted);
  }
  .pos:hover {
    color: var(--text);
  }
  .pos.active {
    background: var(--accent);
    color: var(--accent-fg);
  }
</style>
