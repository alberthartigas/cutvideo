import { hexToRgb, type ChromaKey } from "$lib/effects/chroma";
import type { Mask } from "$lib/segment/segmenter.svelte";
import { LUT_SIZE } from "$lib/effects/grade.svelte";

/**
 * Dibuja una capa de vídeo en un canvas aplicándole la corrección de color
 * (un LUT 3D horneado en Rust) y transparencia: por color (pantalla verde)
 * y/o por recorte de persona.
 *
 * Va por WebGL porque hacerlo píxel a píxel en JavaScript no aguanta 30 fps
 * a 1080p. El croma usa la misma medida que el filtro `chromakey` de ffmpeg
 * (distancia en el plano de color UV) para que el preview y el vídeo exportado
 * se parezcan.
 */
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) / 2.0, (1.0 - a_pos.y) / 2.0);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_lut;
uniform float u_useLut;
uniform sampler2D u_mask;
uniform vec3 u_key;
uniform float u_similarity;
uniform float u_blend;
uniform float u_spill;
uniform float u_useChroma;
uniform float u_useMask;
uniform float u_feather;
varying vec2 v_uv;

// WebGL 1 no tiene texturas 3D: el cubo va en una tira de N cortes de N×N
// (rojo en horizontal dentro del corte, verde en vertical, un corte por cada
// azul). El filtro lineal interpola rojo y verde; el azul, a mano entre dos
// cortes. Es interpolación trilineal, la misma que pide el export a lut3d.
const float N = ${LUT_SIZE}.0;
vec3 lut(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * (N - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, N - 1.0);
  float x = c.r * (N - 1.0) + 0.5;
  float y = (c.g * (N - 1.0) + 0.5) / N;
  vec3 s0 = texture2D(u_lut, vec2((b0 * N + x) / (N * N), y)).rgb;
  vec3 s1 = texture2D(u_lut, vec2((b1 * N + x) / (N * N), y)).rgb;
  return mix(s0, s1, b - b0);
}

vec2 uv_of(vec3 c) {
  return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}

void main() {
  vec4 px = texture2D(u_tex, v_uv);
  float alpha = 1.0;
  vec3 rgb = px.rgb;
  // Primero el color, luego el croma: en el export lut3d va antes de chromakey.
  if (u_useLut > 0.5) rgb = lut(rgb);

  if (u_useChroma > 0.5) {
    float d = distance(uv_of(rgb), uv_of(u_key));
    alpha *= smoothstep(u_similarity, u_similarity + max(u_blend, 0.001), d);
    if (u_spill > 0.0 && alpha > 0.0) {
      float g = max(rgb.g - max(rgb.r, rgb.b), 0.0) * u_spill;
      rgb.g -= g;
      rgb.r += g * 0.4;
      rgb.b += g * 0.4;
    }
  }

  if (u_useMask > 0.5) {
    // La máscara da la probabilidad de "persona"; feather suaviza el borde.
    float m = texture2D(u_mask, v_uv).r;
    float half_w = max(u_feather * 0.5, 0.01);
    alpha *= smoothstep(0.5 - half_w, 0.5 + half_w, m);
  }

  gl_FragColor = vec4(rgb, alpha);
}`;

export class LayerRenderer {
  #gl: WebGLRenderingContext | null = null;
  #tex: WebGLTexture | null = null;
  #maskTex: WebGLTexture | null = null;
  #lutTex: WebGLTexture | null = null;
  /** Cubo que hay ahora en la textura, para no resubirlo en cada frame. */
  #lutData: Uint8Array | null = null;
  #u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement) {}

  /** Prepara WebGL. Devuelve false si el WebView no lo soporta. */
  init(): boolean {
    if (this.#gl) return true;
    const gl = this.canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });
    if (!gl) return false;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[CutVideo] shader:", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const makeTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.#tex = makeTex();
    this.#maskTex = makeTex();
    this.#lutTex = makeTex();

    for (const name of [
      "u_tex", "u_mask", "u_key", "u_similarity", "u_blend", "u_spill",
      "u_useChroma", "u_useMask", "u_feather", "u_lut", "u_useLut",
    ]) {
      this.#u[name] = gl.getUniformLocation(prog, name);
    }
    gl.uniform1i(this.#u.u_tex!, 0);
    gl.uniform1i(this.#u.u_mask!, 1);
    gl.uniform1i(this.#u.u_lut!, 2);
    this.#gl = gl;
    return true;
  }

  /** Pinta un frame con el color, el croma y/o el recorte aplicados. */
  draw(
    video: HTMLVideoElement,
    opts: { chroma?: ChromaKey; mask?: Mask | null; feather?: number; lut?: Uint8Array | null },
  ) {
    const gl = this.#gl;
    if (!gl || video.readyState < 2 || !video.videoWidth) return;
    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
      this.canvas.width = video.videoWidth;
      this.canvas.height = video.videoHeight;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const lut = opts.lut ?? null;
    gl.uniform1f(this.#u.u_useLut!, lut ? 1 : 0);
    if (lut && lut !== this.#lutData) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.#lutTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, LUT_SIZE * LUT_SIZE, LUT_SIZE, 0, gl.RGB, gl.UNSIGNED_BYTE, lutStrip(lut));
      this.#lutData = lut;
    }

    const chroma = opts.chroma?.enabled ? opts.chroma : null;
    gl.uniform1f(this.#u.u_useChroma!, chroma ? 1 : 0);
    if (chroma) {
      const [r, g, b] = hexToRgb(chroma.color);
      gl.uniform3f(this.#u.u_key!, r / 255, g / 255, b / 255);
      gl.uniform1f(this.#u.u_similarity!, chroma.similarity * 0.5);
      gl.uniform1f(this.#u.u_blend!, chroma.blend * 0.5);
      gl.uniform1f(this.#u.u_spill!, chroma.spill);
    }

    const mask = opts.mask;
    gl.uniform1f(this.#u.u_useMask!, mask ? 1 : 0);
    gl.uniform1f(this.#u.u_feather!, opts.feather ?? 0.35);
    if (mask) {
      // La máscara viene en float 0–1; se pasa a byte para que WebGL 1 la acepte.
      const bytes = new Uint8Array(mask.width * mask.height);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(mask.data[i] * 255);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.#maskTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.width, mask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/**
 * Del orden del .cube (r + g·N + b·N², el de grade.rs) al de la tira: fila g,
 * columna b·N + r. Sin reordenar, cada fila de la textura mezclaría cortes.
 */
function lutStrip(cube: Uint8Array): Uint8Array {
  const n = LUT_SIZE;
  const out = new Uint8Array(cube.length);
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const src = (r + g * n + b * n * n) * 3;
        const dst = (g * n * n + b * n + r) * 3;
        out[dst] = cube[src];
        out[dst + 1] = cube[src + 1];
        out[dst + 2] = cube[src + 2];
      }
  return out;
}
