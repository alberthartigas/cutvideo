<script lang="ts">
  import { onMount } from "svelte";
  import { LoaderCircle } from "@lucide/svelte";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import Preview from "$lib/components/Preview.svelte";
  import Timeline from "$lib/components/Timeline.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import StartScreen from "$lib/components/StartScreen.svelte";
  import MediaInfoPanel from "$lib/components/MediaInfoPanel.svelte";
  import TextInspector from "$lib/components/TextInspector.svelte";
  import TransitionPanel from "$lib/components/TransitionPanel.svelte";
  import LayerInspector from "$lib/components/LayerInspector.svelte";
  import ExportDialog from "$lib/components/ExportDialog.svelte";
  import SettingsDialog from "$lib/components/SettingsDialog.svelte";
  import AboutDialog from "$lib/components/AboutDialog.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import SubtitlesDialog from "$lib/components/SubtitlesDialog.svelte";
  import MediaPanel from "$lib/components/panels/MediaPanel.svelte";
  import AudioPanel from "$lib/components/panels/AudioPanel.svelte";
  import TextPanel from "$lib/components/panels/TextPanel.svelte";
  import SubtitlesPanel from "$lib/components/panels/SubtitlesPanel.svelte";
  import PatchesPanel from "$lib/components/panels/PatchesPanel.svelte";
  import EffectsPanel from "$lib/components/panels/EffectsPanel.svelte";
  import TransitionsPanel from "$lib/components/panels/TransitionsPanel.svelte";
  import AutoEditPanel from "$lib/components/panels/AutoEditPanel.svelte";
  import { ffmpegVersion, pickMediaFiles, probeMedia, startupFiles, type MediaInfo } from "$lib/tauri/media";
  import { basename, formatDuration } from "$lib/format";
  import { project } from "$lib/project.svelte";
  import { anyDialogOpen, ui } from "$lib/ui.svelte";
  import { refreshSamples } from "$lib/preview/samples.svelte";
  import { layout } from "$lib/layout.svelte";
  import { session } from "$lib/session.svelte";
  import Splitter from "$lib/components/Splitter.svelte";
  import { startDrag } from "$lib/drag";
  import { drop } from "$lib/media-drop.svelte";
  import { isOverlayTrack } from "$lib/layers";
  import { proxies } from "$lib/proxies.svelte";

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
  // Transición: solo tiene sentido en un clip de la pista principal que tenga otro detrás.
  let transitionNext = $derived(
    inspectorClip && project.selected?.track.magnetic ? project.nextClip(inspectorClip) : null,
  );
  // Las capas superpuestas se colocan (tamaño, posición) y pueden recortarse.
  let esCapa = $derived(isOverlayTrack(project.selected?.track.id ?? ""));

  // Las miniaturas de transiciones y efectos usan frames reales del proyecto.
  $effect(() => {
    void project.videoTrack.clips.length;
    refreshSamples();
  });

  // Guardado automático: cualquier cambio en la biblioteca o el timeline lo programa.
  $effect(() => {
    void project.media.length;
    void project.tracks.map((t) => t.clips.length).join();
    void project.clipCount;
    void project.duration;
    void project.aspect;
    void project.fit;
    session.touch();
  });

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
        const hit = timeline?.locate(ev.clientX, ev.clientY) ?? null;
        drop.target = hit;
        ghost = { x: ev.clientX, y: ev.clientY, name: item.fileName, over: hit !== null };
      },
      onEnd(ev, moved) {
        ghost = null;
        drop.target = null;
        if (!moved) return;
        const hit = timeline?.locate(ev.clientX, ev.clientY);
        if (hit) soltarMedio(item, hit);
      },
    });
  }

  /**
   * Coloca el medio en la pista sobre la que se soltó. Antes iba siempre a la
   * pista principal, así que soltar sobre el fondo o sobre una capa no hacía
   * lo que uno espera al arrastrar algo hasta ahí.
   */
  function soltarMedio(item: MediaInfo, hit: { trackId: string; time: number }) {
    if (hit.trackId === "f1") project.addBackground(item, hit.time);
    else if (isOverlayTrack(hit.trackId)) project.addOverlay(item, hit.time, hit.trackId);
    else if (hit.trackId === "p1") project.addPatch(item, hit.time);
    else project.addClip(item, hit.time);
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
    // ⌘A selecciona todos los clips, para borrarlos o moverlos de golpe.
    if (mod && e.key.toLowerCase() === "a" && !keyHandledElsewhere(e)) {
      e.preventDefault();
      project.selectAll();
      return;
    }
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

  // Las copias de edición se preparan por detrás siempre que cambie la lista
  // de medios: al importar, pero también al abrir un proyecto guardado, que es
  // donde antes se quedaban sin hacer y el preview seguía yendo a trompicones.
  $effect(() => void proxies.prepare(project.media));

  /**
   * El menú nativo del WebView solo trae "Recargar" y despista; se corta en
   * todo el editor salvo en los campos de texto, donde copiar y pegar sí hace
   * falta. Los clips y los medios abren el suyo propio.
   */
  function bloquearMenuNativo(e: MouseEvent) {
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
  }

  onMount(() => {
    ffmpegVersion()
      .then((v) => (ffmpeg = { ok: true, text: `FFmpeg ${v}` }))
      .catch((e) => (ffmpeg = { ok: false, text: `FFmpeg no disponible: ${e}` }));

    // Archivos abiertos desde la línea de comandos / "Abrir con": crean un proyecto.
    startupFiles()
      .then((paths) => {
        if (paths.length === 0) return;
        if (!session.open) session.create();
        return importPaths(paths);
      })
      .catch(() => {});

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

{#if !session.open}
  <StartScreen />
{:else}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-screen flex-col bg-bg text-text" oncontextmenu={bloquearMenuNativo}>
  <TitleBar />

  <div class="flex min-h-0 flex-1">
    <Sidebar />

    <!-- Los anchos salen de `layout` y se ajustan con los divisores. -->
    <div class="flex min-h-0 flex-1 py-2 pl-2">
      <!-- Sección elegida en la barra lateral -->
      <div class="min-h-0 shrink-0" style="width:{layout.panelWidth}px">
        {#if ui.panel === "media"}
          <MediaPanel
            {importing}
            {error}
            onImport={importFromDialog}
            onDragToTimeline={onMediaPointerDown}
            bind:selected={selectedMedia}
          />
        {:else if ui.panel === "audio"}
          <AudioPanel />
        {:else if ui.panel === "text"}
          <TextPanel />
        {:else if ui.panel === "subtitles"}
          <SubtitlesPanel />
        {:else if ui.panel === "patches"}
          <PatchesPanel />
        {:else if ui.panel === "effects"}
          <EffectsPanel />
        {:else if ui.panel === "transitions"}
          <TransitionsPanel />
        {:else}
          <AutoEditPanel />
        {/if}
      </div>

      <Splitter key="panelWidth" label="Ancho del panel" />

      <!-- Preview -->
      <section class="panel min-w-0 flex-1">
        <Preview />
      </section>

      <Splitter key="inspectorWidth" label="Ancho del inspector" invert />

      <!-- Inspector -->
      <aside class="panel mr-2 shrink-0" style="width:{layout.inspectorWidth}px">
        <div class="panel-header"><span>{inspectorClip?.kind === "text" ? "Texto" : "Inspector"}</span></div>
        {#if inspectorClip?.kind === "text"}
          <TextInspector clip={inspectorClip} />
        {:else}
          {#if inspectorClip && esCapa}
            <LayerInspector clip={inspectorClip} />
          {/if}
          {#if inspectorClip && transitionNext}
            <TransitionPanel clip={inspectorClip} next={transitionNext} />
          {/if}
          <MediaInfoPanel media={inspectorMedia} clip={inspectorClip} />
        {/if}
      </aside>
    </div>
  </div>

  <Splitter key="timelineHeight" label="Altura del timeline" axis="y" invert />

  <div class="mx-2 mb-2 shrink-0" style="height:{layout.timelineHeight}px">
    <Timeline bind:this={timeline} />
  </div>

  <footer class="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-panel px-3 text-[11px] text-muted">
    <span class="size-1.5 rounded-full {ffmpeg.ok ? 'bg-emerald-500' : 'bg-red-500'}"></span>
    <span>{ffmpeg.text}</span>
    {#if proxies.pendientes > 0}
      <span class="flex items-center gap-1.5 text-accent" title="Copias ligeras para que el preview vaya fluido. Mientras tanto se edita con los originales.">
        <LoaderCircle size={11} class="animate-spin" />
        Preparando {proxies.pendientes} {proxies.pendientes === 1 ? "copia" : "copias"} de edición…
      </span>
    {/if}
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
{/if}

<!-- Fuera del editor: también se abre desde la pantalla de inicio. -->
{#if ui.aboutOpen}
  <AboutDialog />
{/if}
<ContextMenu />
