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
}

export const DEFAULT_CUE_OPTIONS: CueOptions = {
  maxChars: 38,
  maxLines: 2,
  maxDuration: 5,
  gap: 0.7,
  minDuration: 0.8,
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
    const end = Math.max(group[group.length - 1].end, start + o.minDuration);
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
      if (chars > maxTotal || pause > o.gap || duration > o.maxDuration || sentence || clause) flush();
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
  data: TextData;
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

export const SUBTITLE_STYLES: SubtitleStyle[] = [
  { id: "classic", name: "Clásico", data: { ...base, stroke: 0.06, strokeColor: "#000000", shadow: true } },
  { id: "box", name: "Caja", data: { ...base, shadow: false, box: true, boxColor: "#000000", boxOpacity: 0.7 } },
  { id: "yellow", name: "Amarillo", data: { ...base, color: "#ffe066", stroke: 0.06, strokeColor: "#000000", highlightColor: "#ffffff" } },
];
