<script lang="ts">
  import { CircleCheck, Download, FolderOpen, LoaderCircle, TriangleAlert, X } from "@lucide/svelte";
  import { ui } from "$lib/ui.svelte";
  import { project } from "$lib/project.svelte";
  import {
    buildExportPlan,
    cutoutClips,
    overlayLayerClips,
    cancelExport,
    endTextOverlays,
    exportVideo,
    onExportProgress,
    originalSize,
    pickOutputPath,
    renderOverlayAssets,
    revealInFolder,
    RESOLUTIONS,
    targetSize,
    type ExportEncoder,
    type ExportResult,
  } from "$lib/tauri/export";
  import { basename, formatDuration } from "$lib/format";

  type Phase =
    | { kind: "idle" }
    | { kind: "running"; stage: "mask" | "text" | "ffmpeg"; percent: number; speed: number | null; startedAt: number }
    | { kind: "done"; result: ExportResult }
    | { kind: "error"; message: string };

  const ETAPAS = {
    mask: "Recortando personas…",
    text: "Renderizando textos…",
    ffmpeg: "Codificando…",
  } as const;

  let capas = $derived(overlayLayerClips().length);
  let recortes = $derived(cutoutClips().length);

  let phase = $state<Phase>({ kind: "idle" });
  let shortSide = $state<number | null>(null);
  let encoder = $state<ExportEncoder>("auto");
  let cancelled = false;

  let orig = $derived(originalSize());
  let origShort = $derived(orig ? Math.min(orig.width, orig.height) : 0);
  let size = $derived(orig ? targetSize(orig, shortSide) : null);
  /** Subir de resolución no inventa detalle: conviene decirlo. */
  let escalando = $derived(!!shortSide && shortSide > origShort);
  let running = $derived(phase.kind === "running");
  let textCount = $derived(project.textClips.length);

  let remaining = $derived.by(() => {
    if (phase.kind !== "running" || phase.stage !== "ffmpeg" || phase.percent < 2) return null;
    const elapsed = (Date.now() - phase.startedAt) / 1000;
    return (elapsed / phase.percent) * (100 - phase.percent);
  });

  async function start() {
    if (!size) return;
    const target = size;
    const output = await pickOutputPath("CutVideo.mp4");
    if (!output) return;
    cancelled = false;
    phase = { kind: "running", stage: cutoutClips().length ? "mask" : "text", percent: 0, speed: null, startedAt: Date.now() };
    let unlisten: (() => void) | null = null;
    try {
      const assets = await renderOverlayAssets(
        target,
        (stage, f) => {
          if (phase.kind === "running") phase = { ...phase, stage, percent: f * 100 };
        },
        () => cancelled,
      );
      phase = { kind: "running", stage: "ffmpeg", percent: 0, speed: null, startedAt: Date.now() };
      unlisten = await onExportProgress((p) => {
        if (phase.kind === "running") phase = { ...phase, stage: "ffmpeg", percent: p.percent, speed: p.speed };
      });
      const result = await exportVideo(buildExportPlan(output, target, encoder, assets));
      phase = { kind: "done", result };
    } catch (e) {
      phase = cancelled ? { kind: "idle" } : { kind: "error", message: String(e) };
    } finally {
      unlisten?.();
      endTextOverlays().catch(() => {});
    }
  }

  function cancel() {
    cancelled = true;
    if (phase.kind === "running" && phase.stage === "ffmpeg") cancelExport();
  }

  function close() {
    if (running) return;
    ui.exportOpen = false;
    phase = { kind: "idle" };
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/50" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div class="panel w-[440px] max-w-[92vw] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <div class="panel-header">
      <span id="export-title" class="flex items-center gap-2"><Download size={13} /> Exportar MP4</span>
      <button class="tool h-6 w-6 justify-center px-0" title="Cerrar" onclick={close} disabled={running}><X size={14} /></button>
    </div>

    <div class="flex flex-col gap-4 p-4 text-sm">
      {#if phase.kind === "idle"}
        {#if !orig || !size}
          <p class="text-muted">Añade al menos un clip de vídeo al timeline para exportar.</p>
        {:else}
          <label class="flex items-center justify-between gap-3">
            <span>Resolución</span>
            <select bind:value={shortSide} class="field w-56">
              <option value={null}>Original · {orig.width}×{orig.height}</option>
              {#each RESOLUTIONS as r (r.shortSide)}
                {@const s = targetSize(orig, r.shortSide)}
                <option value={r.shortSide}>
                  {r.label} · {s.width}×{s.height}{r.shortSide > origShort ? " ↑" : ""}
                </option>
              {/each}
            </select>
          </label>
          {#if escalando}
            <p class="-mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
              Tu vídeo es de {orig.width}×{orig.height}: al subirlo a {size?.width}×{size?.height} el archivo pesará
              más pero no se verá con más detalle del que ya tiene.
            </p>
          {/if}
          <label class="flex items-center justify-between gap-3">
            <span>Codificador</span>
            <select bind:value={encoder} class="field w-48">
              <option value="auto">Automático (hardware)</option>
              <option value="x264">x264 (software, más lento)</option>
            </select>
          </label>
          <p class="text-xs text-muted">
            {size.width}×{size.height} · {Math.round(size.fps * 100) / 100} fps · H.264 + AAC ·
            {formatDuration(project.duration)} · {project.videoTrack.clips.length}
            {project.videoTrack.clips.length === 1 ? "clip" : "clips"}{capas
              ? ` · ${capas} ${capas === 1 ? "capa" : "capas"}`
              : ""}{recortes ? ` (${recortes} con recorte)` : ""}{textCount
              ? ` · ${textCount} ${textCount === 1 ? "texto" : "textos"}`
              : ""}
          </p>
          <div class="flex justify-end gap-2">
            <button class="btn" onclick={close}>Cancelar</button>
            <button class="btn-accent" onclick={start}><Download size={13} /> Exportar…</button>
          </div>
        {/if}
      {:else if phase.kind === "running"}
        <div class="flex items-center gap-2">
          <LoaderCircle size={16} class="animate-spin text-accent" />
          <span>{ETAPAS[phase.stage]} {phase.percent.toFixed(0)}%</span>
          <span class="ml-auto text-xs text-muted">
            {#if phase.speed}{phase.speed.toFixed(1)}× ·{/if}
            {#if remaining !== null}quedan {formatDuration(remaining).slice(0, -3)}{/if}
          </span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-panel-2">
          <div class="h-full bg-accent transition-[width] duration-200" style="width:{phase.percent}%"></div>
        </div>
        <div class="flex justify-end">
          <button class="btn" onclick={cancel}>Cancelar exportación</button>
        </div>
      {:else if phase.kind === "done"}
        <div class="flex items-start gap-2">
          <CircleCheck size={18} class="shrink-0 text-emerald-500" />
          <div class="min-w-0">
            <p class="font-medium">Exportado en {formatDuration(phase.result.seconds).slice(0, -3)}</p>
            <p class="truncate text-xs text-muted" title={phase.result.output}>{basename(phase.result.output)} · {phase.result.encoder}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn" onclick={() => revealInFolder(phase.kind === "done" ? phase.result.output : "")}>
            <FolderOpen size={13} /> Mostrar en carpeta
          </button>
          <button class="btn-accent" onclick={close}>Listo</button>
        </div>
      {:else}
        <div class="flex items-start gap-2">
          <TriangleAlert size={18} class="shrink-0 text-red-500" />
          <div class="min-w-0">
            <p class="font-medium">No se pudo exportar</p>
            <pre class="mt-1 max-h-40 overflow-auto rounded-md bg-panel-2 p-2 text-[11px] whitespace-pre-wrap text-muted">{phase.message}</pre>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn" onclick={() => (phase = { kind: "idle" })}>Volver</button>
          <button class="btn-accent" onclick={close}>Cerrar</button>
        </div>
      {/if}
    </div>
  </div>
</div>
