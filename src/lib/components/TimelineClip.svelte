<script lang="ts">
  import {
    clipDuration,
    nearestSnap,
    project,
    type Clip,
    type Track,
  } from "$lib/project.svelte";
  import { startDrag } from "$lib/drag";
  import { formatDuration } from "$lib/format";

  let { clip, track }: { clip: Clip; track: Track } = $props();

  const SNAP_PX = 8;

  let selected = $derived(project.selectedId === clip.id);
  let left = $derived(clip.start * project.zoom);
  let width = $derived(Math.max(2, clipDuration(clip) * project.zoom));
  /** Desplazamiento visual (px) mientras se reordena en una pista magnética. */
  let dragOffset = $state<number | null>(null);
  let busy = $state(false);

  function onBodyDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    project.selectedId = clip.id;
    const grabStart = clip.start;
    startDrag(e, {
      onStart() {
        project.commit();
        busy = true;
        project.reordering = track.magnetic;
      },
      onMove(dx) {
        const zoom = project.zoom;
        const leftEdge = grabStart + dx / zoom;
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
  role="option"
  aria-selected={selected}
  tabindex="-1"
  onpointerdown={onBodyDown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="handle left" onpointerdown={(e) => onHandleDown(e, "in")}></div>
  <div class="body">
    <span class="name">{clip.name}</span>
    <span class="dur">{formatDuration(clipDuration(clip))}</span>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="handle right" onpointerdown={(e) => onHandleDown(e, "out")}></div>
</div>

<style>
  .clip {
    position: absolute;
    top: 4px;
    bottom: 4px;
    overflow: hidden;
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
