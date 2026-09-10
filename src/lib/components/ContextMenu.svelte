<script lang="ts">
  import { closeMenu, contextMenu } from "$lib/context-menu.svelte";

  let el = $state<HTMLDivElement>();

  // Que no se salga de la ventana: si se abre cerca del borde, se recoloca.
  let pos = $derived.by(() => {
    const m = contextMenu.current;
    if (!m) return { x: 0, y: 0 };
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 160;
    return {
      x: Math.min(m.x, window.innerWidth - w - 8),
      y: Math.min(m.y, window.innerHeight - h - 8),
    };
  });

  function fuera(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) closeMenu();
  }
  function tecla(e: KeyboardEvent) {
    if (e.key === "Escape") closeMenu();
  }
</script>

<svelte:window onpointerdown={fuera} onkeydown={tecla} onblur={closeMenu} onresize={closeMenu} />

{#if contextMenu.current}
  <div
    bind:this={el}
    class="menu fixed z-[60] min-w-44 rounded-lg border border-border bg-panel p-1 text-xs shadow-2xl"
    style="left:{pos.x}px; top:{pos.y}px"
    role="menu"
  >
    {#each contextMenu.current.items as item (item.label)}
      {@const Icon = item.icon}
      <button
        class="item"
        class:danger={item.danger}
        disabled={item.disabled}
        role="menuitem"
        onclick={() => {
          closeMenu();
          item.run();
        }}
      >
        {#if Icon}<Icon size={13} />{/if}
        <span class="flex-1 text-left">{item.label}</span>
        {#if item.shortcut}<span class="ml-4 text-[10px] text-muted">{item.shortcut}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    border-radius: 6px;
    padding: 6px 8px;
    color: var(--text);
  }
  .item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .item:disabled {
    opacity: 0.4;
  }
  .item.danger {
    color: #ef4444;
  }
</style>
