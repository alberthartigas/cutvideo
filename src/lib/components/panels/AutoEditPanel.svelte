<script lang="ts">
  import { onMount } from "svelte";
  import { CircleCheck, LoaderCircle, Settings, Sparkles, TriangleAlert, WandSparkles } from "@lucide/svelte";
  import PanelShell from "./PanelShell.svelte";
  import { project } from "$lib/project.svelte";
  import { ui } from "$lib/ui.svelte";
  import { secretStatus } from "$lib/tauri/secrets";
  import { SUBTITLE_STYLES } from "$lib/subtitles/cues";
  import { TRANSITIONS } from "$lib/transitions/presets";
  import { LANGUAGES, TRANSCRIBE_PROVIDERS } from "$lib/tauri/transcribe";
  import { AI_PROVIDERS, DEFAULT_AUTOEDIT, runAutoEdit, type AutoEditOptions, type AutoEditResult } from "$lib/autoedit/run";
  import { formatDuration } from "$lib/format";

  type Phase =
    | { kind: "idle" }
    | { kind: "running"; step: string }
    | { kind: "done"; result: AutoEditResult }
    | { kind: "error"; message: string };

  let phase = $state<Phase>({ kind: "idle" });
  let o = $state<AutoEditOptions>({ ...DEFAULT_AUTOEDIT });
  let keys = $state<Record<string, boolean>>({});

  let ready = $derived(project.videoTrack.clips.length > 0);
  let needsTranscribe = $derived(o.addSubtitles || o.useAi);
  let missingTranscribeKey = $derived(needsTranscribe && keys[o.provider] === false);
  let aiNeedsKey = $derived(AI_PROVIDERS.find((p) => p.id === o.aiProvider)?.needsKey ?? null);
  let missingAiKey = $derived(o.useAi && aiNeedsKey !== null && keys[aiNeedsKey] === false);

  onMount(async () => {
    const needed = new Set<string>([...TRANSCRIBE_PROVIDERS.map((p) => p.id)]);
    for (const p of AI_PROVIDERS) if (p.needsKey) needed.add(p.needsKey);
    for (const id of needed) {
      try {
        keys[id] = (await secretStatus("api", id)).present;
      } catch {
        keys[id] = false;
      }
    }
  });

  async function start() {
    phase = { kind: "running", step: "Preparando…" };
    try {
      const result = await runAutoEdit(o, (step) => (phase = { kind: "running", step }));
      phase = { kind: "done", result };
    } catch (e) {
      phase = { kind: "error", message: String(e) };
    }
  }
</script>

<PanelShell title="Autoedición" hint="Monta el vídeo entero: quita silencios, pone transiciones, subtítulos y textos">
  {#if phase.kind === "running"}
    <div class="flex flex-col items-center gap-3 px-3 py-10 text-center">
      <LoaderCircle size={26} class="animate-spin text-accent" />
      <p class="text-sm">{phase.step}</p>
      <p class="text-xs text-muted">No cierres la app mientras trabaja.</p>
    </div>
  {:else if phase.kind === "done"}
    {@const r = phase.result}
    <div class="flex flex-col gap-3 text-xs">
      <div class="flex items-center gap-2 text-sm">
        <CircleCheck size={18} class="text-emerald-500" />
        <span class="font-medium">Vídeo montado</span>
      </div>
      <ul class="space-y-1 text-muted">
        {#if r.mounted}<li>· {r.mounted} vídeos montados en orden de grabación</li>{/if}
        {#if r.highlights}
          <li>
            · {r.highlights.picks} momentos escogidos ·
            de {formatDuration(r.highlights.originalSeconds).slice(0, -3)}
            a {formatDuration(r.highlights.seconds).slice(0, -3)}
          </li>
        {/if}
        {#if r.removedSeconds > 0}<li>· {formatDuration(r.removedSeconds).slice(0, -3)} de silencios quitados</li>{/if}
        {#if r.cuts}<li>· {r.cuts} cortes</li>{/if}
        {#if r.transitions}<li>· {r.transitions} transiciones</li>{/if}
        {#if r.subtitles}<li>· {r.subtitles} subtítulos</li>{/if}
        {#if r.texts}<li>· {r.texts} textos</li>{/if}
        {#if r.music}<li>· música: {r.music}</li>{/if}
        {#if r.layers.added}<li>· {r.layers.added} escenas añadidas al final</li>{/if}
        {#if r.layers.chromaed}<li>· {r.layers.chromaed} con la pantalla verde quitada</li>{/if}
        {#if r.layers.cutout}<li>· {r.layers.cutout} con la persona recortada</li>{/if}
        {#if r.layers.pip}<li>· {r.layers.pip} en imagen en imagen</li>{/if}
        {#if r.bpm}<li>· música a {r.bpm.toFixed(0)} BPM</li>{/if}
      </ul>
      {#if r.plan}
        <div class="rounded-lg border border-border bg-panel-2 p-2">
          <p class="flex items-center gap-1.5 font-medium"><Sparkles size={12} class="text-accent" /> {r.plan.title}</p>
          <p class="mt-1 text-muted">{r.plan.reasoning}</p>
          {#if r.plan.musicQuery}
            <p class="mt-1 text-muted">Música sugerida: «{r.plan.musicQuery}» (búscala en la sección Audio).</p>
          {/if}
        </div>
      {/if}
      {#each r.notes as note (note)}
        <p class="flex gap-1.5 text-muted"><TriangleAlert size={12} class="mt-0.5 shrink-0 text-amber-500" />{note}</p>
      {/each}
      <div class="flex gap-2">
        <button class="btn h-7 flex-1 justify-center" onclick={() => project.undo()}>Deshacer</button>
        <button class="btn-accent h-7 flex-1 justify-center" onclick={() => (phase = { kind: "idle" })}>Listo</button>
      </div>
    </div>
  {:else if phase.kind === "error"}
    <div class="flex flex-col gap-3 text-xs">
      <div class="flex items-start gap-2">
        <TriangleAlert size={16} class="mt-0.5 shrink-0 text-red-500" />
        <p class="whitespace-pre-wrap">{phase.message}</p>
      </div>
      <button class="btn-accent h-7 justify-center" onclick={() => (phase = { kind: "idle" })}>Volver</button>
    </div>
  {:else}
    <button class="btn-accent mb-3 h-9 w-full justify-center text-sm" disabled={!ready} onclick={start}>
      <WandSparkles size={15} /> Autoeditar
    </button>
    {#if !ready}
      <p class="mb-2 text-xs text-muted">Añade clips a la pista principal para poder autoeditar.</p>
    {/if}
    {#if missingTranscribeKey || missingAiKey}
      <p class="mb-2 flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
        <span>
          Falta la clave de {missingTranscribeKey ? "los subtítulos" : ""}{missingTranscribeKey && missingAiKey
            ? " y de "
            : ""}{missingAiKey ? "la IA" : ""}. Con una sola clave de Groq (gratis) funcionan las dos.
        </span>
        <button class="btn h-6" onclick={() => (ui.settingsOpen = true)}><Settings size={11} /> Ajustes</button>
      </p>
    {/if}

    <div class="flex flex-col gap-2 text-xs">
      <label class="row">
        <input type="checkbox" class="accent-accent" bind:checked={o.useAllMedia} /> Montar todo lo de Medios
      </label>
      {#if o.useAllMedia}
        <p class="sub text-[10px] leading-snug">
          No hace falta arrastrar nada antes: coge los vídeos de la lista y los pone en orden de
          grabación.
        </p>
      {/if}

      <label class="row">
        <input type="checkbox" class="accent-accent" bind:checked={o.selectHighlights} /> Escoger los mejores momentos
      </label>
      {#if o.selectHighlights}
        <p class="sub text-[10px] leading-snug">
          {#if o.useAi && o.aiProvider !== "none"}
            La IA ve todo el material —cada clip, sus tramos con más sonido y movimiento y lo que se
            dice en ellos— y elige los momentos que cuentan la historia según el estilo pedido.
          {:else}
            Puntúa cada tramo por lo que suena y lo que se mueve, y monta solo lo mejor en orden.
          {/if}
          Sustituye a quitar silencios.
        </p>
        <label class="sub">
          <span>Dejarlo en</span>
          <input class="flex-1 accent-accent" type="range" min="15" max="300" step="5" bind:value={o.targetSeconds} />
          <span class="w-12 text-right tabular-nums">{o.targetSeconds < 60 ? `${o.targetSeconds} s` : `${Math.round(o.targetSeconds / 60)} min`}</span>
        </label>
      {/if}

      <label class="row" class:opacity-50={o.selectHighlights}>
        <input type="checkbox" class="accent-accent" bind:checked={o.removeSilences} disabled={o.selectHighlights} />
        Quitar silencios
      </label>
      {#if o.removeSilences && !o.selectHighlights}
        <label class="sub">
          <span>Sensibilidad</span>
          <input class="flex-1 accent-accent" type="range" min="-50" max="-15" step="1" bind:value={o.silenceThreshold} />
          <span class="w-12 text-right tabular-nums">{o.silenceThreshold} dB</span>
        </label>
        <label class="sub">
          <span>Pausa mín.</span>
          <input class="flex-1 accent-accent" type="range" min="0.2" max="2" step="0.1" bind:value={o.silenceMin} />
          <span class="w-12 text-right tabular-nums">{o.silenceMin.toFixed(1)} s</span>
        </label>
      {/if}

      <label class="row"><input type="checkbox" class="accent-accent" bind:checked={o.addTransitions} /> Poner transiciones</label>
      {#if o.addTransitions}
        <label class="sub">
          <span>Tipo</span>
          <select class="field h-6 flex-1 text-xs" bind:value={o.transitionId}>
            <option value="auto">Que elija la IA · variadas</option>
            {#each TRANSITIONS as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </label>
      {/if}

      <label class="row"><input type="checkbox" class="accent-accent" bind:checked={o.syncToBeat} /> Cortar al ritmo de la música</label>
      <label class="row"><input type="checkbox" class="accent-accent" bind:checked={o.addMusic} /> Poner música libre si no hay</label>
      <label class="row"><input type="checkbox" class="accent-accent" bind:checked={o.useLayers} /> Preparar las capas</label>
      {#if o.useLayers}
        <p class="sub text-[10px] leading-snug">
          En lo que ya esté en O1/O2: quita la pantalla verde, recorta a las personas y pone en una esquina
          lo que taparía el vídeo. No encima clips por su cuenta.
        </p>
        <label class="row pl-[22px] text-muted" class:opacity-50={o.useAllMedia}>
          <input type="checkbox" class="accent-accent" bind:checked={o.addSpareScenes} disabled={o.useAllMedia} />
          Añadir al final los medios sin montar, con transición
        </label>
        {#if o.addSpareScenes}
          <label class="sub">
            <span>Como mucho</span>
            <input class="flex-1 accent-accent" type="range" min="1" max="3" step="1" bind:value={o.maxSpareScenes} />
            <span class="w-12 text-right tabular-nums">{o.maxSpareScenes}</span>
          </label>
        {/if}
      {/if}

      <label class="row"><input type="checkbox" class="accent-accent" bind:checked={o.addSubtitles} /> Subtítulos automáticos</label>
      {#if o.addSubtitles}
        <label class="sub">
          <span>Estilo</span>
          <select class="field h-6 flex-1 text-xs" bind:value={o.subtitleStyle}>
            <option value="auto">Que elija la IA</option>
            {#each SUBTITLE_STYLES as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
      {/if}

      <label class="row"><input type="checkbox" class="accent-accent" bind:checked={o.useAi} /> Dirigir con IA: momentos, títulos y textos</label>
      {#if o.useAi}
        <label class="sub">
          <span>Con</span>
          <select class="field h-6 flex-1 text-xs" bind:value={o.aiProvider}>
            {#each AI_PROVIDERS as p (p.id)}<option value={p.id}>{p.name} · {p.note}</option>{/each}
          </select>
        </label>
        {#if o.aiProvider !== "none"}
          <label class="sub">
            <span>Estilo</span>
            <input class="field h-6 flex-1 text-xs" bind:value={o.style} placeholder="dinámico, tutorial, vlog…" />
          </label>
        {/if}
      {/if}

      {#if needsTranscribe}
        <label class="sub">
          <span>Idioma</span>
          <select class="field h-6 flex-1 text-xs" bind:value={o.language}>
            {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.name}</option>{/each}
          </select>
        </label>
        <label class="sub">
          <span>Transcribe</span>
          <select class="field h-6 flex-1 text-xs" bind:value={o.provider}>
            {#each TRANSCRIBE_PROVIDERS as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
    <p class="mt-3 text-[10px] text-muted">Todo lo que haga se puede deshacer con ⌘Z.</p>
  {/if}
</PanelShell>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 22px;
    color: var(--muted);
  }
  .sub > span:first-child {
    width: 68px;
    flex-shrink: 0;
  }
</style>
