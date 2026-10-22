<script lang="ts">
  import { AudioLines, RefreshCw } from "@lucide/svelte";
  import { project } from "$lib/project.svelte";
  import { loudness, loudnessStale, measureLoudness, readingAt } from "$lib/tauri/loudness.svelte";

  /**
   * Medidores de sonoridad (EBU R128) con el medidor de FilmCraft. Se mide la
   * mezcla entera de una vez (loudness.rs) y aquí se lee la curva según el
   * playhead, así que se mueven al reproducir sin tocar el audio que suena.
   */
  const MIN = -40;
  const MAX = 0;
  /** Lo que piden YouTube y casi todas las plataformas. */
  const TARGET = -14;

  let r = $derived(loudness.report);
  let stale = $derived(loudnessStale());
  let m = $derived(r ? readingAt(r.momentary, r.step, project.playhead) : MIN);
  let s = $derived(r ? readingAt(r.shortTerm, r.step, project.playhead) : MIN);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - MIN) / (MAX - MIN)) * 100));
  const fmt = (v: number) => (v <= -69.9 ? "−∞" : v.toFixed(1).replace("-", "−"));
  /** Verde cerca del objetivo, ámbar si se pasa, apagado si va flojo. */
  const tone = (v: number) => (v > TARGET + 3 ? "bg-amber-500" : v > TARGET - 6 ? "bg-emerald-500" : "bg-emerald-500/50");
</script>

<div class="border-b border-border px-3 py-2 text-xs">
  <div class="mb-2 flex items-center gap-1.5">
    <h3 class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
      <AudioLines size={12} /> Sonoridad
    </h3>
    <button
      class="tool ml-auto h-6"
      title="Medir la mezcla del montaje"
      disabled={loudness.measuring || project.videoTrack.clips.length === 0}
      onclick={measureLoudness}
    >
      <RefreshCw size={12} class={loudness.measuring ? "animate-spin" : ""} />
      {loudness.measuring ? "Midiendo…" : r ? "Volver a medir" : "Medir"}
    </button>
  </div>

  {#if loudness.error}
    <p class="text-[11px] text-red-500">{loudness.error}</p>
  {:else if !r}
    <p class="text-[11px] text-muted">Mide el audio del montaje para ver los LUFS y si llega a lo que pide YouTube (−14).</p>
  {:else}
    {#each [{ label: "M", title: "Momentánea (0,4 s)", v: m }, { label: "S", title: "Corto plazo (3 s)", v: s }] as b (b.label)}
      <div class="mb-1 flex items-center gap-2" title={b.title}>
        <span class="w-3 text-muted">{b.label}</span>
        <div class="relative h-2.5 flex-1 overflow-hidden rounded bg-black/40">
          <div class="h-full {tone(b.v)}" style="width:{pct(b.v)}%"></div>
          <!-- Marca del objetivo -->
          <div class="absolute inset-y-0 w-px bg-white/60" style="left:{pct(TARGET)}%"></div>
        </div>
        <span class="w-10 text-right font-mono tabular-nums">{fmt(b.v)}</span>
      </div>
    {/each}
    <dl class="mt-2 grid grid-cols-3 gap-1 text-center">
      <div title="Sonoridad media de todo el montaje: la que miran las plataformas">
        <dt class="text-[10px] text-muted">Integrada</dt>
        <dd class="font-mono tabular-nums">{fmt(r.integrated)} <span class="text-muted">LUFS</span></dd>
      </div>
      <div title="Cuánto varía entre lo flojo y lo fuerte">
        <dt class="text-[10px] text-muted">Rango</dt>
        <dd class="font-mono tabular-nums">{r.range.toFixed(1)} <span class="text-muted">LU</span></dd>
      </div>
      <div title="Pico real; por encima de −1 puede saturar al convertirlo a AAC">
        <dt class="text-[10px] text-muted">Pico</dt>
        <dd class="font-mono tabular-nums" class:text-amber-500={r.truePeak > -1}>{fmt(r.truePeak)} <span class="text-muted">dBTP</span></dd>
      </div>
    </dl>
    {#if stale}
      <p class="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">El montaje cambió: vuelve a medir.</p>
    {:else if Math.abs(r.integrated - TARGET) > 2 && r.integrated > -60}
      <p class="mt-1.5 text-[11px] text-muted">
        {r.integrated < TARGET ? "Flojo" : "Fuerte"} para YouTube: al exportar, elige «Volumen −14 LUFS» y se ajusta solo.
      </p>
    {/if}
  {/if}
</div>
