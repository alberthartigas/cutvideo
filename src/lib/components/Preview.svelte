<script lang="ts">
  import { untrack } from "svelte";
  import { Pause, Play, SkipBack } from "@lucide/svelte";
  import { project, type Track } from "$lib/project.svelte";
  import { mediaSrc } from "$lib/tauri/media";
  import { formatDuration } from "$lib/format";
  import { renderTextClips } from "$lib/text/render";

  // Reproductor provisional: un <video> para V1 y un <audio> para A1, esclavizados
  // a un reloj de pared, más un canvas transparente encima con los textos animados.
  // Se sustituirá por el motor WebCodecs + WebGL cuando lleguen transiciones y color.
  let videoEl = $state<HTMLVideoElement>();
  let audioEl = $state<HTMLAudioElement>();
  let textCanvas = $state<HTMLCanvasElement>();
  let stageW = $state(0);
  let stageH = $state(0);

  let empty = $derived(project.clipCount === 0);
  let frame = $derived(project.frame);
  // El frame del proyecto, encajado en el hueco disponible (letterbox), como hará el export.
  let scale = $derived(stageW && stageH ? Math.min(stageW / frame.width, stageH / frame.height) : 0);
  let viewW = $derived(Math.round(frame.width * scale));
  let viewH = $derived(Math.round(frame.height * scale));

  function lastFrameClip(track: Track, t: number) {
    return project.clipAt(track, t) ?? (t > 0 && !project.playing ? project.clipAt(track, t - 1e-3) : null);
  }
  let hasVideo = $derived(lastFrameClip(project.videoTrack, project.playhead) !== null);

  /** Ajusta un elemento multimedia a lo que toca en la pista en el instante `t`. */
  function sync(el: HTMLMediaElement | undefined, track: Track, t: number, playing: boolean) {
    if (!el) return;
    // Parados justo al final del proyecto enseñamos el último frame, no negro.
    const clip = project.clipAt(track, t) ?? (t > 0 && !playing ? project.clipAt(track, t - 1e-3) : null);
    if (!clip) {
      if (!el.paused) el.pause();
      return;
    }
    const src = mediaSrc(clip.mediaPath);
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.src = src;
    }
    const expected = clip.in + (t - clip.start);
    // Reproduciendo toleramos algo de deriva; parados buscamos el frame exacto.
    if (Math.abs(el.currentTime - expected) > (playing ? 0.15 : 0.02)) el.currentTime = expected;
    if (playing) {
      if (el.paused) el.play().catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }
  }

  // Parado: cada cambio del playhead (o de los clips) actualiza el frame.
  $effect(() => {
    if (project.playing) return;
    sync(videoEl, project.videoTrack, project.playhead, false);
    sync(audioEl, project.audioTrack, project.playhead, false);
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
    const video = videoEl;
    const audio = audioEl;
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
      sync(video, project.videoTrack, t, true);
      sync(audio, project.audioTrack, t, true);
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      video?.pause();
      audio?.pause();
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
        <video bind:this={videoEl} playsinline preload="auto" class="absolute inset-0 h-full w-full object-contain" class:invisible={!hasVideo}></video>
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
