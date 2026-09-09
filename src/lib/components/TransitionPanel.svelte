<script lang="ts">
  import { ArrowLeftRight } from "@lucide/svelte";
  import { clipDuration, effectiveTransition, project, type Clip } from "$lib/project.svelte";
  import { DEFAULT_TRANSITION_DURATION, TRANSITION_MAX, TRANSITION_MIN, TRANSITIONS } from "$lib/transitions/presets";
  import { formatDuration } from "$lib/format";

  let { clip, next }: { clip: Clip; next: Clip } = $props();
  let current = $derived(clip.transition?.id ?? null);
  let duration = $derived(clip.transition?.duration ?? DEFAULT_TRANSITION_DURATION);
  let effective = $derived(effectiveTransition(clip, next));
  let maxAllowed = $derived(Math.min(TRANSITION_MAX, clipDuration(clip) / 2, clipDuration(next) / 2));

  function choose(id: string | null) {
    project.setTransition(clip.id, id, duration);
  }
  function onDuration(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (current) project.setTransition(clip.id, current, v);
  }
</script>

<div class="border-b border-border px-3 py-2 text-xs">
  <h3 class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
    <ArrowLeftRight size={12} /> Transición al siguiente clip
  </h3>
  <div class="grid grid-cols-3 gap-1">
    <button class="preset" class:active={current === null} onclick={() => choose(null)}>Ninguna</button>
    {#each TRANSITIONS as t (t.id)}
      <button class="preset" class:active={current === t.id} onclick={() => choose(t.id)}>{t.name}</button>
    {/each}
  </div>
  {#if current}
    <label class="mt-2 flex items-center gap-2">
      <span class="w-16 shrink-0 text-muted">Duración</span>
      <input class="flex-1 accent-accent" type="range" min={TRANSITION_MIN} max={TRANSITION_MAX} step="0.05" value={duration} oninput={onDuration} />
      <span class="w-14 text-right tabular-nums">{formatDuration(effective).slice(3)}</span>
    </label>
    {#if effective < duration - 0.01}
      <p class="mt-1 text-[11px] text-muted">Limitada a {formatDuration(maxAllowed).slice(3)}: los clips son cortos.</p>
    {/if}
  {/if}
  <div class="mt-2 flex gap-1">
    <button class="btn h-6 flex-1 justify-center" onclick={() => project.applyTransitionToAll(current, duration)}>
      {current ? "Aplicar a todos los cortes" : "Quitar todas"}
    </button>
  </div>
</div>

<style>
  .preset {
    height: 26px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-2);
    padding: 0 6px;
    font-size: 11px;
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
</style>
