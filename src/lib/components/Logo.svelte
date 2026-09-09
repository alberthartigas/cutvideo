<script lang="ts">
  /**
   * Logotipo de CutVideo. La "C" está trazada sobre las medidas del logotipo
   * original: cuerpo del anillo más los dos trocitos cortados, y el play dentro.
   * Mismo dibujo que el icono de la app (app-icon.svg); aquí la C toma el color
   * del texto para que se lea en el tema claro y en el oscuro.
   */
  let { class: className = "h-5" }: { class?: string } = $props();
</script>

<svg class={className} viewBox="0 0 336 64" fill="none" role="img" aria-label="CutVideo">
  <g transform="translate(32 32) scale(0.0918) translate(-512 -512)">
    <g fill="currentColor">
      <path d="M717.0 783.3A340.0 340.0 0 1 1 702.0 230.1L631.2 335.1A213.3 213.3 0 1 0 640.6 682.2Z" />
      <path d="M739.6 259.4A340.0 340.0 0 0 1 790.1 316.3L686.4 389.3A213.3 213.3 0 0 0 654.8 353.5Z" />
      <path d="M792.4 704.2A340.0 340.0 0 0 1 748.3 756.5L660.2 665.4A213.3 213.3 0 0 0 687.9 632.6Z" />
    </g>
    <path
      fill="var(--brand-violet)"
      stroke="var(--brand-violet)"
      stroke-width="12"
      stroke-linejoin="round"
      d="M442.3 408.5L628.1 520.4L442.3 636.6Z"
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
