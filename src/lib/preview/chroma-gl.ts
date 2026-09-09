import { hexToRgb, type ChromaKey } from "$lib/effects/chroma";

/**
 * Croma en el preview con WebGL: dibuja un <video> en un canvas volviendo
 * transparente el color elegido. Se hace en la GPU porque hacerlo píxel a
 * píxel en JS no aguanta 30 fps a 1080p.
 *
 * La misma idea que el filtro `chromakey` de ffmpeg (distancia en el plano de
 * color UV), para que el preview y el vídeo exportado se parezcan.
 */
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) / 2.0, (1.0 - a_pos.y) / 2.0);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec3 u_key;        // color a borrar (RGB 0-1)
uniform float u_similarity;
uniform float u_blend;
uniform float u_spill;
varying vec2 v_uv;

// Componentes de color (U, V) del YUV: la luminosidad no cuenta, así que las
// sombras del mismo tono también se borran.
vec2 uv_of(vec3 c) {
  return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}

void main() {
  vec4 px = texture2D(u_tex, v_uv);
  float d = distance(uv_of(px.rgb), uv_of(u_key));
  // Por debajo de similarity es fondo; hasta similarity + blend se difumina.
  float alpha = smoothstep(u_similarity, u_similarity + max(u_blend, 0.001), d);
  vec3 rgb = px.rgb;
  if (u_spill > 0.0 && alpha > 0.0) {
    // Quita el tinte del croma que queda en los bordes del sujeto.
    float g = max(rgb.g - max(rgb.r, rgb.b), 0.0) * u_spill;
    rgb.g -= g;
    rgb.r += g * 0.4;
    rgb.b += g * 0.4;
  }
  gl_FragColor = vec4(rgb, alpha);
}`;

export class ChromaRenderer {
  #gl: WebGLRenderingContext | null = null;
  #tex: WebGLTexture | null = null;
  #uniforms: Record<string, WebGLUniformLocation | null> = {};

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

    // Un rectángulo que cubre toda la pantalla.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.#tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    for (const name of ["u_key", "u_similarity", "u_blend", "u_spill"]) {
      this.#uniforms[name] = gl.getUniformLocation(prog, name);
    }
    this.#gl = gl;
    return true;
  }

  /** Pinta un frame del vídeo con el croma aplicado. */
  draw(video: HTMLVideoElement, chroma: ChromaKey) {
    const gl = this.#gl;
    if (!gl || video.readyState < 2 || !video.videoWidth) return;
    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
      this.canvas.width = video.videoWidth;
      this.canvas.height = video.videoHeight;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, this.#tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const [r, g, b] = hexToRgb(chroma.color);
    gl.uniform3f(this.#uniforms.u_key!, r / 255, g / 255, b / 255);
    gl.uniform1f(this.#uniforms.u_similarity!, chroma.similarity * 0.5);
    gl.uniform1f(this.#uniforms.u_blend!, chroma.blend * 0.5);
    gl.uniform1f(this.#uniforms.u_spill!, chroma.spill);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
