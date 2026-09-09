/** Datos de un clip de texto. Medidas normalizadas al frame (0–1) para que escalen con la resolución. */
export interface TextData {
  text: string;
  fontFamily: string;
  /** Tamaño de fuente como fracción de la altura del frame (0.08 ≈ 86 px en 1080p). */
  fontSize: number;
  bold: boolean;
  color: string;
  /** Grosor del borde en "em" (0 = sin borde). */
  stroke: number;
  strokeColor: string;
  shadow: boolean;
  box: boolean;
  boxColor: string;
  boxOpacity: number;
  /** Color del resaltado (karaoke). */
  highlightColor: string;
  /** Color de la caja detrás de la palabra actual (emphasis "wordbox"); por defecto, el del resaltado. */
  wordBoxColor?: string;
  /** Resplandor tipo neón del color del texto. */
  glow?: boolean;
  /** Pasa el texto a MAYÚSCULAS al dibujarlo (los subtítulos virales las usan). */
  uppercase?: boolean;
  /** Centro del bloque de texto, normalizado (0.5, 0.5 = centro del frame). */
  x: number;
  y: number;
  align: "left" | "center" | "right";
  /** Ancho máximo del bloque como fracción del ancho del frame. */
  maxWidth: number;
  animIn: string;
  animOut: string;
  emphasis: string;
  inDur: number;
  outDur: number;
  /** Subtítulos: [inicio, fin] de cada palabra en segundos relativos al clip (para el karaoke exacto). */
  wordTimes?: [number, number][];
}

export const FONTS: { label: string; value: string }[] = [
  { label: "Sans (sistema)", value: '"Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif' },
  { label: "Impact", value: 'Impact, "Arial Black", Haettenschweiler, sans-serif' },
  { label: "Serif", value: 'Georgia, "Times New Roman", serif' },
  { label: "Mono", value: '"SF Mono", Menlo, Consolas, "Courier New", monospace' },
  { label: "Redondeada", value: '"Avenir Next Rounded", "Arial Rounded MT Bold", "Segoe UI", sans-serif' },
];

export const DEFAULT_TEXT: TextData = {
  text: "Tu texto",
  fontFamily: FONTS[0].value,
  fontSize: 0.08,
  bold: true,
  color: "#ffffff",
  stroke: 0,
  strokeColor: "#000000",
  shadow: true,
  box: false,
  boxColor: "#000000",
  boxOpacity: 0.6,
  highlightColor: "#ffd166",
  x: 0.5,
  y: 0.5,
  align: "center",
  maxWidth: 0.85,
  animIn: "pop",
  animOut: "fade",
  emphasis: "none",
  inDur: 0.6,
  outDur: 0.4,
};

export const TEXT_DEFAULT_DURATION = 3;
