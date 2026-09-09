<script lang="ts">
  import {
    BadgeCheck,
    CircleAlert,
    ExternalLink,
    Gauge,
    LoaderCircle,
    Plus,
    Search,
    ShieldAlert,
  } from "@lucide/svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import PanelShell from "./PanelShell.svelte";
  import { project } from "$lib/project.svelte";
  import { formatDuration } from "$lib/format";
  import {
    analyzeBeats,
    checkMusicRights,
    suggestFreeMusic,
    type BeatAnalysis,
    type FreeTrack,
    type RightsReport,
  } from "$lib/autoedit/run";
  import type { MediaInfo } from "$lib/tauri/media";

  let checking = $state<string | null>(null);
  let reports = $state<Record<string, RightsReport>>({});
  let beats = $state<Record<string, BeatAnalysis>>({});
  let suggestions = $state<FreeTrack[]>([]);
  let searching = $state(false);
  let error = $state<string | null>(null);
  let query = $state("upbeat background music");

  let audioFiles = $derived(project.media.filter((m) => m.audio));

  const VERDICTS = {
    copyrighted: { label: "Con derechos", cls: "bad", icon: ShieldAlert },
    risky: { label: "Dudoso", cls: "warn", icon: CircleAlert },
    unknown: { label: "Sin indicios", cls: "ok", icon: BadgeCheck },
  } as const;

  async function check(item: MediaInfo) {
    checking = item.path;
    error = null;
    try {
      reports[item.path] = await checkMusicRights(item.path);
      const r = reports[item.path];
      if (r.verdict !== "unknown") await search(r.tags.title ?? query);
    } catch (e) {
      error = String(e);
    } finally {
      checking = null;
    }
  }

  async function tempo(item: MediaInfo) {
    checking = item.path;
    error = null;
    try {
      beats[item.path] = await analyzeBeats(item.path);
    } catch (e) {
      error = String(e);
    } finally {
      checking = null;
    }
  }

  async function search(q: string) {
    searching = true;
    error = null;
    try {
      suggestions = await suggestFreeMusic(q);
    } catch (e) {
      error = String(e);
    } finally {
      searching = false;
    }
  }
</script>

<PanelShell title="Audio" hint="Comprueba si la música puede darte problemas de copyright antes de publicar">
  {#if error}
    <p class="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{error}</p>
  {/if}

  {#each audioFiles as item (item.path)}
    {@const report = reports[item.path]}
    {@const beat = beats[item.path]}
    <div class="mb-2 rounded-lg border border-border bg-panel-2 p-2 text-xs">
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1 truncate font-medium" title={item.fileName}>{item.fileName}</span>
        <button class="tool h-6 w-6 justify-center px-0" title="Añadir a la pista de audio" onclick={() => project.addClip(item)}>
          <Plus size={13} />
        </button>
      </div>
      <p class="mt-0.5 text-muted">
        {formatDuration(item.durationSec)}
        {#if beat?.bpm}· {beat.bpm.toFixed(0)} BPM{/if}
      </p>

      {#if report}
        {@const v = VERDICTS[report.verdict]}
        {@const Icon = v.icon}
        <div class="verdict {v.cls} mt-2">
          <Icon size={13} />
          <span class="font-medium">{v.label}</span>
          <span class="ml-auto opacity-70">{Math.round(report.confidence * 100)}%</span>
        </div>
        {#if report.identifiedAs}
          <p class="mt-1 truncate" title={report.identifiedAs}>Identificada: {report.identifiedAs}</p>
        {/if}
        <ul class="mt-1 space-y-0.5 text-[11px] text-muted">
          {#each report.findings as f (f)}<li>· {f}</li>{/each}
          {#each report.limitations as l (l)}<li class="opacity-75">· {l}</li>{/each}
        </ul>
        <p class="mt-1 text-[10px] text-muted opacity-70">
          Es una ayuda, no un dictamen legal: la última palabra la tiene la plataforma donde publiques.
        </p>
      {/if}

      <div class="mt-2 flex gap-1">
        <button class="btn h-6 flex-1 justify-center" disabled={checking === item.path} onclick={() => check(item)}>
          {#if checking === item.path}<LoaderCircle size={12} class="animate-spin" />{:else}<ShieldAlert size={12} />{/if}
          Derechos
        </button>
        <button class="btn h-6 flex-1 justify-center" disabled={checking === item.path} onclick={() => tempo(item)}>
          <Gauge size={12} /> Ritmo
        </button>
      </div>
    </div>
  {:else}
    <p class="px-3 py-6 text-center text-xs text-muted">Importa música o un archivo de audio para analizarlo</p>
  {/each}

  <h3 class="mt-3 mb-1 px-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Música libre</h3>
  <div class="flex gap-1">
    <input class="field h-7 min-w-0 flex-1 text-xs" bind:value={query} placeholder="Estilo, en inglés…" onkeydown={(e) => e.key === "Enter" && search(query)} />
    <button class="btn h-7 w-8 justify-center px-0" disabled={searching} onclick={() => search(query)}>
      {#if searching}<LoaderCircle size={13} class="animate-spin" />{:else}<Search size={13} />{/if}
    </button>
  </div>
  <ul class="mt-2 space-y-1">
    {#each suggestions as t (t.url)}
      <li class="rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs">
        <div class="flex items-baseline gap-1">
          <span class="min-w-0 flex-1 truncate font-medium" title={t.title}>{t.title}</span>
          <button class="tool h-5 px-1 text-[10px]" title="Abrir para descargarla" onclick={() => openUrl(t.url)}>
            <ExternalLink size={10} />
          </button>
        </div>
        <p class="truncate text-[11px] text-muted">
          {t.creator} · {t.license}{#if t.duration}{" · "}{formatDuration(t.duration)}{/if}
        </p>
      </li>
    {/each}
  </ul>
  {#if suggestions.length}
    <p class="mt-1 px-1 text-[10px] text-muted">Openverse · comprueba la licencia de cada pista antes de usarla.</p>
  {/if}
</PanelShell>

<style>
  .verdict {
    display: flex;
    align-items: center;
    gap: 5px;
    border-radius: 6px;
    padding: 3px 6px;
  }
  .verdict.bad {
    background: color-mix(in srgb, #ef4444 18%, transparent);
    color: #ef4444;
  }
  .verdict.warn {
    background: color-mix(in srgb, #f59e0b 18%, transparent);
    color: #d97706;
  }
  .verdict.ok {
    background: color-mix(in srgb, #10b981 18%, transparent);
    color: #059669;
  }
</style>
