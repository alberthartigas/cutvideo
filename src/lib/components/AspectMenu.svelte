<script lang="ts">
  import { Check, Ratio } from "@lucide/svelte";
  import { project } from "$lib/project.svelte";
  import { ASPECTS, FITS } from "$lib/aspect";

  let open = $state(false);
  let root = $state<HTMLDivElement>();

  let current = $derived(ASPECTS.find((a) => a.id === project.aspect) ?? ASPECTS[0]);

  /** Se cierra al hacer clic fuera o con Escape. */
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="relative" bind:this={root}>
  <button
    class="seg-btn flex h-6 items-center gap-1 rounded-lg border border-border bg-panel-2 px-2"
    class:text-accent={project.aspect !== "original"}
    title="Proporción del vídeo"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <Ratio size={13} />
    <span>{current.label}</span>
  </button>

  {#if open}
    <div class="menu" role="menu">
      <p class="head">Proporción</p>
      {#each ASPECTS as a (a.id)}
        <button
          class="item"
          role="menuitemradio"
          aria-checked={project.aspect === a.id}
          onclick={() => { project.aspect = a.id; open = false; }}
        >
          <span class="box" style="aspect-ratio:{a.ratio ?? 16 / 9}"></span>
          <span class="flex-1 text-left">{a.label}</span>
          <span class="hint">{a.hint}</span>
          {#if project.aspect === a.id}<Check size={13} class="text-accent" />{/if}
        </button>
      {/each}

      {#if project.aspect !== "original"}
        <p class="head mt-1 border-t border-border pt-2">Si el vídeo no encaja</p>
        {#each FITS as f (f.id)}
          <button
            class="item"
            role="menuitemradio"
            aria-checked={project.fit === f.id}
            onclick={() => { project.fit = f.id; open = false; }}
          >
            <span class="flex-1 text-left">{f.label}</span>
            <span class="hint">{f.hint}</span>
            {#if project.fit === f.id}<Check size={13} class="text-accent" />{/if}
          </button>
        {/each}
      {/if}

      <p class="px-2.5 pt-1.5 pb-1 text-[10px] text-muted">
        Salida: {project.frame.width}×{project.frame.height}
      </p>
    </div>
  {/if}
</div>

<style>
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 50;
    width: 264px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    padding: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  }
  .head {
    padding: 2px 8px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--muted);
    text-transform: uppercase;
  }
  .item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .item:hover {
    background: var(--panel-2);
  }
  .box {
    width: 18px;
    flex-shrink: 0;
    border: 1.5px solid var(--muted);
    border-radius: 2px;
  }
  .hint {
    font-size: 10px;
    color: var(--muted);
  }
</style>
