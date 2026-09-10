<script lang="ts">
  import { untrack } from "svelte";
  import { Pause, Play, SkipBack } from "@lucide/svelte";
  import { project, type Clip, type Track } from "$lib/project.svelte";
  import { proxies } from "$lib/proxies.svelte";
  import { formatDuration } from "$lib/format";
  import { renderTextClips } from "$lib/text/render";
  import { transitionFrame } from "$lib/transitions/presets";
  import { effectsCss, effectsVignette } from "$lib/effects/presets";
  import { patchAt } from "$lib/patches/types";
  import { LayerRenderer } from "$lib/preview/layer-gl";
  import VideoLayer from "./VideoLayer.svelte";

  // Capas, de abajo arriba: fondo (F1) → vídeo (V1, con croma si lo tiene) →
  // parches (P1) → textos y subtítulos. Se sustituirá por el motor WebCodecs
  // cuando todo el render pase a la GPU.
  let videoA = $state<HTMLVideoElement>();
  let videoB = $state<HTMLVideoElement>();
  let chromaCanvas = $state<HTMLCanvasElement>();
  let flashEl = $state<HTMLDivElement>();
  let vignetteEl = $state<HTMLDivElement>();
  let textCanvas = $state<HTMLCanvasElement>();
  let stageW = $state(0);
  let stageH = $state(0);
  const slots: { clipId: string | null }[] = [{ clipId: null }, { clipId: null }];
  let chroma: LayerRenderer | undefined;
  let chromaOk = $state(false);

  let empty = $derived(project.clipCount === 0);
  let frame = $derived(project.frame);
  let aspectLabel = $derived(
    project.aspect === "original"
      ? `${Math.round((frame.width / frame.height) * 100) / 100}:1`.replace("1.78:1", "16:9")
      : project.aspect,
  );
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
          src: proxies.src(c.mediaPath),
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
    const src = proxies.src(clip.mediaPath);
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.src = src;
      el.currentTime = clip.in;
    }
    if (!el.paused) el.pause();
  }

  // "Rellenar" recorta lo que sobra; "Encajar" deja franjas. Igual que el export.
  let BASE_STYLE = $derived(
    `position:absolute;inset:0;width:100%;height:100%;object-fit:${project.fit};`,
  );

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

    // Fuera de las transiciones, el clip activo lleva el reloj. En medio de
    // una hay dos vídeos a la vez y manda el temporizador.
    master = active && elA && !tr && elA instanceof HTMLVideoElement ? { el: elA, clip: active } : null;
    if (active && elA) syncClip(elA, active, t, playing);
    if (incoming && elB) {
      if (tr) syncClip(elB, incoming, t, playing);
      else preload(elB, incoming);
    }

    // Croma: el vídeo se pinta en el canvas WebGL y el <video> se esconde.
    const keyed = active?.effects?.chroma?.enabled === true && !tr && chromaOk;
    if (keyed && elA && chromaCanvas) chroma?.draw(elA, { chroma: active!.effects!.chroma });
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

  /**
   * Elemento que manda sobre el tiempo mientras se reproduce.
   *
   * Antes el reloj era `performance.now()` y el vídeo se corregía a él con un
   * seek cada vez que se desviaba. Si `play()` fallaba —el WebView bloquea el
   * sonido sin un gesto del usuario— el vídeo no avanzaba solo y se hacía un
   * seek POR CADA FOTOGRAMA: cada uno decodifica desde el keyframe anterior,
   * el preview iba a saltos, no sonaba nada y el procesador ardía. Ahora el
   * vídeo activo es el reloj y el playhead lo sigue, como en cualquier
   * reproductor. Solo se corrige con un seek al cambiar de clip.
   */
  let master: { el: HTMLMediaElement; clip: Clip } | null = null;
  /** true si el sistema rechazó reproducir: hay que pedir un clic. */
  let playBloqueado = $state(false);

  /** Reintenta reproducir desde un clic, que es lo que el sistema exige. */
  function desbloquearSonido() {
    for (const el of [videoA, videoB, audioEl]) {
      if (el && el.paused && el.dataset.src) el.play().then(() => (playBloqueado = false)).catch(() => {});
    }
  }

  /** Ajusta un elemento a un clip concreto en el instante `t`. */
  function syncClip(el: HTMLMediaElement, clip: Clip, t: number, playing: boolean) {
    const src = proxies.src(clip.mediaPath);
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.src = src;
    }
    const expected = clip.in + (t - clip.start);
    const esMaster = playing && master?.el === el;
    // Parados, exactitud; reproduciendo, solo se corrige un desvío real (un
    // cambio de clip), nunca el vaivén normal del reloj del vídeo.
    const tolerancia = !playing ? 0.02 : esMaster ? 0.5 : 0.25;
    if (Math.abs(el.currentTime - expected) > tolerancia) el.currentTime = expected;
    if (playing) {
      if (el.paused) {
        el.play()
          .then(() => (playBloqueado = false))
          .catch(() => (playBloqueado = true));
      }
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

  let audioEl = $state<HTMLAudioElement>();

  // WebGL se prepara una vez, cuando aparece el canvas.
  $effect(() => {
    if (!chromaCanvas) return;
    chroma ??= new LayerRenderer(chromaCanvas);
    chromaOk = chroma.init();
  });

  // Parados: cada cambio del playhead (o de los clips) actualiza el frame.
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
    let t0 = untrack(() => project.playhead);
    let w0 = performance.now();
    // Arrancar ya, en el mismo turno que el clic de play: así la petición de
    // reproducir cuenta como gesto del usuario y el sistema no la bloquea.
    syncVideo(t0, true);
    syncAudio(t0, true);
    let raf = requestAnimationFrame(function tick() {
      let t: number;
      const m = master;
      if (m && !m.el.paused && !m.el.seeking && m.el.readyState >= 2) {
        // El vídeo manda; el temporizador se realinea por si hay que tirar de
        // él en el siguiente hueco (transición, tramo sin vídeo).
        t = m.clip.start + (m.el.currentTime - m.clip.in);
        t0 = t;
        w0 = performance.now();
      } else {
        t = t0 + (performance.now() - w0) / 1000;
      }
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
  <div class="stage relative min-h-0 flex-1" bind:clientWidth={stageW} bind:clientHeight={stageH}>
    {#if viewW > 0}
      <div
        class="canvas absolute overflow-hidden"
        style="left:{Math.round((stageW - viewW) / 2)}px; top:{Math.round((stageH - viewH) / 2)}px; width:{viewW}px; height:{viewH}px"
      >
        <!-- Fondo (F1), por detrás de todo -->
        <VideoLayer track={project.backgroundTrack} time={project.playhead} playing={project.playing} {viewH} fit={project.fit} />
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoA} playsinline preload="auto" style="{BASE_STYLE}visibility:hidden"></video>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoB} playsinline preload="auto" style="{BASE_STYLE}visibility:hidden"></video>
        <canvas
          bind:this={chromaCanvas}
          class="pointer-events-none absolute inset-0 h-full w-full"
          style="visibility:hidden;object-fit:{project.fit}"
        ></canvas>
        <div
          bind:this={vignetteEl}
          class="pointer-events-none absolute inset-0"
          style="opacity:0;background:radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.85) 100%)"
        ></div>
        <div bind:this={flashEl} class="pointer-events-none absolute inset-0" style="opacity:0"></div>
        <!-- Capas superpuestas: la última de la lista queda arriba, así que se pintan al revés -->
        {#each [...project.overlayTracks].reverse() as track (track.id)}
          <VideoLayer {track} time={project.playhead} playing={project.playing} {viewH} fit={project.fit} />
        {/each}
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
    {#if playBloqueado && project.playing}
      <!-- El sistema no deja sonar sin un gesto: el clic de aquí lo es. -->
      <button
        class="absolute inset-x-0 bottom-3 mx-auto w-max rounded-full bg-black/75 px-3 py-1.5 text-xs text-white shadow-lg"
        onclick={desbloquearSonido}
      >
        Haz clic para activar el sonido
      </button>
    {/if}
    {#if empty && viewW > 0}
      <!-- Dentro del lienzo, para que se vea la forma del formato elegido. -->
      <p
        class="pointer-events-none absolute flex flex-col items-center justify-center gap-1 px-4 text-center text-sm text-neutral-500"
        style="left:{Math.round((stageW - viewW) / 2)}px; top:{Math.round((stageH - viewH) / 2)}px; width:{viewW}px; height:{viewH}px"
      >
        <span>Añade clips al timeline</span>
        <span class="text-xs opacity-70">{aspectLabel} · {frame.width}×{frame.height}</span>
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
    <span class="ml-auto text-[11px] text-muted">{aspectLabel} · {frame.width}×{frame.height}</span>
  </div>
</div>

<style>
  /* El escenario es más claro que el lienzo: así se ve dónde acaba el vídeo
     y qué forma tiene el formato elegido, aunque el proyecto esté vacío. */
  .stage {
    background:
      repeating-conic-gradient(
          color-mix(in srgb, var(--muted) 7%, transparent) 0% 25%,
          transparent 0% 50%
        )
        50% / 16px 16px,
      var(--track);
  }
  .canvas {
    background: #000;
    border-radius: 3px;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--muted) 45%, transparent),
      0 8px 28px rgba(0, 0, 0, 0.35);
  }
</style>
