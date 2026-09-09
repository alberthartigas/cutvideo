<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { FolderOpen, Plus } from "@lucide/svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import Preview from "$lib/components/Preview.svelte";
  import Timeline from "$lib/components/Timeline.svelte";
  import MediaInfoPanel from "$lib/components/MediaInfoPanel.svelte";
  import TextInspector from "$lib/components/TextInspector.svelte";
  import ExportDialog from "$lib/components/ExportDialog.svelte";
  import SettingsDialog from "$lib/components/SettingsDialog.svelte";
  import SubtitlesDialog from "$lib/components/SubtitlesDialog.svelte";
  import {
    ffmpegVersion,
    pickMediaFiles,
    probeMedia,
    startupFiles,
    type MediaInfo,
  } from "$lib/tauri/media";
  import { basename, formatDuration } from "$lib/format";
  import { project } from "$lib/project.svelte";
  import { anyDialogOpen, ui } from "$lib/ui.svelte";
  import { startDrag } from "$lib/drag";

  let timeline = $state<ReturnType<typeof Timeline>>();
  let selectedMedia = $state<MediaInfo | null>(null);
  let error = $state<string | null>(null);
  let importing = $state(false);
  /** Archivos externos (Finder / Explorador) sobre la ventana. */
  let dragging = $state(false);
  /** Etiqueta que sigue al cursor al arrastrar un archivo de la biblioteca al timeline. */
  let ghost = $state<{ x: number; y: number; name: string; over: boolean } | null>(null);
  let ffmpeg = $state<{ ok: boolean; text: string }>({ ok: false, text: "comprobando FFmpeg…" });

  // El inspector muestra el clip seleccionado en el timeline; si no hay, el archivo de la biblioteca.
  let inspectorClip = $derived(project.selected?.clip ?? null);
  let inspectorMedia = $derived(inspectorClip ? project.mediaOf(inspectorClip) : selectedMedia);

  async function importPaths(paths: string[]) {
    if (paths.length === 0) return;
    importing = true;
    error = null;
    for (const path of paths) {
      if (project.media.some((m) => m.path === path)) continue;
      try {
        const info = await probeMedia(path);
        project.addMedia(info);
        selectedMedia ??= info;
      } catch (e) {
        error = `${basename(path)}: ${String(e)}`;
      }
    }
    importing = false;
  }

  async function importFromDialog() {
    await importPaths(await pickMediaFiles());
  }

  /** Arrastrar un archivo de la biblioteca hasta el timeline lo añade en ese instante. */
  function onMediaPointerDown(e: PointerEvent, item: MediaInfo) {
    if (e.button !== 0) return;
    startDrag(e, {
      onMove(_dx, _dy, ev) {
        const over = timeline?.locate(ev.clientX, ev.clientY) !== null;
        ghost = { x: ev.clientX, y: ev.clientY, name: item.fileName, over };
      },
      onEnd(ev, moved) {
        ghost = null;
        if (!moved) return;
        const hit = timeline?.locate(ev.clientX, ev.clientY);
        if (hit) project.addClip(item, hit.time);
      },
    });
  }

  /** true si el evento de teclado debe ir a un campo de texto o a un diálogo, no a los atajos. */
  function keyHandledElsewhere(e: KeyboardEvent): boolean {
    if (anyDialogOpen()) return true;
    const target = e.target instanceof Element ? e.target : null;
    return !!target?.closest("input, textarea, select, [contenteditable]");
  }

  /**
   * Con un botón enfocado, el navegador convierte el keyup de espacio en un clic
   * (y desharía el play/pausa del keydown). Lo cancelamos: espacio es siempre nuestro.
   */
  function onKeyUp(e: KeyboardEvent) {
    if (isSpace(e) && !keyHandledElsewhere(e)) e.preventDefault();
  }

  // Algunos WebViews/automatizaciones envían `key` vacío: miramos también `code`.
  const isSpace = (e: KeyboardEvent) => e.key === " " || e.code === "Space";

  function onKeyDown(e: KeyboardEvent) {
    if (keyHandledElsewhere(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) project.redo();
      else project.undo();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      project.redo();
      return;
    }
    if (mod && key === "b") {
      e.preventDefault();
      project.splitAtPlayhead();
      return;
    }
    if (mod) return;

    if (isSpace(e)) {
      e.preventDefault();
      project.togglePlay();
      return;
    }
    switch (e.key) {
      case "s":
      case "S":
        project.splitAtPlayhead();
        break;
      case "t":
      case "T":
        project.addText();
        break;
      case "Backspace":
      case "Delete":
        project.deleteSelected();
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (e.shiftKey) project.nudge(-1);
        else project.stepFrames(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (e.shiftKey) project.nudge(1);
        else project.stepFrames(1);
        break;
      case "Home":
        project.playing = false;
        project.setPlayhead(0);
        break;
      case "End":
        project.playing = false;
        project.setPlayhead(project.duration);
        break;
      case "Escape":
        project.selectedId = null;
        break;
    }
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

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

<div class="flex h-screen flex-col bg-bg text-text">
  <TitleBar />

  <div class="grid min-h-0 flex-1 grid-cols-[260px_1fr_300px] gap-2 p-2">
    <!-- Biblioteca -->
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
        {#each project.media as item (item.path)}
          <li class="relative">
            <button
              class="media-item pr-9"
              class:active={selectedMedia?.path === item.path && !inspectorClip}
              onclick={() => {
                selectedMedia = item;
                project.selectedId = null;
              }}
              ondblclick={() => project.addClip(item)}
              onpointerdown={(e) => onMediaPointerDown(e, item)}
              title="Doble clic o arrastrar al timeline para añadirlo"
            >
              <span class="truncate text-sm">{item.fileName}</span>
              <span class="text-[11px] text-muted">
                {formatDuration(item.durationSec)}
                · {item.video ? `${item.video.width}×${item.video.height}` : "solo audio"}
              </span>
            </button>
            <button
              class="tool absolute top-1/2 right-1.5 h-6 w-6 -translate-y-1/2 justify-center px-0"
              title="Añadir al final del timeline"
              onclick={() => project.addClip(item)}
            >
              <Plus size={14} />
            </button>
          </li>
        {:else}
          <li class="px-3 py-8 text-center text-xs text-muted">Arrastra vídeos aquí o pulsa Importar</li>
        {/each}
      </ul>
    </aside>

    <!-- Preview -->
    <section class="panel">
      <Preview />
    </section>

    <!-- Inspector -->
    <aside class="panel">
      <div class="panel-header"><span>{inspectorClip?.kind === "text" ? "Texto" : "Inspector"}</span></div>
      {#if inspectorClip?.kind === "text"}
        <TextInspector clip={inspectorClip} />
      {:else}
        <MediaInfoPanel media={inspectorMedia} clip={inspectorClip} />
      {/if}
    </aside>
  </div>

  <div class="mx-2 mb-2 h-60 shrink-0">
    <Timeline bind:this={timeline} />
  </div>

  <footer class="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-panel px-3 text-[11px] text-muted">
    <span class="size-1.5 rounded-full {ffmpeg.ok ? 'bg-emerald-500' : 'bg-red-500'}"></span>
    <span>{ffmpeg.text}</span>
    <span class="ml-auto">
      {project.media.length} {project.media.length === 1 ? "archivo" : "archivos"}
      · {project.clipCount} {project.clipCount === 1 ? "clip" : "clips"}
      · {formatDuration(project.duration)}
    </span>
  </footer>

  {#if ghost}
    <div
      class="pointer-events-none fixed z-50 max-w-60 truncate rounded-md border bg-panel px-2 py-1 text-xs shadow-lg {ghost.over
        ? 'border-accent'
        : 'border-border opacity-70'}"
      style="left:{ghost.x + 12}px; top:{ghost.y + 12}px"
    >
      {ghost.name}
    </div>
  {/if}

  {#if dragging}
    <div
      class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-accent bg-accent/10 text-lg font-medium text-accent"
    >
      Suelta para importar
    </div>
  {/if}

  {#if ui.settingsOpen}
    <SettingsDialog />
  {/if}
  {#if ui.exportOpen}
    <ExportDialog />
  {/if}
  {#if ui.subtitlesOpen}
    <SubtitlesDialog />
  {/if}
</div>
