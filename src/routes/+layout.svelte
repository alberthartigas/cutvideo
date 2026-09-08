<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { theme } from "$lib/theme.svelte";

  let { children } = $props();

  onMount(() => theme.init());
  // Cada cambio de modo o de preferencia del sistema vuelve a aplicar el tema.
  $effect(() => {
    theme.apply();
  });
</script>

{@render children?.()}
