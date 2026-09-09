import { BASE_STATE, getAnimation, type AnimContext, type TextAnimation, type UnitState } from "./animations";
import { layoutText, type LayoutChar, type TextLayout } from "./layout";
import type { TextData } from "./styles";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TextClipLike {
  start: number;
  in: number;
  out: number;
  text?: TextData | null;
}

// Pequeña caché de layouts: el texto y el estilo cambian poco entre frames.
const layoutCache = new Map<string, TextLayout>();
function getLayout(ctx: Ctx, data: TextData, frame: { width: number; height: number }): TextLayout {
  const key = JSON.stringify([
    data.text, data.fontFamily, data.fontSize, data.bold, data.align, data.maxWidth, data.x, data.y, frame.width, frame.height,
  ]);
  let layout = layoutCache.get(key);
  if (!layout) {
    layout = layoutText(ctx, data, frame);
    if (layoutCache.size > 64) layoutCache.delete(layoutCache.keys().next().value!);
    layoutCache.set(key, layout);
  }
  return layout;
}

function unitInfo(anim: TextAnimation, c: LayoutChar, layout: TextLayout) {
  switch (anim.unit) {
    case "char":
      return { i: c.index, n: layout.charCount };
    case "word":
      return { i: c.word, n: layout.wordCount };
    case "line":
      return { i: c.line, n: layout.lineCount };
    default:
      return { i: 0, n: 1 };
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixColor(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Dibuja un clip de texto en el instante local `u` (segundos desde su inicio). */
export function drawTextClip(ctx: Ctx, data: TextData, u: number, duration: number, frame: { width: number; height: number }) {
  const layout = getLayout(ctx, data, frame);
  const inDur = Math.min(data.inDur, duration / 2);
  const outDur = Math.min(data.outDur, duration / 2);

  let phase: TextAnimation | null = null;
  let p = 1;
  if (inDur > 0 && u < inDur) {
    phase = getAnimation(data.animIn);
    p = u / inDur;
  } else if (outDur > 0 && duration - u < outDur) {
    phase = getAnimation(data.animOut);
    p = (duration - u) / outDur;
  }
  const emphasis = data.emphasis !== "none" ? getAnimation(data.emphasis) : null;
  const ep = duration > 0 ? u / duration : 1;
  const anim: AnimContext = { time: u, duration, wordTimes: data.wordTimes };

  const states: UnitState[] = layout.chars.map((c) => {
    const s = { ...BASE_STATE };
    if (phase) Object.assign(s, phase.state(p, unitInfo(phase, c, layout), anim));
    if (emphasis) Object.assign(s, emphasis.state(ep, unitInfo(emphasis, c, layout), anim));
    return s;
  });

  const { fontPx } = layout;
  ctx.save();
  ctx.font = layout.font;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  if (data.box && layout.chars.length) {
    const pad = fontPx * 0.3;
    const visible = states.reduce((m, s) => Math.max(m, s.opacity), 0);
    ctx.globalAlpha = visible * data.boxOpacity;
    ctx.fillStyle = data.boxColor;
    roundRect(ctx, layout.box.x - pad, layout.box.y - pad * 0.6, layout.box.w + pad * 2, layout.box.h + pad * 1.2, fontPx * 0.2);
    ctx.fill();
  }

  // Cajas detrás de la palabra actual (estilo "palabra resaltada").
  const wordBoxes = new Map<number, { x0: number; x1: number; y: number; alpha: number }>();
  layout.chars.forEach((c, k) => {
    const s = states[k];
    if (s.box <= 0.001) return;
    const wb = wordBoxes.get(c.word);
    if (wb) {
      wb.x0 = Math.min(wb.x0, c.x);
      wb.x1 = Math.max(wb.x1, c.x + c.w);
      wb.alpha = Math.max(wb.alpha, s.box * s.opacity);
    } else {
      wordBoxes.set(c.word, { x0: c.x, x1: c.x + c.w, y: c.y, alpha: s.box * s.opacity });
    }
  });
  for (const wb of wordBoxes.values()) {
    const pad = fontPx * 0.12;
    ctx.save();
    ctx.globalAlpha = wb.alpha;
    ctx.fillStyle = data.wordBoxColor ?? data.highlightColor;
    roundRect(ctx, wb.x0 - pad, wb.y - layout.ascent * 0.95 - pad * 0.5, wb.x1 - wb.x0 + pad * 2, layout.ascent * 0.95 + layout.descent * 0.6 + pad, fontPx * 0.15);
    ctx.fill();
    ctx.restore();
  }

  layout.chars.forEach((c, k) => {
    const s = states[k];
    if (s.opacity <= 0.001) return;
    // Pivote en el centro visual de la letra para que escala y giro sean naturales.
    const px = c.x + c.w / 2;
    const py = c.y - layout.ascent * 0.35;
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.translate(px + s.dx * fontPx, py + s.dy * fontPx);
    if (s.rotate) ctx.rotate((s.rotate * Math.PI) / 180);
    const sx = s.scale * s.scaleX;
    const sy = s.scale * s.scaleY;
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.translate(-px, -py);
    if (s.blur > 0.001 && "filter" in ctx) ctx.filter = `blur(${(s.blur * fontPx).toFixed(1)}px)`;
    if (data.glow) {
      ctx.shadowColor = data.color;
      ctx.shadowBlur = fontPx * 0.45;
    } else if (data.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = fontPx * 0.12;
      ctx.shadowOffsetY = fontPx * 0.04;
    }
    if (data.stroke > 0) {
      ctx.lineJoin = "round";
      ctx.lineWidth = data.stroke * fontPx;
      ctx.strokeStyle = data.strokeColor;
      ctx.strokeText(c.ch, c.x, c.y);
    }
    ctx.fillStyle = s.highlight > 0 ? mixColor(data.color, data.highlightColor, s.highlight) : data.color;
    ctx.fillText(c.ch, c.x, c.y);
    // Segunda pasada del neón para intensificar el halo.
    if (data.glow) ctx.fillText(c.ch, c.x, c.y);
    ctx.restore();
  });
  ctx.restore();
}

/** Limpia el canvas y dibuja todos los clips de texto activos en el instante `t`. */
export function renderTextClips(ctx: Ctx, clips: TextClipLike[], t: number, frame: { width: number; height: number }) {
  ctx.clearRect(0, 0, frame.width, frame.height);
  for (const clip of clips) {
    if (!clip.text) continue;
    const duration = clip.out - clip.in;
    const u = t - clip.start;
    if (u < 0 || u >= duration) continue;
    drawTextClip(ctx, clip.text, u, duration, frame);
  }
}
