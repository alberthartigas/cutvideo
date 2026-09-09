<script lang="ts">
  import { Check, Plus, X } from "@lucide/svelte";
  import { ASPECTS, type AspectId } from "$lib/aspect";

  /** Plataformas típicas; cada una fija la proporción que le toca. */
  const PLATFORMS: { id: string; label: string; hint: string; aspect: AspectId }[] = [
    { id: "vertical", label: "TikTok · Reels · Shorts", hint: "Vertical 9:16", aspect: "9:16" },
    { id: "youtube", label: "YouTube", hint: "Apaisado 16:9", aspect: "16:9" },
    { id: "feed", label: "Publicación cuadrada", hint: "Instagram, Facebook 1:1", aspect: "1:1" },
    { id: "clasico", label: "Clásico", hint: "Presentaciones, 4:3", aspect: "4:3" },
    { id: "original", label: "Como el vídeo", hint: "Sin recortar nada", aspect: "original" },
  ];

  let { oncreate, oncancel }: { oncreate: (name: string, aspect: AspectId) => void; oncancel: () => void } =
    $props();

  let name = $state("");
  let platform = $state("vertical");
  let input = $state<HTMLInputElement>();

  let aspect = $derived(PLATFORMS.find((p) => p.id === platform)?.aspect ?? "9:16");
  let ratio = $derived(ASPECTS.find((a) => a.id === aspect)?.ratio ?? 16 / 9);

  $effect(() => {
    input?.focus();
    input?.select();
  });

  function create() {
    oncreate(name.trim() || "Proyecto sin título", aspect);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") oncancel();
    if (e.key === "Enter") create();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
  role="presentation"
  onpointerdown={(e) => e.target === e.currentTarget && oncancel()}
>
  <div class="panel w-[440px] max-w-[92vw] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="np-title">
    <div class="panel-header">
      <span id="np-title">Proyecto nuevo</span>
      <button class="tool h-6 w-6 justify-center px-0" title="Cancelar" onclick={oncancel}><X size={14} /></button>
    </div>

    <div class="flex flex-col gap-4 p-4 text-sm">
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">Nombre</span>
        <input
          bind:this={input}
          bind:value={name}
          class="field h-9"
          placeholder="Proyecto sin título"
          spellcheck="false"
        />
      </label>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted">¿Para dónde es?</span>
        <div class="flex flex-col gap-1">
          {#each PLATFORMS as p (p.id)}
            <button class="opt" class:active={platform === p.id} onclick={() => (platform = p.id)}>
              <span class="box" style="aspect-ratio:{ASPECTS.find((a) => a.id === p.aspect)?.ratio ?? 16 / 9}"></span>
              <span class="flex-1 text-left">{p.label}</span>
              <span class="text-[11px] text-muted">{p.hint}</span>
              {#if platform === p.id}<Check size={14} class="text-accent" />{/if}
            </button>
          {/each}
        </div>
      </div>

      <div class="flex items-center gap-3 rounded-lg bg-panel-2 p-3">
        <span class="preview" style="aspect-ratio:{ratio}"></span>
        <p class="text-[11px] text-muted">
          Puedes cambiar la proporción cuando quieras desde la barra de arriba; el vídeo no se toca.
        </p>
      </div>

      <div class="flex justify-end gap-2">
        <button class="btn" onclick={oncancel}>Cancelar</button>
        <button class="btn-accent" onclick={create}><Plus size={14} /> Crear</button>
      </div>
    </div>
  </div>
</div>

<style>
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
  }
  .opt:hover {
    border-color: var(--muted);
  }
  .opt.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .box {
    width: 22px;
    flex-shrink: 0;
    border: 1.5px solid var(--muted);
    border-radius: 3px;
  }
  .preview {
    height: 52px;
    flex-shrink: 0;
    border-radius: 4px;
    background: #000;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--muted) 45%, transparent);
  }
</style>
