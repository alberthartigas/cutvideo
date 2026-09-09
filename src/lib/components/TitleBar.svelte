<script lang="ts">
  import { Download, Monitor, Moon, Settings, Sun } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import { THEME_MODES, theme } from "$lib/theme.svelte";
  import { project } from "$lib/project.svelte";
  import { ui } from "$lib/ui.svelte";

  const icons = { system: Monitor, light: Sun, dark: Moon } as const;
  // En macOS los semáforos de la ventana se superponen a la esquina superior izquierda.
  const isMac = navigator.userAgent.includes("Mac");
  let canExport = $derived(project.videoTrack.clips.length > 0);
</script>

<header
  data-tauri-drag-region
  class="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-panel pr-3 {isMac ? 'pl-20' : 'pl-4'}"
>
  <!-- pointer-events-none: el mousedown cae en el div con drag-region y la ventana se puede arrastrar -->
  <div data-tauri-drag-region class="flex items-center gap-2">
    <Logo class="pointer-events-none h-[18px]" />
    <span class="pointer-events-none text-[11px] text-muted">0.1</span>
  </div>

  <div class="seg ml-auto" role="radiogroup" aria-label="Tema">
    {#each THEME_MODES as m (m.value)}
      {@const Icon = icons[m.value]}
      <button
        type="button"
        role="radio"
        aria-checked={theme.mode === m.value}
        class="seg-btn flex items-center gap-1"
        class:active={theme.mode === m.value}
        title={m.label}
        onclick={() => theme.set(m.value)}
      >
        <Icon size={13} />
        <span>{m.label}</span>
      </button>
    {/each}
  </div>

  <button class="tool" title="Ajustes" onclick={() => (ui.settingsOpen = true)}>
    <Settings size={15} />
  </button>
  <button class="btn-accent" title="Exportar a MP4" disabled={!canExport} onclick={() => (ui.exportOpen = true)}>
    <Download size={13} />
    Exportar
  </button>
</header>
