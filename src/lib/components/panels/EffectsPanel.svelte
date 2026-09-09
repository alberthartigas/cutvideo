<script lang="ts">
  import { CheckCheck, RefreshCw } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import EffectThumb from "../thumbs/EffectThumb.svelte";
  import { project } from "$lib/project.svelte";
  import { DEFAULT_ADJUSTMENTS, EFFECTS, type Adjustments } from "$lib/effects/presets";

  let hovered = $state<string | null>(null);

  /** Clip al que se aplica: el seleccionado, o el que haya bajo el playhead. */
  let target = $derived(
    (project.selected?.clip.kind !== "text" ? project.selected?.clip : null) ??
      project.clipAt(project.videoTrack, project.playhead),
  );
  let current = $derived(target?.effects?.preset ?? null);
  let adjust = $derived<Adjustments>(target?.effects?.adjust ?? DEFAULT_ADJUSTMENTS);

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

  <div class="mt-3 flex items-center justify-between px-1">
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
</style>
