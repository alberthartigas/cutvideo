<script lang="ts">
  import { Captions, MousePointerClick, Trash2 } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import TextThumb from "../thumbs/TextThumb.svelte";
  import { project } from "$lib/project.svelte";
  import { ui } from "$lib/ui.svelte";
  import { SUBTITLE_STYLES } from "$lib/subtitles/cues";

  let hovered = $state<string | null>(null);
  let count = $derived(project.subtitleTrack.clips.length);
  /** Lo que enseñan los mandos: cómo está el primer subtítulo. */
  let actual = $derived(project.subtitleTrack.clips[0]?.text ?? null);

  /** Cambia el estilo de todos los subtítulos ya generados. */
  function restyle(id: string) {
    const style = SUBTITLE_STYLES.find((s) => s.id === id);
    if (!style || count === 0) return;
    project.commit();
    for (const clip of project.subtitleTrack.clips) {
      if (!clip.text) continue;
      const { text, wordTimes } = clip.text;
      clip.text = { ...style.data, text, wordTimes };
    }
  }

  /** Retoca a la vez todos los subtítulos (tamaño, alto, ancho). */
  function todos(patch: { fontSize?: number; y?: number; maxWidth?: number }) {
    project.updateTexts(
      project.subtitleTrack.clips.map((c) => c.id),
      patch,
    );
  }
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const ALTURAS = [
    { label: "Arriba", y: 0.14 },
    { label: "Centro", y: 0.5 },
    { label: "Abajo", y: 0.86 },
  ];
</script>

<PanelShell
  title="Subtítulos"
  hint={count
    ? `${count} subtítulos en S1 · los mandos y los estilos cambian todos a la vez`
    : "Transcribe el audio y aparecerán en la pista S1"}
>
  {#snippet action()}
    {#if count}
      <button class="tool h-6" title="Borrar todos los subtítulos" onclick={() => { project.commit(); project.subtitleTrack.clips = []; }}>
        <Trash2 size={13} />
      </button>
    {/if}
  {/snippet}

  <button class="btn-accent mb-3 h-8 w-full justify-center" disabled={project.videoTrack.clips.length === 0} onclick={() => (ui.subtitlesOpen = true)}>
    <Captions size={14} /> Generar subtítulos
  </button>

  {#if actual}
    <!-- El panel es estrecho: cada mando ocupa su fila, con el valor debajo del rótulo. -->
    <div class="mb-3 flex flex-col gap-2 text-[11px]" onfocusin={() => project.commit()}>
      <label class="flex flex-col gap-0.5">
        <span class="flex justify-between text-muted">
          <span>Tamaño</span><span class="tabular-nums">{(actual.fontSize * 100).toFixed(1)}%</span>
        </span>
        <input
          class="accent-accent"
          type="range"
          min="0.025"
          max="0.12"
          step="0.002"
          value={actual.fontSize}
          oninput={(e) => todos({ fontSize: num(e) })}
        />
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="flex justify-between text-muted">
          <span>Altura</span><span class="tabular-nums">{Math.round(actual.y * 100)}%</span>
        </span>
        <input
          class="accent-accent"
          type="range"
          min="0.05"
          max="0.95"
          step="0.005"
          value={actual.y}
          oninput={(e) => todos({ y: num(e) })}
        />
      </label>
      <div class="seg">
        {#each ALTURAS as a (a.label)}
          <button
            class="seg-btn"
            class:active={Math.abs(actual.y - a.y) < 0.01}
            onclick={() => {
              project.commit();
              todos({ y: a.y });
            }}
          >
            {a.label}
          </button>
        {/each}
      </div>
      <label class="flex flex-col gap-0.5">
        <span class="flex justify-between text-muted">
          <span>Ancho máx.</span><span class="tabular-nums">{Math.round(actual.maxWidth * 100)}%</span>
        </span>
        <input
          class="accent-accent"
          type="range"
          min="0.3"
          max="1"
          step="0.01"
          value={actual.maxWidth}
          oninput={(e) => todos({ maxWidth: num(e) })}
        />
      </label>
      <button class="btn h-7 w-full justify-center" onclick={() => project.selectSubtitles()}>
        <MousePointerClick size={13} /> Marcarlos todos
      </button>
      <p class="text-[10px] leading-snug text-muted">
        Marcados, el inspector cambia fuente, color y animación de todos a la vez.
      </p>
    </div>
  {/if}

  <div class="grid grid-cols-2 gap-2">
    {#each SUBTITLE_STYLES as s (s.id)}
      <button
        class="item"
        disabled={count === 0}
        onmouseenter={() => (hovered = s.id)}
        onmouseleave={() => (hovered = null)}
        onclick={() => restyle(s.id)}
        title={s.hint}
      >
        <TextThumb data={{ ...s.data, fontSize: 0.15, y: 0.5 }} label="Texto" playing={hovered === s.id} duration={1.8} />
        <span class="label">{s.name}</span>
      </button>
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
