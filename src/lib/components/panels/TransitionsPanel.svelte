<script lang="ts">
  import { CheckCheck, X } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import TransitionThumb from "../thumbs/TransitionThumb.svelte";
  import { clipEnd, effectiveTransition, project, type Clip } from "$lib/project.svelte";
  import { DEFAULT_TRANSITION_DURATION, TRANSITION_MAX, TRANSITION_MIN, TRANSITIONS } from "$lib/transitions/presets";
  import { formatDuration } from "$lib/format";

  let hovered = $state<string | null>(null);
  let duration = $state(DEFAULT_TRANSITION_DURATION);

  /**
   * Corte al que se aplica: el del clip seleccionado si tiene uno detrás; si no,
   * el corte más cercano al playhead. Igual que CapCut, no hace falta seleccionar nada.
   */
  let target = $derived.by((): { clip: Clip; next: Clip } | null => {
    const clips = project.videoTrack.clips;
    if (clips.length < 2) return null;
    const sel = project.selected?.clip;
    if (sel && project.selected?.track.magnetic) {
      const next = project.nextClip(sel);
      if (next) return { clip: sel, next };
    }
    let best: { clip: Clip; next: Clip } | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < clips.length - 1; i++) {
      const cut = clipEnd(clips[i]) - effectiveTransition(clips[i], clips[i + 1]) / 2;
      const d = Math.abs(cut - project.playhead);
      if (d < bestDist) {
        bestDist = d;
        best = { clip: clips[i], next: clips[i + 1] };
      }
    }
    return best;
  });
  let current = $derived(target?.clip.transition?.id ?? null);

  function apply(id: string) {
    if (!target) return;
    project.setTransition(target.clip.id, id, duration);
    project.selectedId = target.clip.id;
  }
</script>

<PanelShell
  title="Transiciones"
  hint={target
    ? `Se aplica al corte ${project.videoTrack.clips.indexOf(target.clip) + 1}→${project.videoTrack.clips.indexOf(target.next) + 1} · pasa el ratón para ver cada una`
    : "Añade dos clips o más al timeline para poner transiciones"}
>
  {#snippet action()}
    {#if target}
      <button class="tool h-6" title="Aplicar a todos los cortes" onclick={() => current && project.applyTransitionToAll(current, duration)} disabled={!current}>
        <CheckCheck size={13} /> Todos
      </button>
    {/if}
  {/snippet}

  <label class="mb-2 flex items-center gap-2 px-1 text-xs">
    <span class="text-muted">Duración</span>
    <input class="flex-1 accent-accent" type="range" min={TRANSITION_MIN} max={TRANSITION_MAX} step="0.05" bind:value={duration}
      onchange={() => current && target && project.setTransition(target.clip.id, current, duration)} />
    <span class="w-10 text-right tabular-nums">{formatDuration(duration).slice(3)}</span>
  </label>

  <div class="grid grid-cols-2 gap-2">
    {#each TRANSITIONS as t (t.id)}
      <button
        class="item"
        class:active={current === t.id}
        disabled={!target}
        onmouseenter={() => (hovered = t.id)}
        onmouseleave={() => (hovered = null)}
        onclick={() => apply(t.id)}
        title={t.name}
      >
        <TransitionThumb id={t.id} playing={hovered === t.id} />
        <span class="label">{t.name}</span>
      </button>
    {/each}
  </div>

  {#if current}
    <button class="btn mt-2 h-7 w-full justify-center" onclick={() => target && project.setTransition(target.clip.id, null)}>
      <X size={13} /> Quitar transición
    </button>
  {/if}
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
    opacity: 0.45;
  }
  .label {
    overflow: hidden;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
