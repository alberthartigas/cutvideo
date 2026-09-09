<script lang="ts">
  import { onMount } from "svelte";
  import { CircleCheck, Download, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert, X } from "@lucide/svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Logo from "./Logo.svelte";
  import { ui } from "$lib/ui.svelte";
  import { REPO_URL } from "$lib/about";
  import { checkForUpdate, getVersion, installUpdate, restart, type UpdateState } from "$lib/tauri/updates";

  let version = $state("");
  let estado = $state<UpdateState>({ kind: "idle" });

  onMount(async () => {
    try {
      version = await getVersion();
    } catch {
      /* en modo navegador no hay versión nativa */
    }
  });

  async function buscar() {
    estado = { kind: "checking" };
    estado = await checkForUpdate();
  }

  async function instalar() {
    estado = { kind: "downloading", percent: 0 };
    const r = await installUpdate((p) => {
      if (estado.kind === "downloading") estado = { kind: "downloading", percent: p };
    });
    estado = r;
  }

  const close = () => (ui.aboutOpen = false);
  const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && close();
</script>

<svelte:window onkeydown={onKeyDown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="w-full max-w-sm rounded-xl border border-border bg-panel p-5 shadow-2xl"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex items-start">
      <div class="flex-1">
        <Logo class="h-6" />
      </div>
      <button class="tool h-7 w-7 justify-center px-0" onclick={close} aria-label="Cerrar"><X size={15} /></button>
    </div>

    <p class="mt-3 text-sm">Editor de vídeo rápido para Mac y Windows.</p>
    <p class="mt-2 text-xs text-muted">
      Versión {version || "—"} · Software libre con licencia MIT
    </p>
    <p class="mt-3 text-sm font-medium">Desarrollado por Alberth Artigas</p>

    <button class="btn mt-3 h-7 w-full justify-center" onclick={() => openUrl(REPO_URL)}>
      <ExternalLink size={13} /> Ver el código en GitHub
    </button>

    <h3 class="mt-4 mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Actualizaciones</h3>

    {#if estado.kind === "found"}
      <div class="rounded-lg border border-accent/40 bg-accent/10 p-2.5 text-xs">
        <p class="font-medium">Hay una versión nueva: {estado.version}</p>
        {#if estado.notes}
          <p class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-muted">{estado.notes}</p>
        {/if}
        <button class="btn mt-2 h-7 w-full justify-center" onclick={instalar}>
          <Download size={13} /> Descargar e instalar
        </button>
      </div>
    {:else if estado.kind === "downloading"}
      <div class="text-xs">
        <p class="mb-1 flex items-center gap-1.5 text-muted">
          <LoaderCircle size={12} class="animate-spin" /> Descargando… {estado.percent.toFixed(0)}%
        </p>
        <div class="h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div class="h-full bg-accent transition-[width] duration-200" style="width:{estado.percent}%"></div>
        </div>
      </div>
    {:else if estado.kind === "ready"}
      <div class="rounded-lg border border-border bg-panel-2 p-2.5 text-xs">
        <p class="flex items-center gap-1.5"><CircleCheck size={13} /> Instalada. Reinicia para usarla.</p>
        <button class="btn mt-2 h-7 w-full justify-center" onclick={restart}>Reiniciar ahora</button>
      </div>
    {:else if estado.kind === "error"}
      <p class="flex gap-1.5 rounded-lg bg-red-500/10 p-2 text-[11px] text-red-500">
        <TriangleAlert size={13} class="mt-0.5 shrink-0" />{estado.message}
      </p>
      <button class="btn mt-2 h-7 w-full justify-center" onclick={buscar}>Reintentar</button>
    {:else}
      <button class="btn h-7 w-full justify-center" disabled={estado.kind === "checking"} onclick={buscar}>
        {#if estado.kind === "checking"}
          <LoaderCircle size={13} class="animate-spin" /> Buscando…
        {:else}
          <RefreshCw size={13} /> Buscar actualizaciones
        {/if}
      </button>
      {#if estado.kind === "none"}
        <p class="mt-1.5 text-center text-[11px] text-muted">Ya tienes la última versión.</p>
      {/if}
    {/if}

    <p class="mt-4 text-[10px] leading-snug text-muted">
      Los efectos de sonido están sintetizados para la app. La música que sugiere el panel de audio
      viene de Openverse, cada pista con su propia licencia.
    </p>
  </div>
</div>
