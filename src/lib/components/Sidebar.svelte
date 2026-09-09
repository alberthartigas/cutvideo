<script lang="ts">
  import { Captions, Library, Music, Sparkles, SquareSplitHorizontal, Sticker, Type, WandSparkles } from "@lucide/svelte";
  import { ui, type PanelId } from "$lib/ui.svelte";

  const SECTIONS: { id: PanelId; label: string; icon: typeof Library }[] = [
    { id: "media", label: "Medios", icon: Library },
    { id: "audio", label: "Audio", icon: Music },
    { id: "text", label: "Texto", icon: Type },
    { id: "subtitles", label: "Subtítulos", icon: Captions },
    { id: "patches", label: "Parches", icon: Sticker },
    { id: "effects", label: "Efectos", icon: Sparkles },
    { id: "transitions", label: "Transiciones", icon: SquareSplitHorizontal },
    { id: "autoedit", label: "Autoedición", icon: WandSparkles },
  ];
</script>

<nav class="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2" aria-label="Secciones">
  {#each SECTIONS as s (s.id)}
    {@const Icon = s.icon}
    <button
      class="sec"
      class:active={ui.panel === s.id}
      class:ai={s.id === "autoedit"}
      aria-current={ui.panel === s.id}
      title={s.label}
      onclick={() => (ui.panel = s.id)}
    >
      <Icon size={18} />
      <span>{s.label}</span>
    </button>
  {/each}
</nav>

<style>
  .sec {
    display: flex;
    width: 52px;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    border-radius: 8px;
    padding: 6px 2px;
    font-size: 9px;
    line-height: 1.1;
    color: var(--muted);
    transition:
      background 120ms,
      color 120ms;
  }
  .sec span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sec:hover {
    background: var(--panel-2);
    color: var(--text);
  }
  .sec.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }
  .sec.ai:not(.active) {
    color: color-mix(in srgb, var(--accent) 75%, var(--muted));
  }
</style>
