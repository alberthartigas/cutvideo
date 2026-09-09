<script lang="ts">
  import { CheckCheck, RefreshCw, TriangleAlert } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import EffectThumb from "../thumbs/EffectThumb.svelte";
  import { project } from "$lib/project.svelte";
  import { DEFAULT_ADJUSTMENTS, EFFECTS, type Adjustments } from "$lib/effects/presets";
  import { CHROMA_PRESETS, DEFAULT_CHROMA } from "$lib/effects/chroma";

  let hovered = $state<string | null>(null);

  /** Clip al que se aplica: el seleccionado, o el que haya bajo el playhead. */
  let target = $derived(
    (project.selected?.clip.kind !== "text" ? project.selected?.clip : null) ??
      project.clipAt(project.videoTrack, project.playhead),
  );
  let current = $derived(target?.effects?.preset ?? null);
  let adjust = $derived<Adjustments>(target?.effects?.adjust ?? DEFAULT_ADJUSTMENTS);
  let chroma = $derived(target?.effects?.chroma ?? DEFAULT_CHROMA);
  // Sin nada en la pista de fondo, quitar el verde solo deja negro.
  let noBackground = $derived(chroma.enabled && project.backgroundTrack.clips.length === 0);

  const SLIDERS: { key: keyof Adjustments; label: string; min: number; max: number; step: number }[] = [
    { key: "brightness", label: "Brillo", min: -0.6, max: 0.6, step: 0.02 },
    { key: "contrast", label: "Contraste", min: 0.4, max: 2, step: 0.02 },
    { key: "saturation", label: "Saturación", min: 0, max: 2.5, step: 0.02 },
    { key: "hue", label: "Tono", min: -180, max: 180, step: 1 },
    { key: "blur", label: "Desenfoque", min: 0, max: 1, step: 0.02 },
    { key: "vignette", label: "Viñeta", min: 0, max: 1, step: 0.02 },
  ];
</script>

<PanelShell title="Efectos" hint={target ? `Se aplica a ${target.name}` : "Añade un clip de vídeo al timeline"}>
  {#snippet action()}
    {#if target}
      <button class="tool h-6" title="Aplicar a todos los clips" onclick={() => project.applyEffectToAll(target.id)}>
        <CheckCheck size={13} /> Todos
      </button>
    {/if}
  {/snippet}

  <div class="grid grid-cols-2 gap-2">
    <button class="item" class:active={current === null} disabled={!target} onclick={() => target && project.setEffect(target.id, null)}>
      <EffectThumb id={null} />
      <span class="label">Ninguno</span>
    </button>
    {#each EFFECTS as e (e.id)}
      <button
        class="item"
        class:active={current === e.id}
        disabled={!target}
        onmouseenter={() => (hovered = e.id)}
        onmouseleave={() => (hovered = null)}
        onclick={() => target && project.setEffect(target.id, e.id)}
        title={e.name}
      >
        <EffectThumb id={e.id} playing={hovered === e.id} />
        <span class="label">{e.name}</span>
      </button>
    {/each}
  </div>

  <h3 class="mt-4 mb-2 px-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Pantalla verde</h3>
  <div class="flex flex-col gap-2 px-1 text-xs">
    <label class="flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-accent"
        checked={chroma.enabled}
        disabled={!target}
        onchange={(e) => { project.commit(); target && project.setChroma(target.id, { enabled: e.currentTarget.checked }); }}
      />
      <span>Quitar el fondo de color</span>
    </label>
    {#if chroma.enabled}
      <div class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-muted">Color</span>
        {#each CHROMA_PRESETS as c (c.color)}
          <button
            class="swatch"
            class:active={chroma.color.toLowerCase() === c.color}
            style="background:{c.color}"
            title={c.name}
            onclick={() => { project.commit(); target && project.setChroma(target.id, { color: c.color }); }}
            aria-label={c.name}
          ></button>
        {/each}
        <input
          type="color"
          class="h-6 w-8 cursor-pointer rounded border border-border bg-panel"
          value={chroma.color}
          title="Elegir otro color"
          oninput={(e) => target && project.setChroma(target.id, { color: e.currentTarget.value })}
        />
      </div>
      <label class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-muted">Cuánto quita</span>
        <input class="min-w-0 flex-1 accent-accent" type="range" min="0.02" max="0.8" step="0.01" value={chroma.similarity}
          onpointerdown={() => project.commit()} oninput={(e) => target && project.setChroma(target.id, { similarity: Number(e.currentTarget.value) })} />
      </label>
      <label class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-muted">Suavizado</span>
        <input class="min-w-0 flex-1 accent-accent" type="range" min="0" max="0.5" step="0.01" value={chroma.blend}
          onpointerdown={() => project.commit()} oninput={(e) => target && project.setChroma(target.id, { blend: Number(e.currentTarget.value) })} />
      </label>
      <label class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-muted">Quitar tinte</span>
        <input class="min-w-0 flex-1 accent-accent" type="range" min="0" max="1" step="0.02" value={chroma.spill}
          onpointerdown={() => project.commit()} oninput={(e) => target && project.setChroma(target.id, { spill: Number(e.currentTarget.value) })} />
      </label>
      {#if noBackground}
        <p class="flex gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <TriangleAlert size={12} class="mt-0.5 shrink-0" />
          Pon una imagen o un vídeo en la pista F1 para que se vea por detrás; si no, el fondo queda negro.
        </p>
      {/if}
    {/if}
  </div>

  <div class="mt-4 flex items-center justify-between px-1">
    <h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">Ajustes</h3>
    <button class="tool h-6" title="Restablecer" disabled={!target} onclick={() => target && project.setAdjust(target.id, DEFAULT_ADJUSTMENTS)}>
      <RefreshCw size={12} />
    </button>
  </div>
  <div class="flex flex-col gap-1.5 px-1 text-xs">
    {#each SLIDERS as s (s.key)}
      <label class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-muted">{s.label}</span>
        <input
          class="min-w-0 flex-1 accent-accent"
          type="range"
          min={s.min}
          max={s.max}
          step={s.step}
          value={adjust[s.key]}
          disabled={!target}
          onpointerdown={() => project.commit()}
          oninput={(e) => target && project.setAdjust(target.id, { [s.key]: Number(e.currentTarget.value) })}
        />
      </label>
    {/each}
  </div>
</PanelShell>

<style>
  .item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 3px;
    text-align: center;
  }
  .item:hover:not(:disabled) {
    border-color: var(--muted);
  }
  .item.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .item:disabled {
    opacity: 0.72;
  }
  .label {
    overflow: hidden;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .swatch {
    height: 20px;
    width: 20px;
    border: 2px solid transparent;
    border-radius: 5px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  }
  .swatch.active {
    border-color: var(--accent);
  }
</style>
