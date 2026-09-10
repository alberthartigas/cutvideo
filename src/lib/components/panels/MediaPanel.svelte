<script lang="ts">
  import { FolderOpen, Image as ImageIcon, Layers, Plus } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import { project } from "$lib/project.svelte";
  import { formatDuration } from "$lib/format";
  import { startDrag } from "$lib/drag";
  import type { MediaInfo } from "$lib/tauri/media";
  import { filmstrips, frameStyle, FOTOGRAMAS } from "$lib/filmstrips.svelte";

  /** Tamaño de las miniaturas, como en iMovie. Se recuerda entre sesiones. */
  const CLAVE_TAMANO = "cutvideo.media-thumb";
  let thumb = $state(leerTamano());
  function leerTamano(): number {
    try {
      return Number(localStorage.getItem(CLAVE_TAMANO)) || 96;
    } catch {
      return 96;
    }
  }
  $effect(() => {
    try {
      localStorage.setItem(CLAVE_TAMANO, String(thumb));
    } catch {
      /* sin localStorage el tamaño dura solo esta sesión */
    }
  });

  // Las tiras se preparan cuando cambia la lista de medios.
  $effect(() => void filmstrips.prepare(project.media));

  /** Fotograma que se enseña de cada vídeo; cambia al pasar el ratón. */
  let hover = $state<Record<string, number>>({});
  function barrer(e: PointerEvent, path: string) {
    const caja = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p = (e.clientX - caja.left) / caja.width;
    hover[path] = Math.round(p * (FOTOGRAMAS - 1));
  }

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

  {#if project.media.length > 1}
    <label class="mb-2 flex items-center gap-2 px-1 text-[11px] text-muted">
      <ImageIcon size={11} />
      <input class="min-w-0 flex-1 accent-accent" type="range" min="56" max="220" step="4" bind:value={thumb} />
      <ImageIcon size={15} />
    </label>
  {/if}

  <ul class="space-y-1">
    {#each project.media as item (item.path)}
      {@const tira = filmstrips.src(item.path)}
      <li class="relative">
        <button
          class="media-item pr-24"
          class:active={selected?.path === item.path}
          onclick={() => (selected = item)}
          ondblclick={() => project.addClip(item)}
          onpointerdown={(e) => onDragToTimeline(e, item)}
          onpointerleave={() => delete hover[item.path]}
          title="Pasa el ratón para ver el vídeo · doble clic o arrastrar para añadirlo"
        >
          {#if item.video && !item.isImage}
            <div
              class="tira mb-1.5 w-full shrink-0 rounded-md"
              style="height:{thumb}px; {tira ? frameStyle(tira, hover[item.path] ?? 0) : ''}"
              onpointermove={(e) => tira && barrer(e, item.path)}
              role="presentation"
            >
              {#if !tira}
                <span class="flex h-full items-center justify-center text-[10px] text-muted">
                  preparando vista previa…
                </span>
              {/if}
            </div>
          {/if}
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
