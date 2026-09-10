<script lang="ts">
  import { clipEnd, project, type Clip, type Track } from "$lib/project.svelte";
  import { proxies } from "$lib/proxies.svelte";
  import { effectsCss, effectsVignette } from "$lib/effects/presets";
  import { DEFAULT_LAYOUT } from "$lib/layers";
  import { LayerRenderer } from "$lib/preview/layer-gl";
  import { segmenter } from "$lib/segment/segmenter.svelte";
  import { clock } from "$lib/playback-clock";

  // Si no hay nada en V1, esta capa puede llevar el reloj del preview.
  $effect(() => () => clock.set(track.id, null));

  /**
   * Una capa de vídeo del preview (fondo o superpuesta). Se encarga de
   * sincronizar el clip con el playhead y de aplicarle pantalla verde y/o
   * recorte de persona, que necesitan pintar en un canvas.
   */
  let {
    track,
    time,
    playing,
    viewH,
    fit = "cover",
  }: { track: Track; time: number; playing: boolean; viewH: number; fit?: string } = $props();

  /** Fotograma reducido para el recorte: al modelo no le hace falta más. */
  const CHICO = 512;
  let reducido: HTMLCanvasElement | undefined;

  let videoEl = $state<HTMLVideoElement>();
  let canvasEl = $state<HTMLCanvasElement>();
  let renderer: LayerRenderer | undefined;
  let glOk = $state(false);

  /** Clip visible ahora; parados enseñamos el último frame en vez de negro. */
  let clip = $derived.by(() => {
    const at = project.clipAt(track, time);
    if (at) return at;
    return time > 0 && !playing ? project.clipAt(track, time - 1e-3) : null;
  });
  let layout = $derived({ ...DEFAULT_LAYOUT, ...clip?.layout });
  let needsCanvas = $derived(!!clip && (clip.effects?.chroma?.enabled === true || layout.cutout));

  $effect(() => {
    if (!canvasEl) return;
    renderer ??= new LayerRenderer(canvasEl);
    glOk = renderer.init();
  });

  // El recorte carga el modelo la primera vez que se usa.
  $effect(() => {
    if (layout.cutout) segmenter.load();
  });

  $effect(() => {
    const el = videoEl;
    if (!el) return;
    if (!clip) {
      if (!el.paused) el.pause();
      clock.set(track.id, null);
      return;
    }
    const src = proxies.src(clip.mediaPath);
    if (el.dataset.src !== src) {
      el.dataset.src = src;
      el.src = src;
    }
    clock.set(track.id, { el, clip });
    const expected = clip.in + (time - clip.start);
    // Reproduciendo, solo se corrige un desvío real: cada seek decodifica
    // desde el keyframe anterior y con 0,15 s de margen se hacían a cada rato.
    if (Math.abs(el.currentTime - expected) > (playing ? 0.35 : 0.02)) el.currentTime = expected;
    if (playing) {
      if (el.paused) el.play().catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }

    pintar();
  });

  /**
   * Pinta el frame actual con croma y/o recorte. Se llama desde el efecto (que
   * corre con cada cambio del playhead) y también cuando el vídeo avisa de que
   * ya tiene imagen: al cargar o al terminar de buscar, el efecto ya ha pasado
   * y sin esto la capa se quedaría en blanco hasta el siguiente cambio.
   */
  function pintar() {
    const el = videoEl;
    if (!el || !clip || !renderer || !needsCanvas || !glOk) return;
    const mask = layout.cutout && segmenter.ready ? segmenter.segment(fotogramaChico(el)) : null;
    renderer.draw(el, { chroma: clip.effects?.chroma, mask, feather: layout.feather });
  }

  /**
   * Copia del fotograma a lo sumo 512 px de lado. Segmentar a 1080p cuesta el
   * doble y da la misma silueta, porque el modelo trabaja a 256 px por dentro.
   * Se mantiene la proporción entera, sin recortar, para que la máscara siga
   * cuadrando con el vídeo píxel a píxel.
   */
  function fotogramaChico(el: HTMLVideoElement): HTMLCanvasElement | HTMLVideoElement {
    const [w, h] = [el.videoWidth, el.videoHeight];
    if (!w || !h || Math.max(w, h) <= CHICO) return el;
    const escala = CHICO / Math.max(w, h);
    reducido ??= document.createElement("canvas");
    const [cw, ch] = [Math.max(2, Math.round(w * escala)), Math.max(2, Math.round(h * escala))];
    // Asignar el tamaño borra el lienzo, así que solo se toca si cambió.
    if (reducido.width !== cw || reducido.height !== ch) {
      reducido.width = cw;
      reducido.height = ch;
    }
    reducido.getContext("2d")!.drawImage(el, 0, 0, reducido.width, reducido.height);
    return reducido;
  }

  /** Caja de la capa dentro del frame, en porcentaje. */
  let box = $derived({
    left: (layout.x - layout.scale / 2) * 100,
    top: (layout.y - layout.scale / 2) * 100,
    size: layout.scale * 100,
  });
  let filtro = $derived(clip ? effectsCss(clip.effects, viewH) : "");
  let vineta = $derived(clip ? effectsVignette(clip.effects) : 0);
  // Con canvas el vídeo se esconde: lo que se ve es el canvas ya recortado.
  let usaCanvas = $derived(needsCanvas && glOk);
</script>

<div
  class="absolute"
  style="left:{box.left}%; top:{box.top}%; width:{box.size}%; height:{box.size}%;
         opacity:{clip ? layout.opacity : 0}; {filtro ? `filter:${filtro};` : ''}"
>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    playsinline
    preload="auto"
    onloadeddata={pintar}
    onseeked={pintar}
    muted={clip?.muted === true}
    class="absolute inset-0 h-full w-full"
    style="object-fit:{fit};visibility:{clip && !usaCanvas ? 'visible' : 'hidden'}"
  ></video>
  <canvas
    bind:this={canvasEl}
    class="pointer-events-none absolute inset-0 h-full w-full"
    style="object-fit:{fit};visibility:{usaCanvas ? 'visible' : 'hidden'}"
  ></canvas>
  {#if vineta > 0}
    <div
      class="pointer-events-none absolute inset-0"
      style="opacity:{vineta};background:radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.85) 100%)"
    ></div>
  {/if}
</div>
