<script lang="ts">
  import { Captions, Trash2 } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import TextThumb from "../thumbs/TextThumb.svelte";
  import { project } from "$lib/project.svelte";
  import { ui } from "$lib/ui.svelte";
  import { SUBTITLE_STYLES } from "$lib/subtitles/cues";

  let hovered = $state<string | null>(null);
  let count = $derived(project.subtitleTrack.clips.length);

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
</script>

<PanelShell
  title="Subtítulos"
  hint={count ? `${count} subtítulos en S1 · clic en un estilo para cambiarlos todos` : "Transcribe el audio y aparecerán en la pista S1"}
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
        <TextThumb data={{ ...s.data, fontSize: 0.15, y: 0.5 }} label="Texto" playing={hovered === s.id} duration={2.2} />
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
    opacity: 0.5;
  }
  .label {
    overflow: hidden;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
