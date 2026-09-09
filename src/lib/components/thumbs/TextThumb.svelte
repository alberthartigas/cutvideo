<script lang="ts">
  import { drawTextClip } from "$lib/text/render";
  import { DEFAULT_TEXT, type TextData } from "$lib/text/styles";

  /** Miniatura animada de un preset de texto, con el mismo motor que el preview. */
  let {
    data,
    label = "Texto",
    playing = false,
    duration = 1.8,
  }: { data: Partial<TextData>; label?: string; playing?: boolean; duration?: number } = $props();

  const W = 160;
  const H = 90;
  let canvas = $state<HTMLCanvasElement>();

  let full = $derived<TextData>({
    ...DEFAULT_TEXT,
    fontSize: 0.16,
    y: 0.5,
    maxWidth: 0.9,
    stroke: 0.05,
    inDur: duration * 0.4,
    outDur: 0.01,
    ...data,
    // Después del spread: los estilos de subtítulo traen `text: ""` y si no,
    // borrarían la etiqueta y la miniatura saldría en blanco.
    text: label,
    wordTimes: undefined,
  });

  $effect(() => {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const frame = { width: W, height: H };
    if (!playing) {
      // Parado: el estado final de la animación.
      ctx.clearRect(0, 0, W, H);
      drawTextClip(ctx, full, duration * 0.5, duration, frame);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      const u = ((now - t0) / 1000) % duration;
      ctx.clearRect(0, 0, W, H);
      drawTextClip(ctx, full, u, duration, frame);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} width={W} height={H} class="thumb"></canvas>

<style>
  .thumb {
    display: block;
    aspect-ratio: 16 / 9;
    width: 100%;
    border-radius: 6px;
    background: linear-gradient(135deg, #2a2a33, #16161a);
  }
</style>
