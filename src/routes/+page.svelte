<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { FolderOpen } from "@lucide/svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import Preview from "$lib/components/Preview.svelte";
  import MediaInfoPanel from "$lib/components/MediaInfoPanel.svelte";
  import {
    ffmpegVersion,
    pickMediaFiles,
    probeMedia,
    startupFiles,
    type MediaInfo,
  } from "$lib/tauri/media";
  import { basename, formatDuration } from "$lib/format";

  let library = $state<MediaInfo[]>([]);
  let selected = $state<MediaInfo | null>(null);
  let error = $state<string | null>(null);
  let importing = $state(false);
  let dragging = $state(false);
  let ffmpeg = $state<{ ok: boolean; text: string }>({ ok: false, text: "comprobando FFmpeg…" });

  async function importPaths(paths: string[]) {
    if (paths.length === 0) return;
    importing = true;
    error = null;
    for (const path of paths) {
      if (library.some((m) => m.path === path)) continue;
      try {
        const info = await probeMedia(path);
        library.push(info);
        selected ??= info;
      } catch (e) {
        error = `${basename(path)}: ${String(e)}`;
      }
    }
    importing = false;
  }

  async function importFromDialog() {
    await importPaths(await pickMediaFiles());
  }

  onMount(() => {
    ffmpegVersion()
      .then((v) => (ffmpeg = { ok: true, text: `FFmpeg ${v}` }))
      .catch((e) => (ffmpeg = { ok: false, text: `FFmpeg no disponible: ${e}` }));

    // Archivos abiertos desde la línea de comandos / "Abrir con".
    startupFiles().then(importPaths).catch(() => {});

    // Arrastrar archivos desde Finder / Explorador sobre la ventana.
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") dragging = true;
        else if (p.type === "leave") dragging = false;
        else if (p.type === "drop") {
          dragging = false;
          importPaths(p.paths);
        }
      })
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  });
</script>

<div class="flex h-screen flex-col bg-bg text-text">
  <TitleBar />

  <div class="grid min-h-0 flex-1 grid-cols-[260px_1fr_300px] gap-2 p-2">
    <!-- Medios -->
    <aside class="panel">
      <div class="panel-header">
        <span>Medios</span>
        <button class="btn-accent" onclick={importFromDialog} disabled={importing}>
          <FolderOpen size={13} />
          {importing ? "Importando…" : "Importar"}
        </button>
      </div>
      {#if error}
        <p class="border-b border-border bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>
      {/if}
      <ul class="flex-1 space-y-1 overflow-auto p-2">
        {#each library as item (item.path)}
          <li>
            <button
              class="media-item"
              class:active={selected?.path === item.path}
              onclick={() => (selected = item)}
            >
              <span class="truncate text-sm">{item.fileName}</span>
              <span class="text-[11px] text-muted">
                {formatDuration(item.durationSec)}
                · {item.video ? `${item.video.width}×${item.video.height}` : "solo audio"}
              </span>
            </button>
          </li>
        {:else}
          <li class="px-3 py-8 text-center text-xs text-muted">
            Arrastra vídeos aquí o pulsa Importar
          </li>
        {/each}
      </ul>
    </aside>

    <!-- Preview -->
    <section class="panel">
      <Preview media={selected} />
    </section>

    <!-- Inspector -->
    <aside class="panel">
      <div class="panel-header"><span>Inspector</span></div>
      <MediaInfoPanel media={selected} />
    </aside>
  </div>

  <!-- Timeline (placeholder: se construye en el siguiente paso) -->
  <section class="panel mx-2 mb-2 h-52 shrink-0">
    <div class="panel-header">
      <span>Timeline</span>
      <span class="font-normal normal-case tracking-normal">Próximo paso</span>
    </div>
    <div class="grid min-h-0 flex-1 grid-rows-[24px_1fr_1fr]">
      <div class="ruler"></div>
      <div class="track"><span class="track-label">V1</span></div>
      <div class="track"><span class="track-label">A1</span></div>
    </div>
  </section>

  <footer class="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-panel px-3 text-[11px] text-muted">
    <span class="size-1.5 rounded-full {ffmpeg.ok ? 'bg-emerald-500' : 'bg-red-500'}"></span>
    <span>{ffmpeg.text}</span>
    <span class="ml-auto">{library.length} {library.length === 1 ? "archivo" : "archivos"}</span>
  </footer>

  {#if dragging}
    <div
      class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-accent bg-accent/10 text-lg font-medium text-accent"
    >
      Suelta para importar
    </div>
  {/if}
</div>
