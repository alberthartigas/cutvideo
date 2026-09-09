<script lang="ts">
  import { Crosshair, LoaderCircle, TriangleAlert, X } from "@lucide/svelte";
  import { project, type Clip } from "$lib/project.svelte";
  import { trackPatch } from "$lib/patches/tracker";
  import { formatDuration } from "$lib/format";

  let { clip }: { clip: Clip } = $props();

  let running = $state(false);
  let progress = $state(0);
  let message = $state<string | null>(null);
  let warning = $state<string | null>(null);
  let cancelled = false;

  let tracked = $derived(!!clip.patch?.track);

  async function start() {
    running = true;
    progress = 0;
    message = null;
    warning = null;
    cancelled = false;
    try {
      const result = await trackPatch(clip, (f) => (progress = f), () => cancelled);
      project.commit();
      project.updatePatch(clip.id, { track: result.track });
      if (result.lostAt !== null) {
        warning = `El seguimiento se perdió sobre ${formatDuration(result.lostAt)}. Ajusta el parche ahí y vuelve a seguir.`;
      } else if (result.confidence < 0.55) {
        warning = "El objeto se sigue con poca seguridad: revísalo antes de exportar.";
      }
    } catch (e) {
      message = String(e).replace(/^Error:\s*/, "");
    } finally {
      running = false;
    }
  }
</script>

<div class="px-1">
  {#if running}
    <div class="flex items-center gap-2 text-xs">
      <LoaderCircle size={14} class="animate-spin text-accent" />
      <span>Siguiendo el objeto… {Math.round(progress * 100)}%</span>
      <button class="tool ml-auto h-6" onclick={() => (cancelled = true)}>Cancelar</button>
    </div>
    <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
      <div class="h-full bg-accent transition-[width]" style="width:{progress * 100}%"></div>
    </div>
  {:else}
    <div class="flex gap-1">
      <button class="btn h-7 flex-1 justify-center" onclick={start}>
        <Crosshair size={13} />
        {tracked ? "Volver a seguir" : "Seguir objeto"}
      </button>
      {#if tracked}
        <button
          class="tool h-7 w-7 justify-center px-0"
          title="Dejar de seguir y fijar la posición"
          onclick={() => { project.commit(); project.updatePatch(clip.id, { track: undefined }); }}
        >
          <X size={14} />
        </button>
      {/if}
    </div>
    {#if !tracked}
      <p class="mt-1 text-[11px] text-muted">
        Coloca el parche sobre lo que quieras seguir (una cabeza, un objeto) y pulsa aquí.
      </p>
    {/if}
  {/if}

  {#if warning}
    <p class="mt-1.5 flex gap-1 text-[11px] text-amber-600 dark:text-amber-400">
      <TriangleAlert size={12} class="mt-0.5 shrink-0" />{warning}
    </p>
  {/if}
  {#if message}
    <p class="mt-1.5 text-[11px] text-red-500">{message}</p>
  {/if}
</div>
