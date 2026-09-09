<script lang="ts">
  import { project, type Clip, clipDuration } from "$lib/project.svelte";
  import { EMPHASIS_ANIMATIONS, INOUT_ANIMATIONS } from "$lib/text/animations";
  import { FONTS, type TextData } from "$lib/text/styles";
  import { formatDuration } from "$lib/format";

  let { clip }: { clip: Clip } = $props();
  let data = $derived(clip.text!);

  const set = (patch: Partial<TextData>) => project.updateText(clip.id, patch);
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const str = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;
  const POSITIONS = [
    { label: "Arriba", y: 0.14 },
    { label: "Centro", y: 0.5 },
    { label: "Abajo", y: 0.86 },
  ];
</script>

{#snippet row(label: string)}
  <span class="w-24 shrink-0 text-muted">{label}</span>
{/snippet}

<!-- Cada control guarda un punto de deshacer al recibir el foco (commit no duplica estados iguales). -->
<div class="flex-1 overflow-auto px-3 py-2 text-xs" onfocusin={() => project.commit()}>
  <textarea
    class="field h-20 w-full resize-none py-1.5 leading-snug"
    value={data.text}
    oninput={(e) => set({ text: str(e) })}
    placeholder="Escribe el texto…"
    spellcheck="false"
  ></textarea>
  <p class="mt-1 text-[11px] text-muted">
    {formatDuration(clip.start)} · {formatDuration(clipDuration(clip))} · Intro para nueva línea
  </p>

  <h3 class="mt-4 mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Animación</h3>
  <div class="flex flex-col gap-2">
    <label class="flex items-center gap-2">
      {@render row("Entrada")}
      <select class="field h-7 flex-1" value={data.animIn} onchange={(e) => set({ animIn: str(e) })}>
        {#each INOUT_ANIMATIONS as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
      </select>
      <input class="field h-7 w-14 px-1.5 text-center" type="number" min="0" max="5" step="0.1" value={data.inDur} onchange={(e) => set({ inDur: num(e) })} title="Duración (s)" />
    </label>
    <label class="flex items-center gap-2">
      {@render row("Salida")}
      <select class="field h-7 flex-1" value={data.animOut} onchange={(e) => set({ animOut: str(e) })}>
        {#each INOUT_ANIMATIONS as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
      </select>
      <input class="field h-7 w-14 px-1.5 text-center" type="number" min="0" max="5" step="0.1" value={data.outDur} onchange={(e) => set({ outDur: num(e) })} title="Duración (s)" />
    </label>
    <label class="flex items-center gap-2">
      {@render row("Énfasis")}
      <select class="field h-7 flex-1" value={data.emphasis} onchange={(e) => set({ emphasis: str(e) })}>
        {#each EMPHASIS_ANIMATIONS as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
      </select>
    </label>
  </div>

  <h3 class="mt-4 mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Estilo</h3>
  <div class="flex flex-col gap-2">
    <label class="flex items-center gap-2">
      {@render row("Fuente")}
      <select class="field h-7 flex-1" value={data.fontFamily} onchange={(e) => set({ fontFamily: str(e) })}>
        {#each FONTS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
      </select>
      <button class="tool h-7 w-7 justify-center px-0 font-bold" class:text-accent={data.bold} title="Negrita" onclick={() => set({ bold: !data.bold })}>B</button>
    </label>
    <label class="flex items-center gap-2">
      {@render row("Tamaño")}
      <input class="flex-1 accent-accent" type="range" min="0.03" max="0.25" step="0.005" value={data.fontSize} oninput={(e) => set({ fontSize: num(e) })} />
      <span class="w-10 text-right tabular-nums">{Math.round(data.fontSize * 100)}%</span>
    </label>
    <div class="flex items-center gap-2">
      {@render row("Alineación")}
      <div class="seg">
        {#each [["left", "Izq."], ["center", "Centro"], ["right", "Der."]] as [value, label] (value)}
          <button class="seg-btn" class:active={data.align === value} onclick={() => set({ align: value as TextData["align"] })}>{label}</button>
        {/each}
      </div>
    </div>
    <label class="flex items-center gap-2">
      {@render row("Color")}
      <input type="color" class="h-7 w-10 cursor-pointer rounded border border-border bg-panel" value={data.color} oninput={(e) => set({ color: str(e) })} />
      <span class="ml-2 text-muted">Resaltado</span>
      <input type="color" class="h-7 w-10 cursor-pointer rounded border border-border bg-panel" value={data.highlightColor} oninput={(e) => set({ highlightColor: str(e) })} title="Color del karaoke" />
    </label>
    <label class="flex items-center gap-2">
      {@render row("Borde")}
      <input class="flex-1 accent-accent" type="range" min="0" max="0.15" step="0.005" value={data.stroke} oninput={(e) => set({ stroke: num(e) })} />
      <input type="color" class="h-7 w-10 cursor-pointer rounded border border-border bg-panel" value={data.strokeColor} oninput={(e) => set({ strokeColor: str(e) })} />
    </label>
    <div class="flex items-center gap-2">
      {@render row("Efectos")}
      <label class="flex items-center gap-1.5"><input type="checkbox" class="accent-accent" checked={data.shadow} onchange={(e) => set({ shadow: (e.currentTarget as HTMLInputElement).checked })} /> Sombra</label>
      <label class="flex items-center gap-1.5"><input type="checkbox" class="accent-accent" checked={data.box} onchange={(e) => set({ box: (e.currentTarget as HTMLInputElement).checked })} /> Caja</label>
      {#if data.box}
        <input type="color" class="h-7 w-10 cursor-pointer rounded border border-border bg-panel" value={data.boxColor} oninput={(e) => set({ boxColor: str(e) })} />
        <input class="w-16 accent-accent" type="range" min="0" max="1" step="0.05" value={data.boxOpacity} oninput={(e) => set({ boxOpacity: num(e) })} title="Opacidad de la caja" />
      {/if}
    </div>
  </div>

  <h3 class="mt-4 mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Posición</h3>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      {@render row("Rápida")}
      <div class="seg">
        {#each POSITIONS as pos (pos.label)}
          <button class="seg-btn" class:active={Math.abs(data.y - pos.y) < 0.01 && Math.abs(data.x - 0.5) < 0.01} onclick={() => set({ x: 0.5, y: pos.y })}>{pos.label}</button>
        {/each}
      </div>
    </div>
    <label class="flex items-center gap-2">
      {@render row("Horizontal")}
      <input class="flex-1 accent-accent" type="range" min="0" max="1" step="0.005" value={data.x} oninput={(e) => set({ x: num(e) })} />
    </label>
    <label class="flex items-center gap-2">
      {@render row("Vertical")}
      <input class="flex-1 accent-accent" type="range" min="0" max="1" step="0.005" value={data.y} oninput={(e) => set({ y: num(e) })} />
    </label>
    <label class="flex items-center gap-2">
      {@render row("Ancho máx.")}
      <input class="flex-1 accent-accent" type="range" min="0.2" max="1" step="0.01" value={data.maxWidth} oninput={(e) => set({ maxWidth: num(e) })} />
    </label>
  </div>
</div>
