<script lang="ts">
  import type { Snippet } from "svelte";

  /** Marco común de los paneles de la barra lateral: título, acción y contenido con scroll. */
  let {
    title,
    hint,
    action,
    children,
  }: { title: string; hint?: string; action?: Snippet; children: Snippet } = $props();
</script>

<div class="panel h-full">
  <div class="panel-header">
    <span>{title}</span>
    {#if action}{@render action()}{/if}
  </div>
  {#if hint}
    <p class="shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-muted">{hint}</p>
  {/if}
  <div class="flex-1 overflow-y-auto overflow-x-hidden p-2">
    {@render children()}
  </div>
</div>
