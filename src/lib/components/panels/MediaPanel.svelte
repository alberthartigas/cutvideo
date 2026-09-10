<script lang="ts">
  import { FolderOpen, Image as ImageIcon, Layers, Music, Plus, Trash2 } from "@lucide/svelte";
  import { openMenu } from "$lib/context-menu.svelte";
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

  /**
   * Ancho respecto al alto del vídeo, ya contando la rotación: un móvil graba
   * en apaisado y marca "girar 90", así que sin esto los verticales saldrían
   * tumbados. Sin vídeo se usa un cuadrado.
   */
  function aspectoDe(item: MediaInfo): number {
    const v = item.video;
    if (!v || !v.width || !v.height) return 1;
    const girado = v.rotation === 90 || v.rotation === 270;
    const [w, h] = girado ? [v.height, v.width] : [v.width, v.height];
    // Se acota para que un vídeo panorámico no ocupe él solo toda la fila.
    return Math.min(2.2, Math.max(0.4, w / h));
  }

  /** Quita el archivo de la lista y sus clips del timeline. */
  function quitar(item: MediaInfo) {
    const clips = project.removeMedia(item.path);
    if (selected?.path === item.path) selected = null;
    aviso = clips
      ? `«${item.fileName}» quitado, con ${clips} ${clips === 1 ? "clip" : "clips"} del timeline. ⌘Z lo devuelve.`
      : null;
  }
  let aviso = $state<string | null>(null);

  function menuMedio(e: MouseEvent, item: MediaInfo) {
    selected = item;
    openMenu(e, [
      { label: "Añadir al timeline", icon: Plus, run: () => project.addClip(item) },
      ...(item.video
        ? [
            { label: "Poner de fondo (F1)", icon: ImageIcon, run: () => project.addBackground(item) },
            { label: "Poner como capa (O1/O2)", icon: Layers, run: () => project.addOverlay(item) },
          ]
        : []),
      { label: "Quitar de Medios", icon: Trash2, danger: true, run: () => quitar(item) },
    ]);
  }

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
  {#if aviso}
    <p class="mb-2 rounded-md bg-panel-2 px-2 py-1.5 text-[11px] text-muted">{aviso}</p>
  {/if}

  {#if project.media.length > 1}
    <label class="mb-2 flex items-center gap-2 px-1 text-[11px] text-muted">
      <ImageIcon size={11} />
      <input class="min-w-0 flex-1 accent-accent" type="range" min="56" max="220" step="4" bind:value={thumb} />
      <ImageIcon size={15} />
    </label>
  {/if}

  <!-- En rejilla y cada uno con su proporción: todos comparten altura, así que
       los verticales salen estrechos y los apaisados anchos, uno al lado de
       otro, y ninguno se deforma. -->
  <ul class="flex flex-wrap gap-2">
    {#each project.media as item (item.path)}
      {@const tira = filmstrips.src(item.path)}
      {@const prop = aspectoDe(item)}
      <li class="group relative" style="width:{Math.round(thumb * prop)}px" oncontextmenu={(e) => menuMedio(e, item)}>
        <button
          class="media-item !p-1"
          class:active={selected?.path === item.path}
          onclick={() => (selected = item)}
          ondblclick={() => project.addClip(item)}
          onpointerdown={(e) => onDragToTimeline(e, item)}
          onpointerleave={() => delete hover[item.path]}
          title="Pasa el ratón para ver el vídeo · doble clic o arrastrar para añadirlo"
        >
          {#if item.video && !item.isImage}
            <div
              class="tira w-full shrink-0 rounded"
              style="height:{thumb}px; {tira ? frameStyle(tira, hover[item.path] ?? 0) : ''}"
              onpointermove={(e) => tira && barrer(e, item.path)}
              role="presentation"
            >
              {#if !tira}
                <span class="flex h-full items-center justify-center text-center text-[9px] leading-tight text-muted">
                  preparando<br />vista previa…
                </span>
              {/if}
            </div>
          {:else}
            <div class="flex w-full items-center justify-center rounded bg-panel-2" style="height:{thumb}px">
              <Music size={Math.min(28, thumb / 2)} class="text-muted" />
            </div>
          {/if}
          <span class="mt-1 w-full truncate text-[11px]" title={item.fileName}>{item.fileName}</span>
          <span class="w-full truncate text-[10px] text-muted">
            {formatDuration(item.durationSec)}
            {#if item.video}· {item.video.width}×{item.video.height}{/if}
          </span>
        </button>
        <!-- Los botones tapan la miniatura, así que solo salen al pasar por encima. -->
        <div
          class="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        >
          {#if item.video}
            <button
              class="tool h-6 w-6 justify-center bg-panel/90 px-0"
              title="Poner de fondo (pista F1, por detrás de la pantalla verde)"
              onclick={() => project.addBackground(item)}
            >
              <ImageIcon size={12} />
            </button>
            <button
              class="tool h-6 w-6 justify-center bg-panel/90 px-0"
              title="Poner encima como capa (O1/O2): imagen en imagen o recorte"
              onclick={() => project.addOverlay(item)}
            >
              <Layers size={12} />
            </button>
          {/if}
          <button
            class="tool h-6 w-6 justify-center bg-panel/90 px-0"
            title="Añadir al timeline"
            onclick={() => project.addClip(item)}
          >
            <Plus size={13} />
          </button>
          <button
            class="tool h-6 w-6 justify-center bg-panel/90 px-0 text-red-500"
            title="Quitar de Medios (y sus clips del timeline)"
            onclick={() => quitar(item)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </li>
    {:else}
      <li class="px-3 py-8 text-center text-xs text-muted">Arrastra vídeos aquí o pulsa Importar</li>
    {/each}
  </ul>
</PanelShell>
