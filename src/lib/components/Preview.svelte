<script lang="ts">
  import { untrack } from "svelte";
  import { Pause, Play, SkipBack } from "@lucide/svelte";
  import { project, type Clip, type Track } from "$lib/project.svelte";
  import { mediaSrc } from "$lib/tauri/media";
  import { formatDuration } from "$lib/format";
  import { renderTextClips } from "$lib/text/render";
  import { transitionFrame } from "$lib/transitions/presets";
  import { effectsCss, effectsVignette } from "$lib/effects/presets";
  import { patchAt } from "$lib/patches/types";
  import { ChromaRenderer } from "$lib/preview/chroma-gl";

  // Capas, de abajo arriba: fondo (F1) → vídeo (V1, con croma si lo tiene) →
  // parches (P1) → textos y subtítulos. Se sustituirá por el motor WebCodecs
  // cuando todo el render pase a la GPU.
  let videoA = $state<HTMLVideoElement>();
  let videoB = $state<HTMLVideoElement>();
  let bgEl = $state<HTMLVideoElement>();
  let chromaCanvas = $state<HTMLCanvasElement>();
  let flashEl = $state<HTMLDivElement>();
  let vignetteEl = $state<HTMLDivElement>();
  let textCanvas = $state<HTMLCanvasElement>();
  let stageW = $state(0);
  let stageH = $state(0);
  const slots: { clipId: string | null }[] = [{ clipId: null }, { clipId: null }];
  let chroma: ChromaRenderer | undefined;
  let chromaOk = $state(false);

  let empty = $derived(project.clipCount === 0);
  let frame = $derived(project.frame);
  // El frame del proyecto, encajado en el hueco disponible (letterbox), como hará el export.
  let scale = $derived(stageW && stageH ? Math.min(stageW / frame.width, stageH / frame.height) : 0);
  let viewW = $derived(Math.round(frame.width * scale));
  let viewH = $derived(Math.round(frame.height * scale));

  /** Parches visibles ahora mismo, ya colocados. */
  let patches = $derived.by(() => {
    const t = project.playhead;
    return project.patchTrack.clips
      .filter((c) => c.patch && t >= c.start && t < c.start + (c.out - c.in))
      .map((c) => {
        const p = c.patch!;
        const pos = patchAt(p, t);
        return {
          id: c.id,
          src: mediaSrc(c.mediaPath),
          left: pos.x * 100,
          top: pos.y * 100,
          width: p.width * pos.scale * 100,
          rotation: p.rotation,
          opacity: p.opacity,
          flip: p.flip,
        };
      });
  });

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

    // Croma: el vídeo se pinta en el canvas WebGL y el <video> se esconde.
    const keyed = active?.effects?.chroma?.enabled === true && !tr && chromaOk;
    if (keyed && elA && chromaCanvas) chroma?.draw(elA, active!.effects!.chroma!);
    if (chromaCanvas) {
      chromaCanvas.style.visibility = keyed ? "visible" : "hidden";
      chromaCanvas.style.filter = keyed && active ? (effectsCss(active.effects, viewH) || "none") : "none";
    }

    const frameStyle = tr ? transitionFrame(tr.id, tr.p) : null;
    for (const el of [videoA, videoB]) {
      if (!el) continue;
      if (el === elA && active) {
        el.style.cssText = styleFor(active, keyed ? "visibility:hidden" : (frameStyle?.a ?? ""));
      } else if (el === elB && tr && incoming) {
        el.style.cssText = styleFor(incoming, frameStyle?.b ?? "");
      } else {
        el.style.cssText = `${BASE_STYLE}visibility:hidden`;
        if (!el.paused && el !== elB) el.pause();
      }
    }
    if (flashEl) {
      flashEl.style.opacity = String(frameStyle?.flash ?? 0);
      flashEl.style.background = frameStyle?.flashColor ?? "#fff";
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

  /** Pista de fondo (F1): lo que se ve por detrás de la pantalla verde. */
  function syncBackground(t: number, playing: boolean) {
    const el = bgEl;
    if (!el) return;
    const clip = lastFrameClip(project.backgroundTrack, t, playing);
    if (!clip) {
      el.style.visibility = "hidden";
      if (!el.paused) el.pause();
      return;
    }
    el.style.visibility = "visible";
    el.style.filter = effectsCss(clip.effects, viewH) || "none";
    syncClip(el, clip, t, playing);
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

  let audioEl = $state<HTMLAudioElement>();

  // WebGL se prepara una vez, cuando aparece el canvas.
  $effect(() => {
    if (!chromaCanvas) return;
    chroma ??= new ChromaRenderer(chromaCanvas);
    chromaOk = chroma.init();
  });

  // Parados: cada cambio del playhead (o de los clips) actualiza el frame.
  $effect(() => {
    if (project.playing) return;
    syncBackground(project.playhead, false);
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
      syncBackground(t, true);
      syncVideo(t, true);
      syncAudio(t, true);
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      videoA?.pause();
      videoB?.pause();
      bgEl?.pause();
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
        <video bind:this={bgEl} playsinline preload="auto" muted style="{BASE_STYLE}visibility:hidden"></video>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoA} playsinline preload="auto" style="{BASE_STYLE}visibility:hidden"></video>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoB} playsinline preload="auto" style="{BASE_STYLE}visibility:hidden"></video>
        <canvas bind:this={chromaCanvas} class="pointer-events-none absolute inset-0 h-full w-full object-contain" style="visibility:hidden"></canvas>
        <div
          bind:this={vignetteEl}
          class="pointer-events-none absolute inset-0"
          style="opacity:0;background:radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.85) 100%)"
        ></div>
        <div bind:this={flashEl} class="pointer-events-none absolute inset-0" style="opacity:0"></div>
        {#each patches as p (p.id)}
          <img
            src={p.src}
            alt=""
            class="pointer-events-none absolute origin-center"
            style="left:{p.left}%; top:{p.top}%; width:{p.width}%; opacity:{p.opacity};
                   transform: translate(-50%, -50%) rotate({p.rotation}deg) scaleX({p.flip ? -1 : 1})"
          />
        {/each}
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
