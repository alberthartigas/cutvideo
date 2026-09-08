<script lang="ts">
  import { CircleCheck, Download, FolderOpen, LoaderCircle, TriangleAlert, X } from "@lucide/svelte";
  import { ui } from "$lib/ui.svelte";
  import { project } from "$lib/project.svelte";
  import {
    buildExportPlan,
    cancelExport,
    exportVideo,
    onExportProgress,
    originalSize,
    pickOutputPath,
    revealInFolder,
    targetSize,
    type ExportEncoder,
    type ExportProgress,
    type ExportResult,
  } from "$lib/tauri/export";
  import { basename, formatDuration } from "$lib/format";

  type Phase =
    | { kind: "idle" }
    | { kind: "running"; progress: ExportProgress; startedAt: number }
    | { kind: "done"; result: ExportResult }
    | { kind: "error"; message: string };

  let phase = $state<Phase>({ kind: "idle" });
  let shortSide = $state<number | null>(null);
  let encoder = $state<ExportEncoder>("auto");

  const PRESETS = [2160, 1440, 1080, 720, 480];
  let orig = $derived(originalSize());
  let presets = $derived(orig ? PRESETS.filter((p) => p < Math.min(orig.width, orig.height)) : []);
  let size = $derived(orig ? targetSize(orig, shortSide) : null);
  let running = $derived(phase.kind === "running");

  let remaining = $derived.by(() => {
    if (phase.kind !== "running" || phase.progress.percent < 2) return null;
    const elapsed = (Date.now() - phase.startedAt) / 1000;
    return (elapsed / phase.progress.percent) * (100 - phase.progress.percent);
  });

  async function start() {
    if (!size) return;
    const output = await pickOutputPath("QuickCut.mp4");
    if (!output) return;
    phase = { kind: "running", progress: { percent: 0, outTime: 0, speed: null }, startedAt: Date.now() };
    const unlisten = await onExportProgress((progress) => {
      if (phase.kind === "running") phase = { ...phase, progress };
    });
    try {
      const result = await exportVideo(buildExportPlan(output, size, encoder));
      phase = { kind: "done", result };
    } catch (e) {
      phase = { kind: "error", message: String(e) };
    } finally {
      unlisten();
    }
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
            <select bind:value={shortSide} class="field w-48">
              <option value={null}>Original · {orig.width}×{orig.height}</option>
              {#each presets as p (p)}
                {@const s = targetSize(orig, p)}
                <option value={p}>{p}p · {s.width}×{s.height}</option>
              {/each}
            </select>
          </label>
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
            {project.videoTrack.clips.length === 1 ? "clip" : "clips"}
          </p>
          <div class="flex justify-end gap-2">
            <button class="btn" onclick={close}>Cancelar</button>
            <button class="btn-accent" onclick={start}><Download size={13} /> Exportar…</button>
          </div>
        {/if}
      {:else if phase.kind === "running"}
        <div class="flex items-center gap-2">
          <LoaderCircle size={16} class="animate-spin text-accent" />
          <span>Exportando… {phase.progress.percent.toFixed(0)}%</span>
          <span class="ml-auto text-xs text-muted">
            {#if phase.progress.speed}{phase.progress.speed.toFixed(1)}× ·{/if}
            {#if remaining !== null}quedan {formatDuration(remaining).slice(0, -3)}{/if}
          </span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-panel-2">
          <div class="h-full bg-accent transition-[width] duration-200" style="width:{phase.progress.percent}%"></div>
        </div>
        <div class="flex justify-end">
          <button class="btn" onclick={() => cancelExport()}>Cancelar exportación</button>
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
