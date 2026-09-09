<script lang="ts">
  import { onMount } from "svelte";
  import { FlipHorizontal2, Image as ImageIcon, LoaderCircle, Plus, Trash2, X } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import { project, type Clip } from "$lib/project.svelte";
  import { mediaSrc, pickImageFiles } from "$lib/tauri/media";
  import { patchLibrary } from "$lib/patches/library.svelte";
  import { BUILTIN_STICKERS, builtinPath, STICKER_GROUPS } from "$lib/patches/builtin";
  import { DEFAULT_PATCH } from "$lib/patches/types";
  import TrackObjectButton from "../TrackObjectButton.svelte";

  let importing = $state(false);
  let error = $state<string | null>(null);
  /** Parche cuyo botón de borrar está confirmando. */
  let removing = $state<string | null>(null);

  // La biblioteca es de la app, no del proyecto: los parches siguen ahí siempre.
  onMount(() => patchLibrary.load());
  let mine = $derived(patchLibrary.items);
  /** Parche seleccionado en el timeline, si lo hay. */
  let selected = $derived(project.selected?.clip.kind === "image" ? project.selected.clip : null);
  let patch = $derived(selected?.patch ?? DEFAULT_PATCH);

  /** Grupo de stickers abierto en la galería. */
  let group = $state(STICKER_GROUPS[0]);
  let shown = $derived(BUILTIN_STICKERS.filter((s) => s.group === group));

  async function importImages() {
    importing = true;
    error = null;
    try {
      const paths = await pickImageFiles();
      if (paths.length === 0) return;
      const added = await patchLibrary.add(paths);
      if (added === 0) {
        error = patchLibrary.error ?? "Esos archivos no se pueden usar como parche.";
      } else {
        error = null;
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

  <!-- Galería que viene con la app -->
  <div class="mb-2 flex flex-wrap gap-1">
    {#each STICKER_GROUPS as g (g)}
      <button class="chip" class:active={group === g} onclick={() => (group = g)}>{g}</button>
    {/each}
  </div>
  <div class="mb-3 grid grid-cols-4 gap-1.5">
    {#each shown as st (st.id)}
      <button
        class="tile"
        title="Poner «{st.name}» en el playhead"
        onclick={() => project.addPatch({ path: builtinPath(st.id), fileName: st.name })}
      >
        <img src={builtinPath(st.id).replace("builtin:", "")} alt={st.name} />
      </button>
    {/each}
  </div>

  <!-- Biblioteca del usuario: se guarda en la app y está en todos los proyectos -->
  <div class="mb-1.5 flex items-baseline gap-2 px-1">
    <h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">Tuyos</h3>
    {#if patchLibrary.loading}<LoaderCircle size={11} class="animate-spin text-muted" />{/if}
    {#if mine.length}<span class="ml-auto text-[10px] text-muted">en todos tus proyectos</span>{/if}
  </div>
  {#if mine.length}
    <div class="mb-3 grid grid-cols-4 gap-1.5">
      {#each mine as p (p.id)}
        <div class="relative">
          <button
            class="tile w-full"
            title="Poner «{p.name}» en el playhead"
            onclick={() => project.addPatch({ path: p.path, fileName: p.name })}
          >
            <img src={mediaSrc(p.path)} alt={p.name} />
          </button>
          <button
            class="remove"
            title={removing === p.id ? "Pulsa otra vez para quitarlo de la biblioteca" : "Quitar de la biblioteca"}
            onclick={() => {
              if (removing === p.id) {
                patchLibrary.remove(p.id);
                removing = null;
              } else {
                removing = p.id;
              }
            }}
            onmouseleave={() => (removing = removing === p.id ? null : removing)}
          >
            {#if removing === p.id}<Trash2 size={10} />{:else}<X size={10} />{/if}
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="mb-3 flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-[11px] text-muted">
      <ImageIcon size={16} class="shrink-0 opacity-50" />
      Con «Añadir» traes tus PNG, JPG, WebP o stickers de WhatsApp. Se quedan guardados para todos tus proyectos.
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
  .chip {
    border-radius: 999px;
    border: 1px solid var(--border);
    padding: 2px 8px;
    font-size: 10px;
    color: var(--muted);
  }
  .chip:hover {
    color: var(--text);
  }
  .chip.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }
  .tile {
    display: grid;
    aspect-ratio: 1;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background:
      repeating-conic-gradient(var(--panel-2) 0% 25%, var(--panel) 0% 50%) 50% / 12px 12px;
    padding: 3px;
  }
  .tile:hover {
    border-color: var(--accent);
  }
  .remove {
    position: absolute;
    top: -5px;
    right: -5px;
    display: grid;
    height: 16px;
    width: 16px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--panel);
    color: var(--muted);
    opacity: 0;
    transition: opacity 120ms;
  }
  .relative:hover .remove {
    opacity: 1;
  }
  .remove:hover {
    border-color: #ef4444;
    color: #ef4444;
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
