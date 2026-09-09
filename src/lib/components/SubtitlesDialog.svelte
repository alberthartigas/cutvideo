<script lang="ts">
  import { onMount } from "svelte";
  import { Captions, CircleCheck, LoaderCircle, Settings, TriangleAlert, X } from "@lucide/svelte";
  import { ui } from "$lib/ui.svelte";
  import { project, type Clip } from "$lib/project.svelte";
  import { secretStatus } from "$lib/tauri/secrets";
  import {
    LANGUAGES,
    TRANSCRIBE_PROVIDERS,
    onTranscribeProgress,
    transcribe,
    type TranscribeProvider,
    type Transcript,
  } from "$lib/tauri/transcribe";
  import { buildCues, cuesFromSegments, SUBTITLE_STYLES } from "$lib/subtitles/cues";
  import { formatDuration } from "$lib/format";

  type Phase =
    | { kind: "idle" }
    | { kind: "running"; message: string }
    | { kind: "done"; count: number; transcript: Transcript }
    | { kind: "error"; message: string; needsKey: boolean };

  let phase = $state<Phase>({ kind: "idle" });
  let provider = $state<TranscribeProvider>("groq");
  let language = $state("");
  let styleId = $state(SUBTITLE_STYLES[0].id);
  let karaoke = $state(true);
  let maxChars = $state(38);
  let keyStatus = $state<Record<string, boolean | null>>({});

  let existing = $derived(project.subtitleTrack.clips.length);
  let hasKey = $derived(keyStatus[provider] ?? null);
  let running = $derived(phase.kind === "running");

  onMount(async () => {
    for (const p of TRANSCRIBE_PROVIDERS) {
      try {
        keyStatus[p.id] = (await secretStatus("api", p.id)).present;
      } catch {
        keyStatus[p.id] = null;
      }
    }
  });

  async function start() {
    const clips = project.videoTrack.clips.map((c: Clip) => ({
      path: c.mediaPath,
      in: c.in,
      out: c.out,
      start: c.start,
      hasAudio: project.mediaOf(c)?.audio != null,
    }));
    phase = { kind: "running", message: "Preparando…" };
    const unlisten = await onTranscribeProgress((p) => {
      if (phase.kind === "running") phase = { kind: "running", message: p.message };
    });
    try {
      const transcript = await transcribe({ provider, language: language || null, clips });
      const cues = transcript.words.length
        ? buildCues(transcript.words, { maxChars })
        : cuesFromSegments(transcript.segments, { maxChars });
      const style = SUBTITLE_STYLES.find((s) => s.id === styleId) ?? SUBTITLE_STYLES[0];
      project.setSubtitles(cues, { ...style.data, emphasis: karaoke && transcript.words.length ? "karaoke" : "none" });
      phase = { kind: "done", count: cues.length, transcript };
    } catch (e) {
      const message = String(e);
      phase = { kind: "error", message, needsKey: /clave de API/i.test(message) };
    } finally {
      unlisten();
    }
  }

  function openSettings() {
    ui.subtitlesOpen = false;
    ui.settingsOpen = true;
  }

  function close() {
    if (running) return;
    ui.subtitlesOpen = false;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/50" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div class="panel w-[460px] max-w-[92vw] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="subs-title">
    <div class="panel-header">
      <span id="subs-title" class="flex items-center gap-2"><Captions size={13} /> Subtítulos automáticos</span>
      <button class="tool h-6 w-6 justify-center px-0" title="Cerrar" onclick={close} disabled={running}><X size={14} /></button>
    </div>

    <div class="flex flex-col gap-4 p-4 text-sm">
      {#if phase.kind === "idle"}
        <label class="flex items-center justify-between gap-3">
          <span>Servicio</span>
          <select bind:value={provider} class="field w-56">
            {#each TRANSCRIBE_PROVIDERS as p (p.id)}<option value={p.id}>{p.name} · {p.model}</option>{/each}
          </select>
        </label>
        {#if hasKey === false}
          <p class="-mt-2 flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <span>No hay clave de API guardada para este servicio.</span>
            <button class="btn h-6" onclick={openSettings}><Settings size={12} /> Ajustes</button>
          </p>
        {/if}
        <label class="flex items-center justify-between gap-3">
          <span>Idioma</span>
          <select bind:value={language} class="field w-56">
            {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.name}</option>{/each}
          </select>
        </label>
        <label class="flex items-center justify-between gap-3">
          <span>Estilo</span>
          <select bind:value={styleId} class="field w-56">
            {#each SUBTITLE_STYLES as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
        <label class="flex items-center justify-between gap-3">
          <span>Máx. caracteres por línea</span>
          <input type="number" min="16" max="60" class="field w-20 text-center" bind:value={maxChars} />
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" class="accent-accent" bind:checked={karaoke} />
          <span>Resaltar palabra a palabra (karaoke)</span>
        </label>
        <p class="text-xs text-muted">
          Se transcribe el audio de la pista principal ({formatDuration(project.videoTrack.clips.reduce((n, c) => n + c.out - c.in, 0))}).
          {#if existing}Se sustituirán los {existing} subtítulos actuales de S1.{:else}Los subtítulos irán a la pista S1 y se pueden editar como cualquier texto.{/if}
        </p>
        <div class="flex justify-end gap-2">
          <button class="btn" onclick={close}>Cancelar</button>
          <button class="btn-accent" onclick={start} disabled={hasKey === false}><Captions size={13} /> Transcribir</button>
        </div>
      {:else if phase.kind === "running"}
        <div class="flex items-center gap-2">
          <LoaderCircle size={16} class="animate-spin text-accent" />
          <span>{phase.message}</span>
        </div>
      {:else if phase.kind === "done"}
        <div class="flex items-start gap-2">
          <CircleCheck size={18} class="shrink-0 text-emerald-500" />
          <div class="min-w-0">
            <p class="font-medium">{phase.count} {phase.count === 1 ? "subtítulo creado" : "subtítulos creados"}</p>
            <p class="text-xs text-muted">
              {phase.transcript.words.length} palabras · idioma {phase.transcript.language ?? "?"} · {phase.transcript.provider} ({phase.transcript.model})
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn" onclick={() => (phase = { kind: "idle" })}>Repetir</button>
          <button class="btn-accent" onclick={close}>Listo</button>
        </div>
      {:else}
        <div class="flex items-start gap-2">
          <TriangleAlert size={18} class="shrink-0 text-red-500" />
          <div class="min-w-0">
            <p class="font-medium">No se pudo transcribir</p>
            <p class="mt-1 text-xs whitespace-pre-wrap text-muted">{phase.message}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          {#if phase.needsKey}<button class="btn" onclick={openSettings}><Settings size={12} /> Ajustes</button>{/if}
          <button class="btn" onclick={() => (phase = { kind: "idle" })}>Volver</button>
          <button class="btn-accent" onclick={close}>Cerrar</button>
        </div>
      {/if}
    </div>
  </div>
</div>
