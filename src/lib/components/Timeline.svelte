<script lang="ts">
  import { tick } from "svelte";
  import {
    Captions,
    Film,
    Image,
    Layers,
    Maximize2,
    Music,
    Redo2,
    Scissors,
    Sticker,
    Trash2,
    Type,
    Undo2,
    Unlink,
    ZoomIn,
    ZoomOut,
  } from "@lucide/svelte";
  import { project, ZOOM_MAX, ZOOM_MIN, type Clip, type TrackKind } from "$lib/project.svelte";
  import { startDrag } from "$lib/drag";
  import { drop } from "$lib/media-drop.svelte";
  import { isOverlayTrack } from "$lib/layers";

  /**
   * Las capas superpuestas solo se enseñan si tienen algo, más una vacía por
   * encima de la última usada para poder soltar ahí. Tres filas vacías
   * comiéndose el timeline eran demasiado.
   */
  let visibles = $derived.by(() => {
    const abajoArriba = [...project.overlayTracks].reverse();
    const usadas = new Set(abajoArriba.filter((t) => t.clips.length > 0).map((t) => t.id));
    const ultimaUsada = abajoArriba.map((t) => t.id).reduce((m, id, i) => (usadas.has(id) ? i : m), -1);
    const libre = abajoArriba.find((t, i) => i > ultimaUsada && !t.clips.length)?.id;
    return project.tracks.filter((t) => !isOverlayTrack(t.id) || usadas.has(t.id) || t.id === libre);
  });
  import { ui } from "$lib/ui.svelte";
  import TimelineClip from "./TimelineClip.svelte";

  const RULER_H = 24;
  const TRACK_H: Record<TrackKind, number> = { text: 36, image: 40, video: 56, audio: 40 };
  const trackIcons = { text: Type, image: Sticker, video: Film, audio: Music } as const;
  /** Iconos propios de las pistas que no se distinguen por su tipo. */
  const specialIcons: Record<string, typeof Film> = { s1: Captions, f1: Image, o1: Layers, o2: Layers };

  /**
   * Los clips se pintan en orden estable (por id), no por posición: si el DOM se
   * reordenara mientras se arrastra uno, el navegador soltaría la captura del puntero.
   */
  const stable = (clips: Clip[]) => [...clips].sort((a, b) => (a.id < b.id ? -1 : 1));

  let scroller = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let viewWidth = $state(0);
  let scrollLeft = $state(0);

  let contentWidth = $derived(Math.max(viewWidth, (project.duration + 1) * project.zoom + 240));
  let playheadX = $derived(project.playhead * project.zoom);

  // ---- Regla: marcas mayores cada ≥80 px, con subdivisiones ----
  const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  let marks = $derived.by(() => {
    const zoom = project.zoom;
    const major = STEPS.find((s) => s * zoom >= 80) ?? STEPS[STEPS.length - 1];
    const divs = major * zoom >= 160 ? 5 : 2;
    const minor = major / divs;
    const decimals = major >= 1 ? 0 : Number.isInteger(major * 10) ? 1 : 2;
    const t0 = scrollLeft / zoom;
    const t1 = (scrollLeft + viewWidth) / zoom;
    const out: { t: number; x: number; label: string | null }[] = [];
    for (let i = Math.floor(t0 / minor); i * minor <= t1; i++) {
      const t = i * minor;
      out.push({ t, x: t * zoom, label: i % divs === 0 ? formatTick(t, decimals) : null });
    }
    return out;
  });

  function formatTick(t: number, decimals: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0")}`;
  }

  // ---- Playhead / scrub ----
  function timeAt(clientX: number): number {
    const rect = content!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / project.zoom);
  }

  /** Cuadro de selección que se dibuja al arrastrar por una zona vacía de las pistas. */
  let marco = $state<{ x: number; y: number; w: number; h: number } | null>(null);

  function onContentPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    project.playing = false;
    // En la regla se arrastra el playhead; en las pistas, un clic vacío también
    // lo mueve, pero arrastrar dibuja un cuadro y marca todo lo que abarca.
    const enRegla = !!(e.target as HTMLElement).closest(".ruler");
    const sumar = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!sumar) project.selectedId = null;
    if (enRegla || !content) {
      project.setPlayhead(timeAt(e.clientX));
      startDrag(e, { onMove: (_dx, _dy, ev) => project.setPlayhead(timeAt(ev.clientX)) });
      return;
    }
    const previos = sumar ? [...project.selectedIds] : [];
    const x0 = e.clientX;
    const y0 = e.clientY;
    const caja = content;
    startDrag(e, {
      onMove(_dx, _dy, ev) {
        const rect = caja.getBoundingClientRect();
        const izq = Math.min(x0, ev.clientX);
        const der = Math.max(x0, ev.clientX);
        const arriba = Math.min(y0, ev.clientY);
        const abajo = Math.max(y0, ev.clientY);
        marco = { x: izq - rect.left, y: arriba - rect.top, w: der - izq, h: abajo - arriba };
        const dentro: string[] = [];
        for (const el of caja.querySelectorAll<HTMLElement>("[data-clip]")) {
          const r = el.getBoundingClientRect();
          if (r.left < der && r.right > izq && r.top < abajo && r.bottom > arriba) dentro.push(el.dataset.clip!);
        }
        project.setSelection([...previos, ...dentro]);
      },
      onEnd(ev, moved) {
        marco = null;
        if (!moved) project.setPlayhead(timeAt(ev.clientX));
      },
    });
  }

  // Mantiene el playhead a la vista: en reproducción salta de página; si no, el mínimo scroll.
  $effect(() => {
    const x = project.playhead * project.zoom;
    const playing = project.playing;
    const el = scroller;
    if (!el) return;
    const left = el.scrollLeft;
    const right = left + viewWidth;
    if (x < left || x > right - 8) {
      el.scrollLeft = playing || x < left ? x - 48 : x - viewWidth + 48;
    }
  });

  // ---- Zoom ----
  let zoomSlider = $derived(Math.log(project.zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN));

  /** Cambia el zoom manteniendo fijo el instante que hay en `anchorX` (px dentro de la vista). */
  async function zoomTo(zoom: number, anchorX: number) {
    if (!scroller) return;
    const anchorT = (scroller.scrollLeft + anchorX) / project.zoom;
    project.setZoom(zoom);
    await tick();
    scroller.scrollLeft = anchorT * project.zoom - anchorX;
  }

  function zoomBy(factor: number) {
    if (!scroller) return;
    const playheadInView = project.playhead * project.zoom - scroller.scrollLeft;
    const anchor = playheadInView >= 0 && playheadInView <= viewWidth ? playheadInView : viewWidth / 2;
    zoomTo(project.zoom * factor, anchor);
  }

  function zoomToFit() {
    project.setZoom((viewWidth - 48) / Math.max(project.duration, 1));
    if (scroller) scroller.scrollLeft = 0;
  }

  function onSlider(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    zoomBy((ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v)) / project.zoom);
  }

  function onWheel(e: WheelEvent) {
    if (!scroller) return;
    if (e.ctrlKey || e.metaKey) {
      // Pellizco del trackpad (llega como wheel+ctrl) o ⌘+rueda: zoom alrededor del cursor.
      e.preventDefault();
      const mouseX = e.clientX - scroller.getBoundingClientRect().left;
      zoomTo(project.zoom * Math.exp(-e.deltaY * 0.005), mouseX);
    } else if (e.deltaX === 0 && e.deltaY !== 0) {
      // Rueda vertical del ratón: desplaza en horizontal (el timeline no tiene scroll vertical).
      e.preventDefault();
      scroller.scrollLeft += e.deltaY;
    }
  }

  // wheel debe registrarse como no pasivo para poder cancelar el zoom del WebView.
  $effect(() => {
    const el = scroller;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  /** Pista e instante bajo un punto de pantalla (para soltar archivos de la biblioteca). */
  export function locate(clientX: number, clientY: number): { trackId: string; time: number } | null {
    if (!scroller || !content) return null;
    const r = scroller.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    for (const row of content.querySelectorAll<HTMLElement>("[data-track]")) {
      const rr = row.getBoundingClientRect();
      if (clientY >= rr.top && clientY <= rr.bottom) {
        return { trackId: row.dataset.track!, time: timeAt(clientX) };
      }
    }
    return null;
  }
</script>

<section class="panel h-full">
  <div class="panel-header">
    <div class="flex items-center gap-1">
      <span class="mr-2">Timeline</span>
      <button class="tool" title="Deshacer (⌘Z)" disabled={!project.canUndo} onclick={() => project.undo()}>
        <Undo2 size={14} />
      </button>
      <button class="tool" title="Rehacer (⇧⌘Z)" disabled={!project.canRedo} onclick={() => project.redo()}>
        <Redo2 size={14} />
      </button>
      <span class="mx-1 h-4 w-px bg-border"></span>
      <button class="tool" title="Cortar en el playhead (S)" disabled={project.clipCount === 0} onclick={() => project.splitAtPlayhead()}>
        <Scissors size={14} />
        <span>Cortar</span>
      </button>
      <button class="tool" title="Eliminar clip (⌫)" disabled={!project.selected} onclick={() => project.deleteSelected()}>
        <Trash2 size={14} />
        <span>Eliminar</span>
      </button>
      <span class="mx-1 h-4 w-px bg-border"></span>
      <button class="tool" title="Añadir texto en el playhead (T)" onclick={() => project.addText()}>
        <Type size={14} />
        <span>Texto</span>
      </button>
      <button class="tool" title="Subtítulos automáticos" disabled={project.videoTrack.clips.length === 0} onclick={() => (ui.subtitlesOpen = true)}>
        <Captions size={14} />
        <span>Subtítulos</span>
      </button>
    </div>
    <div class="flex items-center gap-1">
      <button class="tool" title="Alejar" onclick={() => zoomBy(1 / 1.5)}><ZoomOut size={14} /></button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.001"
        value={zoomSlider}
        oninput={onSlider}
        class="w-24 accent-accent"
        aria-label="Zoom"
      />
      <button class="tool" title="Acercar" onclick={() => zoomBy(1.5)}><ZoomIn size={14} /></button>
      <button class="tool" title="Ajustar a la ventana" onclick={zoomToFit}><Maximize2 size={14} /></button>
    </div>
  </div>

  <div class="grid min-h-0 flex-1 grid-cols-[36px_44px_1fr] overflow-y-auto">
    <!-- Herramientas básicas, a mano para quien corrige la autoedición. -->
    <div class="rail sticky top-0 flex flex-col items-center gap-1 self-start border-r border-border bg-panel-2 py-1.5">
      <button class="tool h-7 w-7 justify-center px-0" title="Cortar en el playhead (S)" disabled={project.clipCount === 0} onclick={() => project.splitAtPlayhead()}>
        <Scissors size={14} />
      </button>
      <button class="tool h-7 w-7 justify-center px-0" title="Eliminar clip (⌫)" disabled={!project.selected} onclick={() => project.deleteSelected()}>
        <Trash2 size={14} />
      </button>
      <button
        class="tool h-7 w-7 justify-center px-0"
        title="Quitar transición del clip seleccionado"
        disabled={!project.selected?.clip.transition}
        onclick={() => project.selected && project.setTransition(project.selected.clip.id, null)}
      >
        <Unlink size={14} />
      </button>
      <div class="my-0.5 h-px w-5 bg-border"></div>
      <button class="tool h-7 w-7 justify-center px-0" title="Deshacer (⌘Z)" disabled={!project.canUndo} onclick={() => project.undo()}>
        <Undo2 size={14} />
      </button>
      <button class="tool h-7 w-7 justify-center px-0" title="Rehacer (⇧⌘Z)" disabled={!project.canRedo} onclick={() => project.redo()}>
        <Redo2 size={14} />
      </button>
    </div>
    <!-- Cabeceras de pista (fuera del scroll horizontal, pero suben y bajan con él) -->
    <div class="border-r border-border bg-panel-2">
      <div class="sticky top-0 z-10 border-b border-border bg-panel-2" style="height:{RULER_H}px"></div>
      {#each visibles as track (track.id)}
        {@const Icon = specialIcons[track.id] ?? trackIcons[track.kind]}
        <div
          class="flex flex-col items-center justify-center gap-0.5 border-b border-border text-[10px] font-semibold text-muted"
          style="height:{TRACK_H[track.kind]}px"
        >
          <Icon size={12} />
          <span>{track.name}</span>
        </div>
      {/each}
    </div>

    <div
      bind:this={scroller}
      bind:clientWidth={viewWidth}
      onscroll={(e) => (scrollLeft = e.currentTarget.scrollLeft)}
      class="relative overflow-x-auto overflow-y-hidden"
    >
      <div
        bind:this={content}
        onpointerdown={onContentPointerDown}
        class="relative"
        style="width:{contentWidth}px"
        role="presentation"
      >
        <div class="ruler sticky top-0 z-10" style="height:{RULER_H}px">
          {#each marks as mark (mark.t)}
            <div class="mark" class:major={mark.label !== null} style="left:{mark.x}px">
              {#if mark.label !== null}<span>{mark.label}</span>{/if}
            </div>
          {/each}
        </div>

        {#if marco}
          <div class="marco" style="left:{marco.x}px; top:{marco.y}px; width:{marco.w}px; height:{marco.h}px"></div>
        {/if}
        {#each visibles as track (track.id)}
          <div
            data-track={track.id}
            class="track"
            class:destino={drop.target?.trackId === track.id}
            style="height:{TRACK_H[track.kind]}px"
            role="listbox"
            tabindex="-1"
            aria-label={track.name}
          >
            {#if drop.target?.trackId === track.id}
              <div class="guia" style="left:{drop.target.time * project.zoom}px"></div>
            {/if}
            {#each stable(track.clips) as clip (clip.id)}
              <TimelineClip {clip} {track} />
            {/each}
            {#if track.magnetic && track.clips.length === 0}
              <p class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">
                Arrastra un archivo de la biblioteca aquí, o haz doble clic sobre él
              </p>
            {/if}
          </div>
        {/each}

        <div class="playhead" style="left:{playheadX}px"></div>
      </div>
    </div>
  </div>
</section>

<style>
  /* Pista sobre la que se va a soltar, y línea de dónde caerá exactamente. */
  .track.destino {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .guia {
    position: absolute;
    top: 2px;
    bottom: 2px;
    z-index: 5;
    width: 2px;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    pointer-events: none;
  }
  .ruler {
    position: relative;
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
    cursor: ew-resize;
  }
  .mark {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: 5px;
    background: var(--muted);
    opacity: 0.5;
  }
  .mark.major {
    height: 100%;
    opacity: 0.3;
  }
  .mark.major span {
    position: absolute;
    top: 3px;
    left: 4px;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    opacity: 1;
  }
  .track {
    position: relative;
    border-bottom: 1px solid var(--border);
    background: var(--track);
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 20;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .playhead::before {
    content: "";
    position: absolute;
    top: 0;
    left: -5px;
    border-top: 8px solid var(--accent);
    border-right: 5.5px solid transparent;
    border-left: 5.5px solid transparent;
  }
  .marco {
    position: absolute;
    z-index: 20;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    pointer-events: none;
  }
</style>
