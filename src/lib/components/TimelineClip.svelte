<script lang="ts">
  import { clipDuration, effectiveTransition, nearestSnap, project, type Clip, type Track, MIN_CLIP, clipEnd } from "$lib/project.svelte";
  import { startDrag } from "$lib/drag";
  import { openMenu } from "$lib/context-menu.svelte";
  import { drop } from "$lib/media-drop.svelte";
  import { AudioLines, Link2, Scissors, Trash2, Unlink } from "@lucide/svelte";
  import ClipArt from "./ClipArt.svelte";

  /** Acciones básicas sobre este clip, para quien corrige a mano la autoedición. */
  function menuClip(e: MouseEvent) {
    // Si el clip ya está en una selección múltiple, se conserva: "Eliminar"
    // borra todos los marcados.
    if (!project.isSelected(clip.id)) project.selectedId = clip.id;
    const varios = project.selectedIds.length > 1;
    const t = project.playhead;
    const dentro = t > clip.start + MIN_CLIP && t < clipEnd(clip) - MIN_CLIP;
    const audioSeparado = clip.kind === "video" && (clip.muted === true || project.hasDetachedAudio(clip.id));
    const puedeSeparar = clip.kind === "video" && !clip.muted && !!project.mediaOf(clip)?.audio;
    const esAudioSeparado = clip.kind === "audio" && !!clip.detachedFrom;
    openMenu(e, [
      {
        label: "Cortar aquí",
        icon: Scissors,
        shortcut: "S",
        disabled: !dentro,
        run: () => {
          project.selectedId = clip.id;
          project.splitAtPlayhead();
        },
      },
      ...(clip.transition
        ? [{ label: "Quitar transición", icon: Unlink, run: () => project.setTransition(clip.id, null) }]
        : []),
      ...(puedeSeparar
        ? [{ label: "Separar audio a A1", icon: AudioLines, run: () => project.detachAudio(clip.id) }]
        : []),
      ...(audioSeparado || esAudioSeparado
        ? [{ label: "Volver a unir audio y vídeo", icon: Link2, run: () => project.reattachAudio(clip.id) }]
        : []),
      {
        label: varios ? `Eliminar ${project.selectedIds.length} clips` : "Eliminar",
        icon: Trash2,
        shortcut: "⌫",
        danger: true,
        run: () => (varios ? project.deleteSelected() : project.deleteClip(clip.id)),
      },
    ]);
  }
  import { formatDuration } from "$lib/format";

  let { clip, track }: { clip: Clip; track: Track } = $props();

  const SNAP_PX = 8;

  let selected = $derived(project.isSelected(clip.id));
  let hasNext = $derived(track.magnetic && track.clips.indexOf(clip) < track.clips.length - 1);
  let transitionWidth = $derived.by(() => {
    const next = project.nextClip(clip);
    return next ? effectiveTransition(clip, next) * project.zoom : 0;
  });
  let left = $derived(clip.start * project.zoom);
  let width = $derived(Math.max(2, clipDuration(clip) * project.zoom));
  /** Desplazamiento visual (px) mientras se reordena en una pista magnética. */
  let dragOffset = $state<number | null>(null);
  let busy = $state(false);

  function onBodyDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Con Shift o ⌘ se suma a la selección en vez de sustituirla.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      project.toggleSelect(clip.id);
      return;
    }
    project.selectedId = clip.id;
    const grabStart = clip.start;
    /** Dónde está el borde izquierdo ahora mismo, para soltarlo en otra pista. */
    let bordeActual = grabStart;
    /** Pista de destino si se está arrastrando sobre otra distinta. */
    let destino: string | null = null;
    startDrag(e, {
      onStart() {
        project.commit();
        busy = true;
        project.reordering = track.magnetic;
      },
      onMove(dx, _dy, ev) {
        const zoom = project.zoom;
        const leftEdge = grabStart + dx / zoom;
        bordeActual = leftEdge;
        // ¿Hay otra pista del mismo tipo bajo el ratón? Se resalta como destino.
        const fila = document
          .elementsFromPoint(ev.clientX, ev.clientY)
          .find((el) => el instanceof HTMLElement && el.dataset.track) as HTMLElement | undefined;
        const id = fila?.dataset.track ?? null;
        const otra = id && id !== track.id ? project.tracks.find((t) => t.id === id) : null;
        destino = otra && otra.kind === track.kind ? otra.id : null;
        drop.target = destino ? { trackId: destino, time: Math.max(0, leftEdge) } : null;
        if (track.magnetic) {
          // El clip sigue al ratón; los demás se apartan para hacerle sitio.
          project.reorderClipAt(clip.id, leftEdge);
          dragOffset = (leftEdge - clip.start) * zoom;
        } else {
          const dur = clipDuration(clip);
          const points = project.snapPoints(clip.id);
          const threshold = SNAP_PX / zoom;
          let start = leftEdge;
          const snapStart = nearestSnap(start, points, threshold);
          const snapEnd = nearestSnap(start + dur, points, threshold);
          if (snapStart !== null) start = snapStart;
          else if (snapEnd !== null) start = snapEnd - dur;
          project.moveClip(clip.id, start);
        }
      },
      onEnd() {
        drop.target = null;
        if (destino) {
          const d = destino;
          destino = null;
          dragOffset = null;
          busy = false;
          project.reordering = false;
          project.moveClipToTrack(clip.id, d, bordeActual);
          return;
        }
        dragOffset = null;
        busy = false;
        project.reordering = false;
      },
    });
  }

  function onHandleDown(e: PointerEvent, edge: "in" | "out") {
    if (e.button !== 0) return;
    e.stopPropagation();
    project.selectedId = clip.id;
    const in0 = clip.in;
    const out0 = clip.out;
    const start0 = clip.start;
    const end0 = start0 + (out0 - in0);
    startDrag(e, {
      onStart() {
        project.commit();
        busy = true;
      },
      onMove(dx) {
        const zoom = project.zoom;
        const points = project.snapPoints(clip.id);
        const threshold = SNAP_PX / zoom;
        if (edge === "in") {
          let edgeT = start0 + dx / zoom;
          edgeT = nearestSnap(edgeT, points, threshold) ?? edgeT;
          project.trimIn(clip.id, in0 + (edgeT - start0), true);
        } else {
          let edgeT = end0 + dx / zoom;
          edgeT = nearestSnap(edgeT, points, threshold) ?? edgeT;
          project.trimOut(clip.id, out0 + (edgeT - end0));
        }
      },
      onEnd() {
        if (edge === "in") project.trimIn(clip.id, clip.in, false);
        busy = false;
      },
    });
  }
</script>

<div
  class="clip {clip.kind}"
  class:selected
  class:busy
  class:animate={project.reordering && !busy}
  style="left:{left}px; width:{width}px; {dragOffset !== null
    ? `transform:translateX(${dragOffset}px)`
    : ''}"
  data-clip={clip.id}
  role="option"
  aria-selected={selected}
  tabindex="-1"
  onpointerdown={onBodyDown}
  oncontextmenu={menuClip}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="handle left" onpointerdown={(e) => onHandleDown(e, "in")}></div>
  {#if clip.kind !== "text"}
    <ClipArt {clip} {width} />
  {/if}
  <div class="body">
    <span class="name">{clip.muted ? "🔇 " : ""}{clip.name}</span>
    <span class="dur">{formatDuration(clipDuration(clip))}</span>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="handle right" onpointerdown={(e) => onHandleDown(e, "out")}></div>
  {#if hasNext}
    <!-- Marcador del corte con el siguiente clip: sombreado = zona de transición; clic = editar. -->
    {#if transitionWidth > 0}
      <div class="overlap" style="width:{transitionWidth}px"></div>
    {/if}
    <button
      class="junction"
      class:on={!!clip.transition}
      title={clip.transition ? "Editar transición" : "Añadir transición"}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        e.stopPropagation();
        project.selectedId = clip.id;
      }}
    >
      {clip.transition ? "⇄" : "+"}
    </button>
  {/if}
</div>

<style>
  .clip {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border: 1px solid var(--clip-border);
    border-radius: 6px;
    background: var(--clip-bg);
    color: var(--text);
    cursor: grab;
  }
  .clip.video {
    --clip-bg: color-mix(in srgb, var(--accent) 24%, var(--panel));
    --clip-border: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .clip.audio {
    --clip-bg: color-mix(in srgb, #10b981 22%, var(--panel));
    --clip-border: color-mix(in srgb, #10b981 55%, transparent);
  }
  .clip.text {
    --clip-bg: color-mix(in srgb, #f59e0b 24%, var(--panel));
    --clip-border: color-mix(in srgb, #f59e0b 55%, transparent);
  }
  .clip.selected {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .clip.busy {
    z-index: 10;
    cursor: grabbing;
  }
  .clip.animate {
    transition: left 120ms ease;
  }
  .body {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 4px 10px;
    pointer-events: none;
  }
  .name {
    overflow: hidden;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .dur {
    font-size: 10px;
    color: var(--muted);
  }
  /* Encima de fotogramas y ondas, el nombre va en una pastilla para leerse. */
  .clip.video .body,
  .clip.audio .body {
    justify-content: flex-start;
    padding: 3px 10px;
  }
  .clip.video .name,
  .clip.video .dur,
  .clip.audio .name,
  .clip.audio .dur {
    width: fit-content;
    max-width: 100%;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
  }
  .clip.video .dur,
  .clip.audio .dur {
    color: rgba(255, 255, 255, 0.75);
  }
  /* Las pistas de audio y texto son más bajas: nombre y duración en una sola línea. */
  .clip.audio .body,
  .clip.text .body {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .clip.audio .name,
  .clip.text .name {
    min-width: 0;
  }
  .overlap {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--accent) 35%, transparent) 4px 6px);
    pointer-events: none;
  }
  .junction {
    position: absolute;
    top: 50%;
    right: -9px;
    z-index: 5;
    width: 18px;
    height: 18px;
    margin-top: -9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel);
    font-size: 11px;
    line-height: 1;
    color: var(--muted);
    opacity: 0;
    transition: opacity 100ms;
  }
  .clip:hover .junction,
  .junction.on {
    opacity: 1;
  }
  .junction.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 2;
    width: 8px;
    cursor: ew-resize;
  }
  .handle.left {
    left: 0;
  }
  .handle.right {
    right: 0;
  }
  .handle::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 3px;
    width: 2px;
    height: 14px;
    margin-top: -7px;
    border-radius: 1px;
    background: var(--text);
    opacity: 0;
    transition: opacity 100ms;
  }
  .clip:hover .handle::after,
  .clip.selected .handle::after {
    opacity: 0.5;
  }
</style>
