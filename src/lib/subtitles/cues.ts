import { DEFAULT_TEXT, type TextData } from "$lib/text/styles";

export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Cue {
  text: string;
  start: number;
  end: number;
  wordTimes?: [number, number][];
}

export interface CueOptions {
  /** Caracteres máximos por línea. */
  maxChars: number;
  maxLines: number;
  /** Duración máxima de un subtítulo (s). */
  maxDuration: number;
  /** Pausa entre palabras que fuerza un corte (s). */
  gap: number;
  /** Duración mínima de un subtítulo (s). */
  minDuration: number;
  /** Palabras máximas por subtítulo (0 = sin límite). Para estilos "palabra a palabra". */
  maxWords: number;
}

export const DEFAULT_CUE_OPTIONS: CueOptions = {
  maxChars: 38,
  maxLines: 2,
  maxDuration: 5,
  gap: 0.7,
  minDuration: 0.8,
  maxWords: 0,
};

const endsSentence = (w: string) => /[.!?…]["»)]?$/.test(w);
const endsClause = (w: string) => /[,;:]["»)]?$/.test(w);

/** Parte un texto en hasta `maxLines` líneas equilibradas de como mucho `maxChars`. */
export function breakLines(words: string[], maxChars: number, maxLines: number): string {
  const total = words.join(" ").length;
  if (total <= maxChars || maxLines <= 1) return words.join(" ");
  const target = Math.ceil(total / Math.min(maxLines, Math.ceil(total / maxChars)));
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > Math.max(target, maxChars * 0.6) && lines.length < maxLines - 1) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

/** Agrupa palabras con tiempos en subtítulos legibles, sin solapes entre ellos. */
export function buildCues(words: Word[], options: Partial<CueOptions> = {}): Cue[] {
  const o = { ...DEFAULT_CUE_OPTIONS, ...options };
  const maxTotal = o.maxChars * o.maxLines;
  const cues: Cue[] = [];
  let group: Word[] = [];

  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    const end = Math.max(group[group.length - 1].end, start + (o.maxWords === 1 ? 0.25 : o.minDuration));
    cues.push({
      text: breakLines(group.map((w) => w.word), o.maxChars, o.maxLines),
      start,
      end,
      wordTimes: group.map((w) => [w.start - start, w.end - start]),
    });
    group = [];
  };

  for (const w of words) {
    if (group.length) {
      const prev = group[group.length - 1];
      const chars = group.reduce((n, g) => n + g.word.length + 1, 0) + w.word.length;
      const pause = w.start - prev.end;
      const duration = w.end - group[0].start;
      const sentence = endsSentence(prev.word) && chars > 12;
      const clause = endsClause(prev.word) && chars > maxTotal * 0.6;
      const full = o.maxWords > 0 && group.length >= o.maxWords;
      if (chars > maxTotal || pause > o.gap || duration > o.maxDuration || sentence || clause || full) flush();
    }
    group.push(w);
  }
  flush();

  // Sin solapes: cada subtítulo termina antes de que empiece el siguiente.
  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].end = Math.min(cues[i].end, cues[i + 1].start - 0.02);
    if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 0.1;
  }
  return cues;
}

/** Sin tiempos por palabra: un subtítulo por segmento (con líneas equilibradas). */
export function cuesFromSegments(segments: Segment[], options: Partial<CueOptions> = {}): Cue[] {
  const o = { ...DEFAULT_CUE_OPTIONS, ...options };
  const cues = segments
    .filter((s) => s.text.trim())
    .map((s) => ({
      text: breakLines(s.text.trim().split(/\s+/), o.maxChars, o.maxLines),
      start: s.start,
      end: Math.max(s.end, s.start + o.minDuration),
    }));
  for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.min(cues[i].end, cues[i + 1].start - 0.02);
  return cues;
}

export interface SubtitleStyle {
  id: string;
  name: string;
  /** Cómo se ve, para orientarse. */
  hint: string;
  data: TextData;
  cue?: Partial<CueOptions>;
}

const IMPACT = 'Impact, "Arial Black", Haettenschweiler, sans-serif';
const GROTESCA = '"Montserrat", "Helvetica Neue", "Arial Black", system-ui, sans-serif';

const base: TextData = {
  ...DEFAULT_TEXT,
  text: "",
  fontSize: 0.055,
  y: 0.82,
  maxWidth: 0.86,
  animIn: "fade",
  animOut: "fade",
  inDur: 0.08,
  outDur: 0.08,
  emphasis: "none",
};

/**
 * Estilos de subtítulo. Los primeros son los que usan los vídeos que funcionan
 * en redes: pocas palabras en pantalla, MAYÚSCULAS, letra gorda y la palabra
 * que se está diciendo destacada (crece, salta o se pinta de color).
 */
export const SUBTITLE_STYLES: SubtitleStyle[] = [
  {
    // El de serie. Los estilos de redes son ruidosos a propósito; para un
    // vídeo que quiere que se vea la imagen, mejor una frase pequeña abajo que
    // entra y sale deslizándose y no se queda estorbando.
    id: "discreto",
    name: "Discreto",
    hint: "Pequeño y abajo; la frase entra y sale deslizándose",
    data: {
      ...base,
      fontSize: 0.038,
      y: 0.86,
      maxWidth: 0.86,
      stroke: 0.035,
      strokeColor: "#000000",
      shadow: true,
      box: true,
      boxColor: "#000000",
      boxOpacity: 0.35,
      animIn: "slide",
      animOut: "slide",
      inDur: 0.22,
      outDur: 0.18,
      emphasis: "none",
    },
    cue: { maxWords: 7, maxChars: 30, maxLines: 2 },
  },
  {
    id: "viral",
    name: "Viral",
    hint: "La palabra que se dice crece y se pinta de amarillo",
    data: {
      ...base,
      fontFamily: GROTESCA,
      uppercase: true,
      fontSize: 0.075,
      y: 0.74,
      stroke: 0.07,
      strokeColor: "#000000",
      shadow: true,
      emphasis: "wordgrow",
      highlightColor: "#ffd60a",
    },
    cue: { maxWords: 4, maxChars: 22, maxLines: 2 },
  },
  {
    id: "hormozi",
    name: "Hormozi",
    hint: "Mayúsculas gordas con caja de color saltando de palabra en palabra",
    data: {
      ...base,
      fontFamily: IMPACT,
      bold: false,
      uppercase: true,
      fontSize: 0.08,
      y: 0.72,
      stroke: 0.055,
      shadow: true,
      emphasis: "wordbox",
      wordBoxColor: "#22c55e",
      highlightColor: "#ffffff",
    },
    cue: { maxWords: 3, maxChars: 18, maxLines: 2 },
  },
  {
    id: "golpe",
    name: "Golpe",
    hint: "Cada palabra entra con un golpe y una sacudida corta",
    data: {
      ...base,
      fontFamily: GROTESCA,
      uppercase: true,
      fontSize: 0.075,
      y: 0.74,
      stroke: 0.07,
      shadow: true,
      emphasis: "wordpunch",
      highlightColor: "#ff375f",
    },
    cue: { maxWords: 3, maxChars: 20, maxLines: 2 },
  },
  {
    id: "beast",
    name: "Beast",
    hint: "Enorme, amarillo y con borde negro grueso",
    data: {
      ...base,
      fontFamily: IMPACT,
      bold: false,
      uppercase: true,
      fontSize: 0.095,
      y: 0.7,
      color: "#ffd60a",
      stroke: 0.09,
      strokeColor: "#000000",
      shadow: true,
      emphasis: "wordpunch",
      highlightColor: "#ffffff",
    },
    cue: { maxWords: 3, maxChars: 16, maxLines: 2 },
  },
  {
    id: "oneword",
    name: "Palabra a palabra",
    hint: "Una sola palabra enorme en el centro, estilo Shorts",
    data: {
      ...base,
      fontFamily: IMPACT,
      bold: false,
      uppercase: true,
      fontSize: 0.13,
      y: 0.5,
      stroke: 0.07,
      shadow: true,
      animIn: "pop",
      inDur: 0.12,
      animOut: "none",
    },
    cue: { maxWords: 1 },
  },
  {
    id: "sube",
    name: "Sube",
    hint: "La palabra que se dice sube y se ilumina",
    data: {
      ...base,
      fontFamily: GROTESCA,
      uppercase: true,
      fontSize: 0.07,
      y: 0.76,
      stroke: 0.06,
      shadow: true,
      emphasis: "wordrise",
      highlightColor: "#7cf0ff",
    },
    cue: { maxWords: 4, maxChars: 24, maxLines: 2 },
  },
  {
    id: "karaoke",
    name: "Karaoke",
    hint: "Las palabras se van tiñendo según se pronuncian",
    data: { ...base, stroke: 0.06, shadow: true, emphasis: "karaoke", highlightColor: "#ffd166" },
    cue: { maxWords: 6, maxChars: 30 },
  },
  {
    id: "neon",
    name: "Neón",
    hint: "Resplandor de color, para vídeos de noche o gaming",
    data: {
      ...base,
      fontFamily: GROTESCA,
      uppercase: true,
      fontSize: 0.07,
      color: "#ff5ec4",
      glow: true,
      shadow: false,
      stroke: 0,
      emphasis: "wordgrow",
      highlightColor: "#ffffff",
    },
    cue: { maxWords: 4, maxChars: 22 },
  },
  {
    id: "classic",
    name: "Clásico TikTok",
    hint: "Blanco, negrita, borde negro y sombra",
    data: { ...base, stroke: 0.06, strokeColor: "#000000", shadow: true },
  },
  {
    id: "box",
    name: "Caja negra",
    hint: "Blanco sobre una caja negra semitransparente",
    data: { ...base, shadow: false, box: true, boxColor: "#000000", boxOpacity: 0.7 },
  },
  {
    id: "readable",
    name: "Amarillo legible",
    hint: "Amarillo en negrita sobre caja negra (el más legible en móvil)",
    data: {
      ...base,
      color: "#ffe135",
      shadow: false,
      box: true,
      boxColor: "#000000",
      boxOpacity: 0.85,
      highlightColor: "#ffffff",
    },
  },
  {
    id: "typewriter",
    name: "Máquina de escribir",
    hint: "Cada subtítulo se escribe letra a letra",
    data: { ...base, stroke: 0.06, shadow: true, animIn: "typewriter", inDur: 0.45 },
  },
  {
    id: "minimal",
    name: "Minimal",
    hint: "Pequeño, sin borde, caja muy suave",
    data: { ...base, fontSize: 0.042, bold: false, shadow: false, box: true, boxColor: "#000000", boxOpacity: 0.35 },
  },
  {
    id: "elegant",
    name: "Elegante",
    hint: "Serif con sombra, para vlogs y lifestyle",
    data: {
      ...base,
      fontFamily: 'Georgia, "Times New Roman", serif',
      bold: false,
      fontSize: 0.05,
      shadow: true,
      stroke: 0,
      animIn: "fadezoom",
      inDur: 0.2,
    },
  },
];
