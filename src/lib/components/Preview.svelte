<script lang="ts">
  import { untrack } from "svelte";
  import { Pause, Play, SkipBack } from "@lucide/svelte";
  import { project, type Clip, type Track } from "$lib/project.svelte";
  import { mediaSrc } from "$lib/tauri/media";
  import { formatDuration } from "$lib/format";
  import { renderTextClips } from "$lib/text/render";
  import { transitionFrame } from "$lib/transitions/presets";
  import { effectsCss, effectsVignette } from "$lib/effects/presets";

  // Reproductor provisional: un <video> para V1 y un <audio> para A1, esclavizados
  // a un reloj de pared, más un canvas transparente encima con los textos animados.
  // Se sustituirá por el motor WebCodecs + WebGL cuando lleguen transiciones y color.
  // Dos <video> para la pista principal: el siguiente clip se precarga en el
  // libre (cortes sin tirón) y durante una transición se ven los dos.
  let videoA = $state<HTMLVideoElement>();
  let videoB = $state<HTMLVideoElement>();
  let flashEl = $state<HTMLDivElement>();
  let vignetteEl = $state<HTMLDivElement>();
  let audioEl = $state<HTMLAudioElement>();
  const slots: { clipId: string | null }[] = [{ clipId: null }, { clipId: null }];
  let textCanvas = $state<HTMLCanvasElement>();
  let stageW = $state(0);
  let stageH = $state(0);

  let empty = $derived(project.clipCount === 0);
  let frame = $derived(project.frame);
  // El frame del proyecto, encajado en el hueco disponible (letterbox), como hará el export.
  let scale = $derived(stageW && stageH ? Math.min(stageW / frame.width, stageH / frame.height) : 0);
  let viewW = $derived(Math.round(frame.width * scale));
  let viewH = $derived(Math.round(frame.height * scale));

  function lastFrameClip(track: Track, t: number, playing: boolean) {
    return project.clipAt(track, t) ?? (t > 0 && !playing ? project.clipAt(track, t - 1e-3) : null);
  }

  /** Elemento de vídeo asignado a un clip; si no tiene, usa el que no esté ocupado por `keepId`. */
  function slotFor(clipId: string, keepId: string | null): HTMLVideoElement | undefined {
    const els = [videoA, videoB];
    let idx = slots.findIndex((s) => s.clipId === clipId);
    if (idx < 0) idx = slots.findIndex((s) => s.clipId === null || s.clipId !== keepId);
    if (idx < 0) idx = 0;
    slots[idx].clipId = clipId;
    return els[idx];
  }

  /** Deja listo un clip en un elemento sin reproducirlo (precarga). */
  function preload(el: HTMLVideoElement | undefined, clip: Clip) {
    if (!el) return;
    const src = mediaSrc(clip.mediaPath);
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.src = src;
      el.currentTime = clip.in;
    }
    if (!el.paused) el.pause();
  }

  const BASE_STYLE = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;";

  /** Estilo del elemento: transición + filtro de color del clip. */
  function styleFor(clip: Clip, extra: string): string {
    const css = effectsCss(clip.effects, viewH);
    const filter = css ? `filter:${css};` : "";
    return `${BASE_STYLE}${filter}${extra}`;
  }

  /** Pista principal: clip activo, transición en curso y precarga del siguiente. */
  function syncVideo(t: number, playing: boolean) {
    const track = project.videoTrack;
    const tr = project.transitionAt(t);
    const active = tr ? tr.out : lastFrameClip(track, t, playing);
    const incoming = tr ? tr.in : active ? project.nextClip(active) : null;
    const elA = active ? slotFor(active.id, incoming?.id ?? null) : undefined;
    const elB = incoming ? slotFor(incoming.id, active?.id ?? null) : undefined;

    if (active && elA) syncClip(elA, active, t, playing);
    if (incoming && elB) {
      if (tr) syncClip(elB, incoming, t, playing);
      else preload(elB, incoming);
    }
    const frame = tr ? transitionFrame(tr.id, tr.p) : null;
    for (const el of [videoA, videoB]) {
      if (!el) continue;
      if (el === elA && active) el.style.cssText = styleFor(active, frame?.a ?? "");
      else if (el === elB && tr && incoming) el.style.cssText = styleFor(incoming, frame?.b ?? "");
      else {
        el.style.cssText = `${BASE_STYLE}visibility:hidden`;
        if (!el.paused && el !== elB) el.pause();
      }
    }
    if (flashEl) {
      flashEl.style.opacity = String(frame?.flash ?? 0);
      flashEl.style.background = frame?.flashColor ?? "#fff";
    }
    // La viñeta va en su propia capa (un filtro CSS no puede hacerla).
    if (vignetteEl) {
      const v = active ? effectsVignette(active.effects) : 0;
      vignetteEl.style.opacity = String(v);
    }
  }

  /** Ajusta un elemento a un clip concreto en el instante `t`. */
  function syncClip(el: HTMLMediaElement, clip: Clip, t: number, playing: boolean) {
    const src = mediaSrc(clip.mediaPath);
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.src = src;
    }
    const expected = clip.in + (t - clip.start);
    if (Math.abs(el.currentTime - expected) > (playing ? 0.15 : 0.02)) el.currentTime = expected;
    if (playing) {
      if (el.paused) el.play().catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }
  }

  /** Pista de audio libre: un solo elemento, parado si no hay clip. */
  function syncAudio(t: number, playing: boolean) {
    const el = audioEl;
    if (!el) return;
    const clip = lastFrameClip(project.audioTrack, t, playing);
    if (!clip) {
      if (!el.paused) el.pause();
      return;
    }
    syncClip(el, clip, t, playing);
  }

  // Parado: cada cambio del playhead (o de los clips) actualiza el frame.
  $effect(() => {
    if (project.playing) return;
    syncVideo(project.playhead, false);
    syncAudio(project.playhead, false);
  });

  // Textos: se redibujan con cada cambio del playhead, del texto o del tamaño del frame.
  $effect(() => {
    const ctx = textCanvas?.getContext("2d");
    if (!ctx) return;
    renderTextClips(ctx, project.textClips, project.playhead, frame);
  });

  // Reproduciendo: bucle con requestAnimationFrame.
  $effect(() => {
    if (!project.playing) return;
    const t0 = untrack(() => project.playhead);
    const w0 = performance.now();
    let raf = requestAnimationFrame(function tick() {
      const t = t0 + (performance.now() - w0) / 1000;
      const end = project.duration;
      if (t >= end) {
        project.playhead = end;
        project.playing = false;
        return;
      }
      project.playhead = t;
      syncVideo(t, true);
      syncAudio(t, true);
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      videoA?.pause();
      videoB?.pause();
      audioEl?.pause();
    };
  });

  function goToStart() {
    project.playing = false;
    project.setPlayhead(0);
  }
</script>

<div class="flex h-full flex-col">
  <div class="relative min-h-0 flex-1 bg-black" bind:clientWidth={stageW} bind:clientHeight={stageH}>
    {#if viewW > 0}
      <div
        class="absolute overflow-hidden"
        style="left:{Math.round((stageW - viewW) / 2)}px; top:{Math.round((stageH - viewH) / 2)}px; width:{viewW}px; height:{viewH}px"
      >
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoA} playsinline preload="auto" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;visibility:hidden"></video>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoB} playsinline preload="auto" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;visibility:hidden"></video>
        <div
          bind:this={vignetteEl}
          class="pointer-events-none absolute inset-0"
          style="opacity:0;background:radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.85) 100%)"
        ></div>
        <div bind:this={flashEl} class="pointer-events-none absolute inset-0" style="opacity:0"></div>
        <canvas bind:this={textCanvas} width={frame.width} height={frame.height} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>
      </div>
    {/if}
    <audio bind:this={audioEl} preload="auto"></audio>
    {#if empty}
      <p class="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
        Añade clips al timeline para ver el resultado
      </p>
    {/if}
  </div>

  <div class="flex h-9 shrink-0 items-center gap-1 border-t border-border px-2">
    <button class="tool" title="Al inicio (Inicio)" onclick={goToStart}><SkipBack size={14} /></button>
    <button class="tool" title="Reproducir / pausar (espacio)" disabled={empty} onclick={() => project.togglePlay()}>
      {#if project.playing}<Pause size={14} />{:else}<Play size={14} />{/if}
    </button>
    <span class="ml-2 font-mono text-xs tabular-nums">{formatDuration(project.playhead)}</span>
    <span class="font-mono text-xs tabular-nums text-muted">/ {formatDuration(project.duration)}</span>
    <span class="ml-auto text-[11px] text-muted">{frame.width}×{frame.height}</span>
  </div>
</div>
