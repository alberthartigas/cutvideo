<script lang="ts">
  import { onMount } from "svelte";
  import { Eye, EyeOff, ExternalLink, KeyRound, ShieldCheck, Trash2, X } from "@lucide/svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ui } from "$lib/ui.svelte";
  import { API_PROVIDERS } from "$lib/providers";
  import { AUTHOR } from "$lib/about";
  import { secretDelete, secretSet, secretStatus, type SecretStatus } from "$lib/tauri/secrets";

  let statuses = $state<Record<string, SecretStatus>>({});
  let drafts = $state<Record<string, string>>({});
  let reveal = $state<Record<string, boolean>>({});
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    for (const p of API_PROVIDERS) {
      try {
        statuses[p.id] = await secretStatus("api", p.id);
      } catch (e) {
        error = String(e);
      }
    }
  });

  async function save(id: string) {
    const value = drafts[id]?.trim();
    if (!value) return;
    busy = id;
    error = null;
    try {
      statuses[id] = await secretSet("api", id, value);
      drafts[id] = "";
      reveal[id] = false;
    } catch (e) {
      error = String(e);
    } finally {
      busy = null;
    }
  }

  async function remove(id: string) {
    busy = id;
    error = null;
    try {
      await secretDelete("api", id);
      statuses[id] = { kind: "api", id, present: false, hint: null };
    } catch (e) {
      error = String(e);
    } finally {
      busy = null;
    }
  }

  function close() {
    ui.settingsOpen = false;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/50" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div class="panel w-[560px] max-w-[92vw] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="panel-header">
      <span id="settings-title">Ajustes</span>
      <button class="tool h-6 w-6 justify-center px-0" title="Cerrar (Esc)" onclick={close}><X size={14} /></button>
    </div>

    <div class="max-h-[70vh] overflow-auto p-4 text-sm">
      <h3 class="flex items-center gap-2 font-semibold"><KeyRound size={14} /> Claves de API</h3>
      <p class="mt-1 flex items-start gap-1.5 text-xs text-muted">
        <ShieldCheck size={14} class="mt-0.5 shrink-0 text-emerald-500" />
        <span>
          Se guardan cifradas en el llavero del sistema (Llavero de macOS / Administrador de credenciales de Windows),
          nunca en archivos de texto ni dentro del proyecto. Pega la clave, pulsa Guardar y ya no se vuelve a mostrar entera.
        </span>
      </p>

      {#if error}
        <p class="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>
      {/if}

      <div class="mt-4 flex flex-col gap-4">
        {#each API_PROVIDERS as p (p.id)}
          {@const st = statuses[p.id]}
          <div class="rounded-lg border border-border bg-panel-2 p-3">
            <div class="flex items-center gap-2">
              <span class="font-medium">{p.name}</span>
              {#if st?.present}
                <span class="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  Guardada {st.hint}
                </span>
              {:else}
                <span class="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">No configurada</span>
              {/if}
              <button class="tool ml-auto h-6 px-1.5 text-[11px]" title="Abrir la página donde se crea la clave" onclick={() => openUrl(p.url)}>
                Obtener clave <ExternalLink size={11} />
              </button>
            </div>
            <p class="mt-1 text-xs text-muted">{p.description}</p>
            <div class="mt-2 flex items-center gap-2">
              <div class="relative flex-1">
                <input
                  type={reveal[p.id] ? "text" : "password"}
                  class="field w-full pr-8"
                  placeholder={st?.present ? "Pega una clave nueva para sustituirla" : p.placeholder}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  bind:value={drafts[p.id]}
                  onkeydown={(e) => e.key === "Enter" && save(p.id)}
                />
                <button
                  class="tool absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 justify-center px-0"
                  title={reveal[p.id] ? "Ocultar" : "Mostrar"}
                  onclick={() => (reveal[p.id] = !reveal[p.id])}
                >
                  {#if reveal[p.id]}<EyeOff size={13} />{:else}<Eye size={13} />{/if}
                </button>
              </div>
              <button class="btn-accent" disabled={busy === p.id || !drafts[p.id]?.trim()} onclick={() => save(p.id)}>
                Guardar
              </button>
              {#if st?.present}
                <button class="tool h-7 w-7 justify-center px-0" title="Borrar la clave guardada" disabled={busy === p.id} onclick={() => remove(p.id)}>
                  <Trash2 size={14} />
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <button
        class="mt-5 w-full text-center text-[11px] text-muted hover:text-text"
        onclick={() => {
          ui.settingsOpen = false;
          ui.aboutOpen = true;
        }}
      >
        Desarrollado por {AUTHOR} · Acerca de y actualizaciones
      </button>
    </div>
  </div>
</div>
