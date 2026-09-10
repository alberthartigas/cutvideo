<script lang="ts">
  /**
   * Lo que se ve dentro de un clip del timeline: sus fotogramas arriba y la
   * forma de onda abajo (o la onda entera si es un clip de audio). Se pinta en
   * un canvas y solo se repinta cuando cambian el zoom, el recorte o llegan la
   * tira o la onda.
   */
  import { clipDuration, project, type Clip } from "$lib/project.svelte";
  import { filmstrips, FOTOGRAMAS } from "$lib/filmstrips.svelte";
  import { waveforms, PICOS_POR_SEGUNDO } from "$lib/waveforms.svelte";
  import { imagenDe } from "$lib/clip-art";

  let { clip, width }: { clip: Clip; width: number } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let height = $state(0);
  let media = $derived(project.mediaOf(clip));
  let tira = $derived(clip.kind === "video" && media && !media.isImage ? filmstrips.src(media.path) : null);
  let onda = $derived(media?.audio && clip.muted !== true ? waveforms.get(media.path) : null);

  $effect(() => {
    const c = canvas;
    const m = media;
    if (!c || !m || height <= 0) return;
    const w = Math.max(1, Math.round(width));
    const h = Math.round(height);
    const zoom = project.zoom;
    const inicio = clip.in;
    const total = Math.max(0.01, m.durationSec || clipDuration(clip));
    const src = tira;
    const picos = onda;
    const esAudio = clip.kind === "audio";
    let cancelado = false;

    const pintar = (img: HTMLImageElement | null) => {
      // Un clip muy ancho a doble resolución sería un canvas enorme; con uno
      // basta, que las miniaturas van borrosas de todos modos.
      const dpr = w > 6000 ? 1 : Math.min(2, window.devicePixelRatio || 1);
      c.width = w * dpr;
      c.height = h * dpr;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const conOnda = !!picos?.length;
      const altoTira = img ? (conOnda ? Math.round(h * 0.66) : h) : 0;
      if (img && altoTira > 0) {
        const fw = img.naturalWidth / FOTOGRAMAS;
        const fh = img.naturalHeight;
        const ancho = Math.max(8, altoTira * (fw / fh));
        for (let x = 0; x < w; x += ancho) {
          const t = inicio + (x + ancho / 2) / zoom;
          const i = Math.min(FOTOGRAMAS - 1, Math.max(0, Math.floor((t / total) * FOTOGRAMAS)));
          ctx.drawImage(img, i * fw, 0, fw, fh, x, 0, ancho, altoTira);
        }
      }
      if (conOnda && picos) {
        const top = altoTira;
        const alto = h - altoTira;
        const mitad = top + alto / 2;
        ctx.fillStyle = esAudio ? "rgba(16, 185, 129, 0.8)" : "rgba(255, 255, 255, 0.5)";
        for (let x = 0; x < w; x++) {
          const a = Math.floor((inicio + x / zoom) * PICOS_POR_SEGUNDO);
          const b = Math.max(a + 1, Math.floor((inicio + (x + 1) / zoom) * PICOS_POR_SEGUNDO));
          let max = 0;
          for (let k = a; k < b && k < picos.length; k++) max = Math.max(max, picos[k]);
          if (max === 0) continue;
          const medio = Math.max(0.5, (max / 255) * (alto / 2) * 0.92);
          ctx.fillRect(x, mitad - medio, 1, medio * 2);
        }
      }
    };

    if (src) {
      imagenDe(src).then(
        (img) => !cancelado && pintar(img),
        () => !cancelado && pintar(null),
      );
    } else {
      pintar(null);
    }
    return () => {
      cancelado = true;
    };
  });
</script>

<canvas bind:this={canvas} bind:clientHeight={height} class="art"></canvas>

<style>
  .art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 6px;
    pointer-events: none;
  }
</style>
