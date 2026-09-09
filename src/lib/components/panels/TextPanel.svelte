<script lang="ts">
  import PanelShell from "./PanelShell.svelte";
  import TextThumb from "../thumbs/TextThumb.svelte";
  import { project } from "$lib/project.svelte";
  import { TITLE_PRESETS } from "$lib/text/title-presets";

  let hovered = $state<string | null>(null);

  function add(presetId: string) {
    const preset = TITLE_PRESETS.find((p) => p.id === presetId);
    const clip = project.addText();
    if (preset) project.updateText(clip.id, preset.data);
  }
</script>

<PanelShell title="Texto" hint="Clic para añadirlo en el playhead · pasa el ratón para ver la animación">
  <div class="grid grid-cols-2 gap-2">
    {#each TITLE_PRESETS as p (p.id)}
      <button
        class="item"
        onmouseenter={() => (hovered = p.id)}
        onmouseleave={() => (hovered = null)}
        onclick={() => add(p.id)}
        title={p.name}
      >
        <TextThumb data={p.data} label={p.name} playing={hovered === p.id} />
        <span class="label">{p.name}</span>
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
  .item:hover {
    border-color: var(--muted);
  }
  .label {
    overflow: hidden;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
