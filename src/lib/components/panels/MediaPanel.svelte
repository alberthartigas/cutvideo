<script lang="ts">
  import { FolderOpen, Plus } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import { project } from "$lib/project.svelte";
  import { formatDuration } from "$lib/format";
  import { startDrag } from "$lib/drag";
  import type { MediaInfo } from "$lib/tauri/media";

  let {
    importing,
    error,
    onImport,
    onDragToTimeline,
    selected = $bindable(),
  }: {
    importing: boolean;
    error: string | null;
    onImport: () => void;
    onDragToTimeline: (e: PointerEvent, item: MediaInfo) => void;
    selected: MediaInfo | null;
  } = $props();
</script>

<PanelShell title="Medios">
  {#snippet action()}
    <button class="btn-accent" onclick={onImport} disabled={importing}>
      <FolderOpen size={13} />
      {importing ? "Importando…" : "Importar"}
    </button>
  {/snippet}

  {#if error}
    <p class="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{error}</p>
  {/if}

  <ul class="space-y-1">
    {#each project.media as item (item.path)}
      <li class="relative">
        <button
          class="media-item pr-9"
          class:active={selected?.path === item.path}
          onclick={() => (selected = item)}
          ondblclick={() => project.addClip(item)}
          onpointerdown={(e) => onDragToTimeline(e, item)}
          title="Doble clic o arrastrar al timeline para añadirlo"
        >
          <span class="truncate text-sm">{item.fileName}</span>
          <span class="text-[11px] text-muted">
            {formatDuration(item.durationSec)}
            · {item.video ? `${item.video.width}×${item.video.height}` : "solo audio"}
          </span>
        </button>
        <button
          class="tool absolute top-1/2 right-1.5 h-6 w-6 -translate-y-1/2 justify-center px-0"
          title="Añadir al final del timeline"
          onclick={() => project.addClip(item)}
        >
          <Plus size={14} />
        </button>
      </li>
    {:else}
      <li class="px-3 py-8 text-center text-xs text-muted">Arrastra vídeos aquí o pulsa Importar</li>
    {/each}
  </ul>
</PanelShell>
