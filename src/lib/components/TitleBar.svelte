<script lang="ts">
  import { ChevronLeft, Download, Monitor, Moon, Settings, Sun } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import AspectMenu from "./AspectMenu.svelte";
  import { THEME_MODES, theme } from "$lib/theme.svelte";
  import { project } from "$lib/project.svelte";
  import { ui } from "$lib/ui.svelte";
  import { session } from "$lib/session.svelte";

  const icons = { system: Monitor, light: Sun, dark: Moon } as const;
  // En macOS los semáforos de la ventana se superponen a la esquina superior izquierda.
  const isMac = navigator.userAgent.includes("Mac");
  let canExport = $derived(project.videoTrack.clips.length > 0);
  let estado = $derived(session.saving ? "Guardando…" : session.error ? "Sin guardar" : "Guardado");
</script>

<header
  data-tauri-drag-region
  class="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-panel pr-3 {isMac ? 'pl-20' : 'pl-4'}"
>
  <button class="tool h-7 shrink-0" title="Volver a mis proyectos" onclick={() => session.close()}>
    <ChevronLeft size={15} />
    <Logo class="pointer-events-none h-[15px]" />
  </button>

  <!-- pointer-events-none: el mousedown cae en el header con drag-region y la ventana se puede arrastrar -->
  <div data-tauri-drag-region class="flex min-w-0 flex-1 items-center gap-2">
    <input
      class="min-w-0 max-w-64 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium hover:border-border focus:border-accent focus:outline-none"
      value={session.name}
      title="Nombre del proyecto"
      onchange={(e) => session.rename(e.currentTarget.value)}
    />
    <span
      class="pointer-events-none shrink-0 text-[11px] {session.error ? 'text-red-500' : 'text-muted'}"
      title={session.error ?? ""}>{estado}</span
    >
  </div>

  <AspectMenu />

  <div class="seg shrink-0" role="radiogroup" aria-label="Tema">
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
