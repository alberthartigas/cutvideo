<script lang="ts">
  import type { MediaInfo } from "$lib/tauri/media";
  import { clipDuration, type Clip } from "$lib/project.svelte";
  import { formatBitrate, formatBytes, formatDuration, formatFps } from "$lib/format";

  let { media, clip = null }: { media: MediaInfo | null; clip?: Clip | null } = $props();
  // ffprobe devuelve listas tipo "mov,mp4,m4a,3gp,3g2,mj2"; la extensión es más legible.
  let container = $derived(
    media ? `${(media.fileName.split(".").pop() ?? "").toUpperCase()} · ${media.container}` : "",
  );
</script>

{#snippet row(label: string, value: string)}
  <div class="flex items-baseline justify-between gap-3 py-1">
    <dt class="shrink-0 text-muted">{label}</dt>
    <dd class="truncate text-right" title={value}>{value}</dd>
  </div>
{/snippet}

{#snippet section(title: string)}
  <h3 class="mt-3 mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
{/snippet}

<div class="flex-1 overflow-auto px-3 py-2 text-xs">
  {#if clip}
    <dl>
      {@render section("Clip")}
      {@render row("Nombre", clip.name)}
      {@render row("Posición", formatDuration(clip.start))}
      {@render row("Duración", formatDuration(clipDuration(clip)))}
      {@render row("Entrada", formatDuration(clip.in))}
      {@render row("Salida", formatDuration(clip.out))}
    </dl>
  {/if}
  {#if media}
    <dl>
      {@render section(clip ? "Archivo de origen" : "Archivo")}
      {@render row("Archivo", media.fileName)}
      {@render row("Contenedor", container)}
      {@render row("Duración", formatDuration(media.durationSec))}
      {@render row("Tamaño", formatBytes(media.sizeBytes))}
      {@render row("Bitrate", formatBitrate(media.bitRate))}

      {#if media.video}
        {@render section(`Vídeo${media.videoStreamCount > 1 ? ` (${media.videoStreamCount} pistas)` : ""}`)}
        {@render row("Códec", media.video.codecLong || media.video.codec)}
        {@render row("Resolución", `${media.video.width} × ${media.video.height}`)}
        {@render row("FPS", formatFps(media.video.fps))}
        {@render row("Formato de píxel", media.video.pixFmt ?? "—")}
        {@render row("Rotación", `${media.video.rotation}°`)}
        {@render row("Frames", media.video.frameCount?.toLocaleString("es") ?? "—")}
      {/if}

      {#if media.audio}
        {@render section(`Audio${media.audioStreamCount > 1 ? ` (${media.audioStreamCount} pistas)` : ""}`)}
        {@render row("Códec", media.audio.codecLong || media.audio.codec)}
        {@render row("Muestreo", media.audio.sampleRate ? `${media.audio.sampleRate} Hz` : "—")}
        {@render row("Canales", media.audio.channels?.toString() ?? "—")}
        {@render row("Layout", media.audio.channelLayout ?? "—")}
      {/if}
    </dl>
  {:else if !clip}
    <p class="py-6 text-center text-muted">Selecciona un archivo o un clip para ver sus datos</p>
  {/if}
</div>
