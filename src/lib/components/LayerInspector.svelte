<script lang="ts">
  import { LoaderCircle, Scissors, TriangleAlert } from "@lucide/svelte";
  import { project, type Clip } from "$lib/project.svelte";
  import { DEFAULT_LAYOUT, LAYOUT_PRESETS } from "$lib/layers";
  import { segmenter } from "$lib/segment/segmenter.svelte";

  /** Controles de una capa superpuesta: dónde va, cómo de grande y si se recorta. */
  let { clip }: { clip: Clip } = $props();

  let layout = $derived({ ...DEFAULT_LAYOUT, ...clip.layout });
  const set = (p: Parameters<typeof project.updateLayout>[1]) => project.updateLayout(clip.id, p);
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

  let activo = $derived(
    LAYOUT_PRESETS.find(
      (p) =>
        Math.abs((p.layout.x ?? 0.5) - layout.x) < 0.02 &&
        Math.abs((p.layout.y ?? 0.5) - layout.y) < 0.02 &&
        Math.abs((p.layout.scale ?? 1) - layout.scale) < 0.02,
    )?.id,
  );
</script>

<div class="border-b border-border px-3 py-2 text-xs">
  <h3 class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Capa superpuesta</h3>

  <div class="grid grid-cols-3 gap-1">
    {#each LAYOUT_PRESETS as p (p.id)}
      <button
        class="preset"
        class:active={activo === p.id}
        title={p.hint}
        onclick={() => { project.commit(); set(p.layout); }}
      >{p.label}</button>
    {/each}
  </div>

  <div class="mt-2 flex flex-col gap-1.5">
    <label class="row"><span>Tamaño</span>
      <input type="range" min="0.15" max="1.4" step="0.01" value={layout.scale}
        onpointerdown={() => project.commit()} oninput={(e) => set({ scale: num(e) })} />
      <span class="val">{Math.round(layout.scale * 100)}%</span>
    </label>
    <label class="row"><span>Horizontal</span>
      <input type="range" min="0" max="1" step="0.005" value={layout.x}
        onpointerdown={() => project.commit()} oninput={(e) => set({ x: num(e) })} />
    </label>
    <label class="row"><span>Vertical</span>
      <input type="range" min="0" max="1" step="0.005" value={layout.y}
        onpointerdown={() => project.commit()} oninput={(e) => set({ y: num(e) })} />
    </label>
    <label class="row"><span>Opacidad</span>
      <input type="range" min="0" max="1" step="0.02" value={layout.opacity}
        onpointerdown={() => project.commit()} oninput={(e) => set({ opacity: num(e) })} />
    </label>
  </div>

  <h3 class="mt-3 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
    <Scissors size={12} /> Recortar persona
  </h3>
  <label class="flex items-center gap-2">
    <input
      type="checkbox"
      class="accent-accent"
      checked={layout.cutout}
      onchange={(e) => { project.commit(); set({ cutout: e.currentTarget.checked }); }}
    />
    <span>Quitar el fondo y dejar solo a la persona</span>
  </label>
  {#if layout.cutout}
    {#if segmenter.error}
      <p class="mt-1 flex gap-1 text-[11px] text-red-500">
        <TriangleAlert size={12} class="mt-0.5 shrink-0" />{segmenter.error}
      </p>
    {:else if !segmenter.ready}
      <p class="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
        <LoaderCircle size={11} class="animate-spin" /> Preparando el recorte…
      </p>
    {/if}
    <label class="row mt-1.5"><span>Borde</span>
        <input type="range" min="0.05" max="1" step="0.02" value={layout.feather}
        onpointerdown={() => project.commit()} oninput={(e) => set({ feather: num(e) })} />
    </label>
    <p class="mt-1 text-[10px] text-muted">
      Funciona con personas. Si el fondo es liso, la pantalla verde recorta más fino.
    </p>
  {/if}
</div>

<style>
  .preset {
    height: 24px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-2);
    padding: 0 4px;
    font-size: 10px;
    color: var(--text);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .preset:hover {
    border-color: var(--muted);
  }
  .preset.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row > span:first-child {
    width: 72px;
    flex-shrink: 0;
    color: var(--muted);
  }
  .row input[type="range"] {
    min-width: 0;
    flex: 1;
    accent-color: var(--accent);
  }
  .val {
    width: 34px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
