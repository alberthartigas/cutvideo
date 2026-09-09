<script lang="ts">
  import { samples } from "$lib/preview/samples.svelte";
  import { transitionFrame } from "$lib/transitions/presets";

  let { id, playing = false }: { id: string; playing?: boolean } = $props();

  const LOOP = 1600; // ms del ciclo completo (transición + pausa)
  let p = $state(1);

  // Solo animamos mientras el ratón está encima: el panel puede tener 13 miniaturas.
  $effect(() => {
    if (!playing) {
      p = 1;
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      const phase = ((now - t0) % LOOP) / LOOP;
      // 0–0.65 del ciclo: la transición; el resto, el clip B quieto.
      p = Math.min(1, phase / 0.65);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  let frame = $derived(transitionFrame(id, p));
</script>

<div class="thumb">
  <img src={samples.a} alt="" style={frame.a} />
  <img src={samples.b} alt="" style={frame.b} />
  {#if frame.flash > 0}
    <div class="flash" style="opacity:{frame.flash};background:{frame.flashColor}"></div>
  {/if}
</div>

<style>
  .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 6px;
    background: #000;
  }
  .thumb img,
  .flash {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .flash {
    pointer-events: none;
  }
</style>
