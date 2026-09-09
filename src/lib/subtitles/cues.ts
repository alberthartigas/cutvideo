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
  /** Cómo se ve en CapCut, para orientarse. */
  hint: string;
  data: TextData;
  cue?: Partial<CueOptions>;
}

const base: TextData = {
  ...DEFAULT_TEXT,
  text: "",
  fontSize: 0.055,
  y: 0.88,
  maxWidth: 0.8,
  animIn: "fade",
  animOut: "fade",
  inDur: 0.08,
  outDur: 0.08,
  emphasis: "none",
};

const IMPACT = 'Impact, "Arial Black", Haettenschweiler, sans-serif';

/** Estilos de subtítulo inspirados en las plantillas más usadas de CapCut. */
export const SUBTITLE_STYLES: SubtitleStyle[] = [
  {
    id: "classic",
    name: "Clásico TikTok",
    hint: "Blanco, negrita, borde negro y sombra",
    data: { ...base, stroke: 0.06, strokeColor: "#000000", shadow: true },
  },
  {
    id: "karaoke",
    name: "Karaoke amarillo",
    hint: "Las palabras se van tiñendo de amarillo al pronunciarse",
    data: { ...base, stroke: 0.06, shadow: true, emphasis: "karaoke", highlightColor: "#ffd166" },
  },
  {
    id: "wordbox",
    name: "Palabra en caja",
    hint: "La palabra actual lleva una caja de color (estilo Hormozi)",
    data: { ...base, fontFamily: IMPACT, bold: false, stroke: 0.05, shadow: true, emphasis: "wordbox", wordBoxColor: "#16a34a", fontSize: 0.06 },
  },
  {
    id: "wordpop",
    name: "Pop por palabra",
    hint: "Cada palabra salta al pronunciarse y queda resaltada",
    data: { ...base, stroke: 0.06, shadow: true, emphasis: "wordpop", highlightColor: "#ffd166" },
  },
  {
    id: "wordbounce",
    name: "Rebote por palabra",
    hint: "Cada palabra da un botecito al pronunciarse",
    data: { ...base, stroke: 0.06, shadow: true, emphasis: "wordbounce", highlightColor: "#7cf0ff" },
  },
  {
    id: "oneword",
    name: "Palabra a palabra",
    hint: "Una palabra grande en el centro, estilo Shorts",
    data: { ...base, fontFamily: IMPACT, bold: false, fontSize: 0.12, y: 0.5, stroke: 0.06, shadow: true, animIn: "pop", inDur: 0.14, animOut: "none" },
    cue: { maxWords: 1 },
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
    data: { ...base, color: "#ffe135", shadow: false, box: true, boxColor: "#000000", boxOpacity: 0.85, highlightColor: "#ffffff" },
  },
  {
    id: "neon",
    name: "Neón",
    hint: "Texto con resplandor de color",
    data: { ...base, color: "#ff5ec4", glow: true, shadow: false, stroke: 0, highlightColor: "#ffffff" },
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
    hint: "Serif, blanco con sombra, para vlogs y lifestyle",
    data: { ...base, fontFamily: 'Georgia, "Times New Roman", serif', bold: false, fontSize: 0.05, shadow: true, stroke: 0, animIn: "fadezoom", inDur: 0.2 },
  },
];
