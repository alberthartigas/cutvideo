<script lang="ts">
  import { FolderOpen, Image as ImageIcon, Layers, Plus } from "@lucide/svelte";
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
          class="media-item pr-24"
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
        <div class="absolute top-1/2 right-1.5 flex -translate-y-1/2 gap-0.5">
          {#if item.video}
            <button
              class="tool h-6 w-6 justify-center px-0"
              title="Poner de fondo (pista F1, por detrás de la pantalla verde)"
              onclick={() => project.addBackground(item)}
            >
              <ImageIcon size={13} />
            </button>
            <button
              class="tool h-6 w-6 justify-center px-0"
              title="Poner encima como capa (O1/O2): imagen en imagen o recorte"
              onclick={() => project.addOverlay(item)}
            >
              <Layers size={13} />
            </button>
          {/if}
          <button
            class="tool h-6 w-6 justify-center px-0"
            title="Añadir al timeline"
            onclick={() => project.addClip(item)}
          >
            <Plus size={14} />
          </button>
        </div>
      </li>
    {:else}
      <li class="px-3 py-8 text-center text-xs text-muted">Arrastra vídeos aquí o pulsa Importar</li>
    {/each}
  </ul>
</PanelShell>
