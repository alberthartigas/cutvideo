<script lang="ts">
  import { samples } from "$lib/preview/samples.svelte";
  import { getEffect } from "$lib/effects/presets";

  let { id, playing = false }: { id: string | null; playing?: boolean } = $props();

  let preset = $derived(id ? getEffect(id) : null);
  // Al pasar el ratón alternamos original / con efecto para ver la diferencia.
  let showOriginal = $state(false);

  $effect(() => {
    if (!playing) {
      showOriginal = false;
      return;
    }
    const timer = setInterval(() => (showOriginal = !showOriginal), 700);
    return () => clearInterval(timer);
  });
</script>

<div class="thumb">
  <img src={samples.a} alt="" style={showOriginal ? "" : `filter:${preset?.css ?? "none"}`} />
  {#if preset?.vignette && !showOriginal}
    <div class="vig" style="opacity:{preset.vignette}"></div>
  {/if}
  {#if playing && showOriginal}
    <span class="tag">Original</span>
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
  .vig {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .vig {
    background: radial-gradient(ellipse at center, transparent 45%, rgba(0, 0, 0, 0.85) 100%);
  }
  .tag {
    position: absolute;
    right: 3px;
    bottom: 3px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.6);
    padding: 1px 4px;
    font-size: 9px;
    color: #fff;
  }
</style>
