<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Activity } from "@lucide/svelte";
  import { project } from "$lib/project.svelte";
  import { currentFrame } from "$lib/preview/current-frame";
  import { isDefaultGrade } from "$lib/effects/grade.svelte";
  import { ui, type ScopeKind } from "$lib/ui.svelte";

  /**
   * Scopes del fotograma de V1 (forma de onda, parade RGB, vectorscopio),
   * calculados en Rust con el crate de FilmCraft (scopes.rs). Miden la
   * corrección de color del clip, no los efectos rápidos (esos son CSS).
   */
  const KINDS: { id: ScopeKind; name: string }[] = [
    { id: "waveform", name: "Onda" },
    { id: "parade", name: "Parade" },
    { id: "vectorscope", name: "Vector" },
  ];
  /** Lo mismo que muestrea FilmCraft: más no cambia el scope y cuesta más. */
  const MAX_W = 480;
  const MAX_H = 270;

  let canvas = $state<HTMLCanvasElement>();
  let vacio = $state(true);
  let grab: HTMLCanvasElement | undefined;
  let ocupado = false;

  async function medir() {
    const el = currentFrame.el;
    const clip = currentFrame.clip;
    if (ocupado || !canvas) return;
    if (!el || !clip || el.readyState < 2 || !el.videoWidth) {
      vacio = true;
      return;
    }
    ocupado = true;
    try {
      const k = Math.min(1, MAX_W / el.videoWidth, MAX_H / el.videoHeight);
      const [w, h] = [Math.max(2, Math.round(el.videoWidth * k)), Math.max(2, Math.round(el.videoHeight * k))];
      grab ??= document.createElement("canvas");
      if (grab.width !== w || grab.height !== h) [grab.width, grab.height] = [w, h];
      const g = grab.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(el, 0, 0, w, h);
      const px = new Uint8Array(g.getImageData(0, 0, w, h).data.buffer);
      const headers: Record<string, string> = { "x-kind": ui.scope, "x-width": String(w), "x-height": String(h) };
      const grade = clip.effects?.grade;
      if (!isDefaultGrade(grade)) headers["x-grade"] = JSON.stringify(grade);
      const buf = new Uint8Array(await invoke<ArrayBuffer>("video_scope", px, { headers }));
      const view = new DataView(buf.buffer, buf.byteOffset);
      const [ow, oh] = [view.getUint32(0, true), view.getUint32(4, true)];
      pintar(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, ow * oh * 4).slice(), ow, oh));
      vacio = false;
    } catch (e) {
      console.error("[CutVideo] scopes:", e);
    } finally {
      ocupado = false;
    }
  }

  /** El trazo de Rust escalado al canvas, con la retícula encima. */
  function pintar(img: ImageData) {
    const c = canvas!;
    const ctx = c.getContext("2d")!;
    const [W, H] = [c.width, c.height];
    ctx.fillStyle = "#050507";
    ctx.fillRect(0, 0, W, H);
    const tmp = new OffscreenCanvas(img.width, img.height);
    tmp.getContext("2d")!.putImageData(img, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "9px system-ui";
    ctx.lineWidth = 1;
    if (ui.scope === "vectorscope") {
      const s = Math.min(W, H);
      const [x0, y0] = [(W - s) / 2, (H - s) / 2];
      ctx.drawImage(tmp, x0, y0, s, s);
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, s / 2 - 0.5, 0, Math.PI * 2);
      ctx.moveTo(W / 2 - s / 2, H / 2);
      ctx.lineTo(W / 2 + s / 2, H / 2);
      ctx.moveTo(W / 2, H / 2 - s / 2);
      ctx.lineTo(W / 2, H / 2 + s / 2);
      ctx.stroke();
      // Línea de piel: 123° desde +Cb. Las caras bien corregidas caen encima.
      const a = (123 * Math.PI) / 180;
      ctx.strokeStyle = "rgba(255,190,140,0.5)";
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      ctx.lineTo(W / 2 + Math.cos(a) * (s / 2), H / 2 - Math.sin(a) * (s / 2));
      ctx.stroke();
    } else {
      ctx.drawImage(tmp, 0, 0, W, H);
      for (const v of [0, 25, 50, 75, 100]) {
        const y = Math.round(H - 1 - (v / 100) * (H - 1)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.fillText(String(v), 2, Math.min(H - 2, Math.max(9, y - 2)));
      }
      if (ui.scope === "parade") {
        for (const k of [1, 2]) {
          ctx.beginPath();
          ctx.moveTo(Math.round((W * k) / 3) + 0.5, 0);
          ctx.lineTo(Math.round((W * k) / 3) + 0.5, H);
          ctx.stroke();
        }
      }
    }
  }

  // Parados se mide con cada cambio; reproduciendo, unas 6 veces por segundo,
  // que es lo que se puede leer a ojo sin cargar el procesador.
  $effect(() => {
    void project.playhead;
    void ui.scope;
    void JSON.stringify(project.clipAt(project.videoTrack, project.playhead)?.effects?.grade ?? null);
    // Tras un seek el fotograma tarda un poco en estar: se mide al momento y otra vez después.
    medir();
    const t = setTimeout(medir, 180);
    return () => clearTimeout(t);
  });
  $effect(() => {
    if (!project.playing) return;
    const id = setInterval(medir, 160);
    return () => clearInterval(id);
  });
</script>

<div class="border-b border-border px-3 py-2 text-xs">
  <div class="mb-2 flex items-center gap-1.5">
    <h3 class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
      <Activity size={12} /> Scopes
    </h3>
    <div class="ml-auto flex gap-0.5">
      {#each KINDS as k (k.id)}
        <button class="kind" class:active={ui.scope === k.id} onclick={() => (ui.scope = k.id)}>{k.name}</button>
      {/each}
    </div>
  </div>
  <div class="relative">
    <canvas bind:this={canvas} width="512" height="288" class="block w-full rounded bg-black" style="aspect-ratio:16/9"></canvas>
    {#if vacio}
      <p class="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-500">Sin vídeo en V1 bajo el playhead</p>
    {/if}
  </div>
</div>

<style>
  .kind {
    border-radius: 5px;
    padding: 1px 6px;
    font-size: 10px;
    color: var(--muted);
  }
  .kind.active {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
</style>
