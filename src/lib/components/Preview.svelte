<script lang="ts">
  import { mediaSrc, type MediaInfo } from "$lib/tauri/media";

  let { media }: { media: MediaInfo | null } = $props();
  let src = $derived(media ? mediaSrc(media.path) : null);
</script>

<div class="flex h-full w-full items-center justify-center bg-black">
  {#if src && media}
    {#key src}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video {src} controls playsinline class="max-h-full max-w-full" title={media.fileName}></video>
    {/key}
  {:else}
    <p class="text-sm text-neutral-500">Importa un vídeo para previsualizarlo</p>
  {/if}
</div>
