<script lang="ts">
  import { FolderOpen, Image as ImageIcon, Layers, Music, Plus, Trash2 } from "@lucide/svelte";
  import { openMenu } from "$lib/context-menu.svelte";
  import PanelShell from "./PanelShell.svelte";
  import { project } from "$lib/project.svelte";
  import { formatDuration } from "$lib/format";
  import { startDrag } from "$lib/drag";
  import type { MediaInfo } from "$lib/tauri/media";
  import { filmstrips, frameStyle, FOTOGRAMAS } from "$lib/filmstrips.svelte";
  import { proxies } from "$lib/proxies.svelte";

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

  /**
   * Varios archivos marcados a la vez: con Shift/⌘ al hacer clic, o
   * arrastrando un cuadro por el hueco entre miniaturas. `selected` sigue
   * siendo el principal (el que enseña el inspector).
   */
  let marcados = $state<string[]>([]);
  let marco = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let rejilla = $state<HTMLElement | null>(null);
  let esta = (item: MediaInfo) => marcados.includes(item.path) || selected?.path === item.path;

  function elegir(e: MouseEvent, item: MediaInfo) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      marcados = marcados.includes(item.path) ? marcados.filter((p) => p !== item.path) : [...marcados, item.path];
      selected = marcados.length ? (project.media.find((m) => m.path === marcados[marcados.length - 1]) ?? null) : null;
    } else {
      marcados = [item.path];
      selected = item;
    }
  }

  function onRejillaDown(e: PointerEvent) {
    // Solo desde el hueco: sobre una miniatura el arrastre es para llevarla al timeline.
    if (e.button !== 0 || (e.target as HTMLElement).closest("li") || !rejilla) return;
    const sumar = e.shiftKey || e.metaKey || e.ctrlKey;
    const previos = sumar ? [...marcados] : [];
    if (!sumar) {
      marcados = [];
      selected = null;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    const caja = rejilla;
    startDrag(e, {
      onMove(_dx, _dy, ev) {
        const rect = caja.getBoundingClientRect();
        const izq = Math.min(x0, ev.clientX);
        const der = Math.max(x0, ev.clientX);
        const arriba = Math.min(y0, ev.clientY);
        const abajo = Math.max(y0, ev.clientY);
        marco = { x: izq - rect.left, y: arriba - rect.top, w: der - izq, h: abajo - arriba };
        const dentro: string[] = [];
        for (const li of caja.querySelectorAll<HTMLElement>("li[data-path]")) {
          const r = li.getBoundingClientRect();
          if (r.left < der && r.right > izq && r.top < abajo && r.bottom > arriba) dentro.push(li.dataset.path!);
        }
        marcados = [...new Set([...previos, ...dentro])];
        selected = project.media.find((m) => m.path === marcados[marcados.length - 1]) ?? null;
      },
      onEnd() {
        marco = null;
      },
    });
  }

  /** Quita el archivo de la lista y sus clips del timeline. */
  function quitar(item: MediaInfo) {
    const clips = project.removeMedia(item.path);
    if (selected?.path === item.path) selected = null;
    marcados = marcados.filter((p) => p !== item.path);
    aviso = clips
      ? `«${item.fileName}» quitado, con ${clips} ${clips === 1 ? "clip" : "clips"} del timeline. ⌘Z lo devuelve.`
      : null;
  }

  /** Quita de golpe todos los marcados (⌫ o el menú). */
  function quitarMarcados() {
    const lista = project.media.filter((m) => marcados.includes(m.path));
    if (!lista.length) return;
    let clips = 0;
    for (const m of lista) clips += project.removeMedia(m.path);
    marcados = [];
    selected = null;
    aviso = `${lista.length} archivos quitados${clips ? `, con ${clips} clips del timeline` : ""}. ⌘Z lo devuelve.`;
  }

  function onTecla(e: KeyboardEvent) {
    if ((e.key === "Backspace" || e.key === "Delete") && marcados.length) {
      e.preventDefault();
      // Que no borre además los clips marcados en el timeline.
      e.stopPropagation();
      quitarMarcados();
    }
  }
  let aviso = $state<string | null>(null);

  function menuMedio(e: MouseEvent, item: MediaInfo) {
    if (!marcados.includes(item.path)) marcados = [item.path];
    selected = item;
    const varios = marcados.length > 1;
    openMenu(e, [
      { label: "Añadir al timeline", icon: Plus, run: () => project.addClip(item) },
      ...(item.video
        ? [
            { label: "Poner de fondo (F1)", icon: ImageIcon, run: () => project.addBackground(item) },
            { label: "Poner como capa (O1/O2)", icon: Layers, run: () => project.addOverlay(item) },
          ]
        : []),
      varios
        ? { label: `Quitar ${marcados.length} de Medios`, icon: Trash2, danger: true, run: quitarMarcados }
        : { label: "Quitar de Medios", icon: Trash2, danger: true, run: () => quitar(item) },
    ]);
  }

  /** Fotograma que se enseña de cada vídeo; cambia al pasar el ratón. */
  let hover = $state<Record<string, number>>({});
  /**
   * Al pasar el ratón el archivo se oye (y se ve moverse) desde donde está el
   * cursor, como en iMovie. Es un solo reproductor: el del medio bajo el ratón.
   */
  let escuchando = $state<{ path: string; desde: number } | null>(null);
  let reproductor = $state<HTMLVideoElement | null>(null);
  function posicion(e: PointerEvent): number {
    const caja = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - caja.left) / caja.width));
  }
  function barrer(e: PointerEvent, item: MediaInfo) {
    const p = posicion(e);
    hover[item.path] = Math.round(p * (FOTOGRAMAS - 1));
    const t = p * item.durationSec;
    if (escuchando?.path !== item.path) {
      escuchando = { path: item.path, desde: t };
    } else if (reproductor && Math.abs(reproductor.currentTime - t) > 0.75) {
      // Con el ratón quieto sigue sonando; al moverlo salta a donde apunta.
      reproductor.currentTime = t;
    }
  }
  function dejarDeEscuchar(path: string) {
    delete hover[path];
    if (escuchando?.path === path) escuchando = null;
  }
  function arrancar(e: Event) {
    const v = e.currentTarget as HTMLVideoElement;
    v.volume = 0.7;
    if (escuchando) v.currentTime = escuchando.desde;
    // Si el sistema bloquea el sonido sin un clic previo, se queda en silencio.
    v.play().catch(() => {});
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
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul
    bind:this={rejilla}
    class="relative flex min-h-full flex-wrap content-start gap-2 pb-6"
    onpointerdown={onRejillaDown}
    onkeydown={onTecla}
    role="listbox"
    aria-multiselectable="true"
  >
    {#if marco}
      <div class="marco" style="left:{marco.x}px; top:{marco.y}px; width:{marco.w}px; height:{marco.h}px"></div>
    {/if}
    {#each project.media as item (item.path)}
      {@const tira = filmstrips.src(item.path)}
      {@const prop = aspectoDe(item)}
      <li
        class="group relative"
        data-path={item.path}
        style="width:{Math.round(thumb * prop)}px"
        oncontextmenu={(e) => menuMedio(e, item)}
        role="option"
        aria-selected={esta(item)}
      >
        <button
          class="media-item !p-1"
          class:active={esta(item)}
          onclick={(e) => elegir(e, item)}
          ondblclick={() => project.addClip(item)}
          onpointerdown={(e) => onDragToTimeline(e, item)}
          onpointerleave={() => dejarDeEscuchar(item.path)}
          title="Pasa el ratón para ver y oír el archivo · doble clic o arrastrar para añadirlo"
        >
          {#if item.video && !item.isImage}
            <div
              class="tira relative w-full shrink-0 overflow-hidden rounded"
              style="height:{thumb}px; {tira ? frameStyle(tira, hover[item.path] ?? 0) : ''}"
              onpointermove={(e) => barrer(e, item)}
              role="presentation"
            >
              {#if !tira}
                <span class="flex h-full items-center justify-center text-center text-[9px] leading-tight text-muted">
                  preparando<br />vista previa…
                </span>
              {/if}
              {#if escuchando?.path === item.path}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  bind:this={reproductor}
                  class="absolute inset-0 h-full w-full object-cover"
                  src={proxies.src(item.path)}
                  playsinline
                  onloadedmetadata={arrancar}
                ></video>
              {/if}
            </div>
          {:else}
            <div
              class="relative flex w-full items-center justify-center rounded bg-panel-2"
              style="height:{thumb}px"
              onpointermove={(e) => item.audio && barrer(e, item)}
              role="presentation"
            >
              <Music size={Math.min(28, thumb / 2)} class="text-muted" />
              {#if escuchando?.path === item.path}
                <!-- Solo se oye: el archivo no tiene imagen. -->
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  bind:this={reproductor}
                  class="pointer-events-none absolute h-px w-px opacity-0"
                  src={proxies.src(item.path)}
                  onloadedmetadata={arrancar}
                ></video>
                <span class="absolute right-1 bottom-1 text-[9px] text-accent">▶ sonando</span>
              {/if}
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
  {#if marcados.length > 1}
    <div class="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-panel px-1 py-1 text-[11px]">
      <span class="text-muted">{marcados.length} marcados</span>
      <button class="btn-danger-ghost" onclick={quitarMarcados} title="Quitar los marcados de Medios (⌫)">
        <Trash2 size={12} /> Quitar {marcados.length}
      </button>
    </div>
  {/if}
</PanelShell>

<style>
  .marco {
    position: absolute;
    z-index: 20;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    pointer-events: none;
  }
</style>
