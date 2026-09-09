<script lang="ts">
  import {
    BadgeCheck,
    CircleAlert,
    Download,
    ExternalLink,
    Gauge,
    LoaderCircle,
    Pause,
    Play,
    Plus,
    FolderOpen,
    Music,
    Search,
    ShieldAlert,
    Waves,
  } from "@lucide/svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import PanelShell from "./PanelShell.svelte";
  import { project } from "$lib/project.svelte";
  import { formatDuration } from "$lib/format";
  import {
    analyzeBeats,
    checkMusicRights,
    downloadTrack,
    suggestFreeMusic,
    type BeatAnalysis,
    type FreeTrack,
    type RightsReport,
  } from "$lib/autoedit/run";
  import { probeMedia, type MediaInfo } from "$lib/tauri/media";
  import { mediaSrc } from "$lib/tauri/media";
  import { GENRES, library, type Genre } from "$lib/audio/library.svelte";
  import type { SoundAsset } from "$lib/tauri/sfx";

  type Tab = "musica" | "efectos" | "mios";
  let tab = $state<Tab>("musica");
  let genero = $state<Genre>(GENRES[0]);
  let categoria = $state<string | null>(null);

  // Al entrar en el panel se cargan los efectos y se va trayendo la música.
  $effect(() => void library.start());

  let pistas = $derived(library.music[genero.id] ?? []);
  let efectos = $derived(
    categoria ? library.sfx.filter((s) => s.category === categoria) : library.sfx,
  );

  let checking = $state<string | null>(null);
  let reports = $state<Record<string, RightsReport>>({});
  let beats = $state<Record<string, BeatAnalysis>>({});
  let suggestions = $state<FreeTrack[]>([]);
  let searching = $state(false);
  let error = $state<string | null>(null);
  let query = $state("upbeat background music");
  /** Pista que se está escuchando desde el panel (no sale de la app). */
  let playing = $state<string | null>(null);
  let adding = $state<string | null>(null);
  let player: HTMLAudioElement | undefined;

  /** Escucha un efecto de los que trae la app, sin meterlo en el proyecto. */
  function previewSfx(s: SoundAsset) {
    player ??= new Audio();
    if (playing === s.id) {
      player.pause();
      playing = null;
      return;
    }
    player.src = mediaSrc(s.path);
    player.onended = () => (playing = null);
    player.onerror = () => {
      error = `No se pudo reproducir «${s.name}».`;
      playing = null;
    };
    player.play().then(() => (playing = s.id)).catch(() => {
      error = `No se pudo reproducir «${s.name}».`;
    });
  }

  /** Mete un efecto en la pista de audio, en el punto donde esté el cursor. */
  async function addSfx(s: SoundAsset) {
    adding = s.id;
    error = null;
    try {
      const info = await probeMedia(s.path);
      project.addMedia(info);
      project.addClip(info);
    } catch (e) {
      error = String(e);
    } finally {
      adding = null;
    }
  }

  function preview(track: FreeTrack) {
    if (!track.audioUrl) return;
    player ??= new Audio();
    if (playing === track.url) {
      player.pause();
      playing = null;
      return;
    }
    player.src = track.audioUrl;
    player.onended = () => (playing = null);
    player.onerror = () => {
      error = `No se pudo reproducir «${track.title}». Ábrela en su página si quieres oírla entera.`;
      playing = null;
    };
    player.play().then(() => (playing = track.url)).catch(() => {
      error = `No se pudo reproducir «${track.title}».`;
    });
  }

  /** Descarga la pista, la mete en la biblioteca y la pone en la pista de audio. */
  async function addToProject(track: FreeTrack) {
    const source = track.audioUrl ?? track.url;
    adding = track.url;
    error = null;
    try {
      const path = await downloadTrack(source, `${track.title} - ${track.creator}`);
      const info = await probeMedia(path);
      project.addMedia(info);
      project.addClip(info);
    } catch (e) {
      error = String(e);
    } finally {
      adding = null;
    }
  }

  // Al cambiar de sección se corta lo que estuviera sonando.
  $effect(() => () => player?.pause());

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

{#snippet listaPistas(items: FreeTrack[])}
  <ul class="mt-2 space-y-1">
    {#each items as t (t.url)}
      <li class="rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs">
        <div class="flex items-center gap-1">
          <button
            class="tool h-6 w-6 shrink-0 justify-center px-0"
            title={t.audioUrl ? (playing === t.url ? "Pausar" : "Escuchar aquí") : "Esta pista no se puede escuchar desde aquí"}
            disabled={!t.audioUrl}
            onclick={() => preview(t)}
          >
            {#if playing === t.url}<Pause size={12} />{:else}<Play size={12} />{/if}
          </button>
          <span class="min-w-0 flex-1 truncate font-medium" title={t.title}>{t.title}</span>
          <button
            class="tool h-6 w-6 shrink-0 justify-center px-0"
            title="Descargar y añadir al proyecto"
            disabled={adding === t.url}
            onclick={() => addToProject(t)}
          >
            {#if adding === t.url}<LoaderCircle size={12} class="animate-spin" />{:else}<Download size={12} />{/if}
          </button>
          <button class="tool h-6 w-6 shrink-0 justify-center px-0" title="Ver su página (licencia y autor)" onclick={() => openUrl(t.url)}>
            <ExternalLink size={11} />
          </button>
        </div>
        <p class="truncate pl-7 text-[11px] text-muted">
          {t.creator} · {t.license}{#if t.duration}{" · "}{formatDuration(t.duration)}{/if}
        </p>
      </li>
    {/each}
  </ul>
{/snippet}

<PanelShell title="Audio" hint="Música por géneros y efectos listos para usar; lo tuyo puedes analizarlo antes de publicar">
  <div class="mb-2 flex gap-1 rounded-lg bg-panel-2 p-0.5">
    {#each [["musica", "Música", Music], ["efectos", "Efectos", Waves], ["mios", "Archivos", FolderOpen]] as const as [id, label, Icon] (id)}
      <button class="pestana" class:active={tab === id} onclick={() => (tab = id)}>
        <Icon size={12} />{label}
      </button>
    {/each}
  </div>

  {#if error}
    <p class="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{error}</p>
  {/if}

  {#if tab === "musica"}
    <div class="flex flex-wrap gap-1">
      {#each GENRES as g (g.id)}
        <button class="chip" class:active={genero.id === g.id} onclick={() => (genero = g)}>
          {g.name}
          {#if library.loading[g.id]}<LoaderCircle size={9} class="animate-spin" />{/if}
        </button>
      {/each}
    </div>

    {#if library.errors[genero.id]}
      <p class="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
        {library.errors[genero.id]}
        <button class="underline" onclick={() => library.load(genero, true)}>Reintentar</button>
      </p>
    {:else if pistas.length === 0}
      <p class="flex items-center justify-center gap-1.5 px-3 py-6 text-center text-xs text-muted">
        {#if library.loading[genero.id]}
          <LoaderCircle size={12} class="animate-spin" /> Buscando música de {genero.name}…
        {:else}
          No hay pistas de {genero.name} guardadas.
          <button class="underline" onclick={() => library.load(genero, true)}>Buscar</button>
        {/if}
      </p>
    {:else}
      {@render listaPistas(pistas)}
      <p class="mt-1 px-1 text-[10px] text-muted">
        Openverse · dominio público y Creative Commons. Comprueba la licencia de cada pista antes de
        publicar; algunas piden citar al autor.
      </p>
    {/if}

    <h3 class="mt-3 mb-1 px-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Buscar otra cosa</h3>
    <div class="flex gap-1">
      <input class="field h-7 min-w-0 flex-1 text-xs" bind:value={query} placeholder="Estilo, en inglés…" onkeydown={(e) => e.key === "Enter" && search(query)} />
      <button class="btn h-7 w-8 justify-center px-0" disabled={searching} onclick={() => search(query)}>
        {#if searching}<LoaderCircle size={13} class="animate-spin" />{:else}<Search size={13} />{/if}
      </button>
    </div>
    {#if suggestions.length}{@render listaPistas(suggestions)}{/if}

  {:else if tab === "efectos"}
    {#if library.sfxError}
      <p class="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">{library.sfxError}</p>
    {/if}
    <div class="flex flex-wrap gap-1">
      <button class="chip" class:active={categoria === null} onclick={() => (categoria = null)}>Todos</button>
      {#each library.sfxCategories as c (c)}
        <button class="chip" class:active={categoria === c} onclick={() => (categoria = c)}>{c}</button>
      {/each}
    </div>
    <ul class="mt-2 space-y-1">
      {#each efectos as s (s.id)}
        <li class="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs">
          <button class="tool h-6 w-6 shrink-0 justify-center px-0" title="Escuchar" onclick={() => previewSfx(s)}>
            {#if playing === s.id}<Pause size={12} />{:else}<Play size={12} />{/if}
          </button>
          <span class="min-w-0 flex-1 truncate font-medium">{s.name}</span>
          <span class="shrink-0 text-[10px] text-muted">{s.category}</span>
          <button
            class="tool h-6 w-6 shrink-0 justify-center px-0"
            title="Añadir a la pista de audio"
            disabled={adding === s.id}
            onclick={() => addSfx(s)}
          >
            {#if adding === s.id}<LoaderCircle size={12} class="animate-spin" />{:else}<Plus size={12} />{/if}
          </button>
        </li>
      {:else}
        <li class="flex items-center justify-center gap-1.5 px-3 py-6 text-center text-xs text-muted">
          <LoaderCircle size={12} class="animate-spin" /> Cargando efectos…
        </li>
      {/each}
    </ul>
    <p class="mt-1 px-1 text-[10px] text-muted">
      Vienen con la app y están sintetizados para el editor: puedes usarlos donde quieras, sin licencias.
    </p>

  {:else}
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
  {/if}
</PanelShell>

<style>
  .pestana {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 6px;
    padding: 4px 0;
    font-size: 11px;
    color: var(--muted);
  }
  .pestana:hover {
    color: var(--text);
  }
  .pestana.active {
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 11px;
    color: var(--text);
  }
  .chip:hover {
    border-color: var(--muted);
  }
  .chip.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  }
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
