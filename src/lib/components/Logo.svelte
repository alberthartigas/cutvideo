<script lang="ts">
  /**
   * Logotipo de CutVideo. La "C" está trazada sobre las medidas del logotipo
   * original: cuerpo del anillo más los dos trocitos cortados, y el play dentro.
   * El mismo dibujo que el icono de la app (app-icon.svg).
   */
  let { class: className = "h-5" }: { class?: string } = $props();
</script>

<svg class={className} viewBox="0 0 336 64" fill="none" role="img" aria-label="CutVideo">
  <g transform="translate(32 32) scale(0.078) translate(-512 -512)">
    <g fill="currentColor">
      <path d="M753.2 831.1A400.0 400.0 0 1 1 735.6 180.3L652.3 303.9A250.9 250.9 0 1 0 663.3 712.2Z" />
      <path d="M779.7 214.8A400.0 400.0 0 0 1 839.1 281.8L717.2 367.6A250.9 250.9 0 0 0 679.9 325.6Z" />
      <path d="M841.9 738.1A400.0 400.0 0 0 1 790.0 799.6L686.4 692.4A250.9 250.9 0 0 0 719.0 653.9Z" />
    </g>
    <path
      fill="var(--brand-violet)"
      stroke="var(--brand-violet)"
      stroke-width="14"
      stroke-linejoin="round"
      d="M430.0 390.3L648.6 521.9L430.0 658.6Z"
    />
  </g>
  <text
    x="72"
    y="45"
    font-family="Inter, system-ui, -apple-system, sans-serif"
    font-size="40"
    font-weight="700"
    letter-spacing="-1.2"
  >
    <tspan fill="currentColor">Cut</tspan><tspan fill="var(--brand-violet)">Video</tspan>
  </text>
</svg>
