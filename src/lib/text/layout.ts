import type { TextData } from "./styles";

export interface FrameSize {
  width: number;
  height: number;
  fps: number;
}

export interface LayoutChar {
  ch: string;
  /** Posición del glifo (x izquierda, y línea base) en píxeles del frame. */
  x: number;
  y: number;
  w: number;
  /** Índices para las animaciones (los espacios no cuentan como letra). */
  index: number;
  word: number;
  line: number;
}

export interface TextLayout {
  font: string;
  fontPx: number;
  lineHeight: number;
  ascent: number;
  descent: number;
  chars: LayoutChar[];
  charCount: number;
  wordCount: number;
  lineCount: number;
  /** Caja del bloque (sin margen). */
  box: { x: number; y: number; w: number; h: number };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function fontString(data: TextData, fontPx: number): string {
  return `${data.bold ? "700" : "400"} ${fontPx}px ${data.fontFamily}`;
}

/** Ajusta el texto a líneas y coloca cada letra. Determinista: mismo resultado en preview y export. */
export function layoutText(ctx: Ctx, data: TextData, frame: { width: number; height: number }): TextLayout {
  const fontPx = Math.max(4, data.fontSize * frame.height);
  const font = fontString(data, fontPx);
  ctx.font = font;
  const measure = (s: string) => ctx.measureText(s).width;
  const spaceW = measure(" ");
  const maxWidth = Math.max(fontPx, frame.width * data.maxWidth);
  const lineHeight = fontPx * 1.2;

  // Ajuste de línea por palabras; "\n" fuerza salto.
  const lines: string[][] = [];
  for (const para of data.text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line: string[] = [];
    let width = 0;
    for (const w of words) {
      const ww = measure(w);
      const add = line.length ? spaceW + ww : ww;
      if (line.length && width + add > maxWidth) {
        lines.push(line);
        line = [w];
        width = ww;
      } else {
        line.push(w);
        width += add;
      }
    }
    lines.push(line);
  }

  const m = ctx.measureText("Hg");
  const ascent = m.fontBoundingBoxAscent || fontPx * 0.8;
  const descent = m.fontBoundingBoxDescent || fontPx * 0.2;
  const lineWidths = lines.map((ws) => ws.reduce((s, w, i) => s + measure(w) + (i ? spaceW : 0), 0));
  const blockW = Math.max(0, ...lineWidths);
  const blockH = lines.length * lineHeight;
  const cx = data.x * frame.width;
  const top = data.y * frame.height - blockH / 2;

  const chars: LayoutChar[] = [];
  let index = 0;
  let word = 0;
  lines.forEach((ws, li) => {
    const lineW = lineWidths[li];
    let x =
      data.align === "left" ? cx - blockW / 2 : data.align === "right" ? cx + blockW / 2 - lineW : cx - lineW / 2;
    const y = top + li * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent;
    ws.forEach((w, wi) => {
      if (wi > 0) x += spaceW;
      for (const ch of w) {
        const cw = measure(ch);
        chars.push({ ch, x, y, w: cw, index: index++, word, line: li });
        x += cw;
      }
      word++;
    });
  });

  return {
    font,
    fontPx,
    lineHeight,
    ascent,
    descent,
    chars,
    charCount: index,
    wordCount: word,
    lineCount: lines.length,
    box: { x: cx - blockW / 2, y: top, w: blockW, h: blockH },
  };
}
