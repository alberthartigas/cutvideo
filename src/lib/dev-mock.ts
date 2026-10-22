/**
 * Modo navegador: simula la API de Tauri para desarrollar la interfaz con
 * `npm run dev` abierto en un navegador normal (sin backend Rust).
 * Solo se carga en dev y cuando no estamos dentro de Tauri (ver +layout.ts).
 * Los medios de prueba se sirven desde static/dev-media (no van al repo).
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { MediaInfo } from "$lib/tauri/media";

const DIR = "/dev-media";

function fake(
  fileName: string,
  durationSec: number,
  video: { width: number; height: number; fps: number } | null,
  audio: boolean,
  isImage = false,
): MediaInfo {
  return {
    path: `${DIR}/${fileName}`,
    fileName,
    container: video ? "mov,mp4,m4a,3gp,3g2,mj2" : "mp3",
    durationSec,
    sizeBytes: Math.round(durationSec * 350_000),
    bitRate: 2_800_000,
    video: video && {
      codec: "h264",
      codecLong: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
      ...video,
      pixFmt: "yuv420p",
      rotation: 0,
      frameCount: Math.round(durationSec * video.fps),
    },
    audio: audio
      ? { codec: "aac", codecLong: "AAC (Advanced Audio Coding)", sampleRate: 48000, channels: 1, channelLayout: "mono" }
      : null,
    videoStreamCount: video ? 1 : 0,
    audioStreamCount: audio ? 1 : 0,
    isImage,
    // Fechas escalonadas para poder probar el orden cronológico.
    recordedAt: new Date(Date.UTC(2026, 8, 9, 1, 0, 0) + fileName.length * 60000).toISOString(),
  };
}

const FILES: MediaInfo[] = [
  fake("clipA.mp4", 4, { width: 1280, height: 720, fps: 30 }, true),
  fake("clipB.mp4", 3, { width: 1920, height: 1080, fps: 25 }, true),
  fake("mute.mp4", 2, { width: 640, height: 480, fps: 30 }, false),
  fake("music.mp3", 6, null, true),
  fake("sticker.png", 0, { width: 512, height: 512, fps: 0 }, false, true),
  fake("verde.mp4", 3, { width: 640, height: 360, fps: 25 }, false),
  fake("fondo.mp4", 3, { width: 640, height: 360, fps: 25 }, false),
  fake("persona.mp4", 3, { width: 640, height: 360, fps: 25 }, false),
  fake("persona-hd.mp4", 4, { width: 1920, height: 1080, fps: 30 }, false),
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Aprendizaje simulado: vive mientras dure la pestaña. */
const SIN_APRENDER = {
  ediciones: 0,
  frases: [] as string[],
  estiloSubtitulo: null as string | null,
  subtituloFontSize: null as number | null,
  subtituloY: null as number | null,
  duracionClip: null as number | null,
  ponerRotulos: true,
  ponerMusica: true,
};
let perfilSimulado = { ...SIN_APRENDER };

/** Proyectos guardados "en disco" mientras dura la sesión del navegador. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devProjects: { file: any; thumbnail: string | null }[] = [];

/** Biblioteca de parches simulada, con uno de ejemplo ya dentro. */
const devPatches: { id: string; name: string; path: string; sizeBytes: number }[] = [
  { id: "sticker.png", name: "sticker", path: `${DIR}/sticker.png`, sizeBytes: 4096 },
];

export function installDevMock() {
  mockWindows("main");
  // Las rutas "falsas" ya son URLs servidas por Vite.
  (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__.convertFileSrc =
    (path: string) => path;

  let listeners = 0;
  mockIPC(async (cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "ffmpeg_version":
        return "simulado (modo navegador)";
      case "grade_lut":
        return mockGradeLut(args.grade as Record<string, number & number[]>).buffer;
      case "startup_files":
        // En el navegador arrancamos sin archivos, como al abrir la app normalmente;
        // los medios de prueba se importan con el botón Importar.
        return [];
      case "probe_media": {
        const info = FILES.find((f) => f.path === args.path);
        if (!info) throw `No existe el archivo: ${args.path}`;
        return info;
      }
      case "plugin:dialog|open":
        return FILES.map((f) => f.path);
      case "plugin:dialog|save":
        return "/tmp/CutVideo.mp4";
      case "plugin:event|listen":
        return ++listeners;
      case "analyze_highlights": {
        // Perfil sintético con tres picos claros, para poder comprobar que la
        // selección se queda con ellos y no con los tramos planos.
        const r = args.request as { start: number; end: number };
        const n = Math.max(1, Math.round((r.end - r.start) / 0.5));
        const times = Array.from({ length: n }, (_, i) => r.start + i * 0.5);
        const pico = (i: number, centro: number) => Math.exp(-((i - centro) ** 2) / 40);
        const loudness = times.map((_, i) => 0.1 + 0.8 * (pico(i, n * 0.15) + pico(i, n * 0.5) + pico(i, n * 0.85)));
        return { times, loudness, motion: loudness.map((v) => v * 0.5), cuts: [] };
      }
      case "learning_summary":
        return perfilSimulado;
      case "learning_record": {
        // Se comporta como learning.rs: cuenta ediciones y resume lo aprendido.
        const m = args.muestra as Record<string, number | string | boolean | null>;
        perfilSimulado = {
          ediciones: perfilSimulado.ediciones + 1,
          frases: [
            `Se queda con los subtítulos en estilo «${m.estiloSubtitulo ?? "discreto"}».`,
            "Los planos le acaban quedando de unos 3,2 s.",
          ],
          estiloSubtitulo: (m.estiloSubtitulo as string) ?? null,
          subtituloFontSize: (m.subtituloFontSize as number) ?? null,
          subtituloY: (m.subtituloY as number) ?? null,
          duracionClip: (m.duracionClip as number) ?? null,
          ponerRotulos: Number(m.rotulosConservados) > 0,
          ponerMusica: !!m.musicaConservada,
        };
        return perfilSimulado;
      }
      case "learning_forget":
        perfilSimulado = { ...SIN_APRENDER };
        return null;
      case "make_waveform": {
        // Onda sintética: voz a ráfagas con silencios, para ver los tramos.
        const info = FILES.find((f) => f.path === args.path);
        const n = Math.round((info?.durationSec ?? 3) * 50);
        return Array.from({ length: n }, (_, i) => {
          const frase = Math.sin(i / 35) > -0.2 ? 1 : 0.05;
          return Math.round(255 * frase * (0.35 + 0.65 * Math.abs(Math.sin(i / 3.7))));
        });
      }
      case "make_filmstrip":
        // En modo navegador se sirve una tira de ejemplo desde static.
        return "/dev-media/tira.jpg";
      case "make_proxy":
        return String(args.path);
      case "proxy_for":
        return null;
      case "builtin_sfx": {
        const cat: [string, string, string][] = [
          ["whoosh-corto", "Whoosh corto", "Transiciones"],
          ["whoosh-largo", "Whoosh largo", "Transiciones"],
          ["swish", "Swish", "Transiciones"],
          ["impacto", "Impacto", "Golpes"],
          ["subgrave", "Subgrave", "Golpes"],
          ["riser", "Riser", "Tensión"],
          ["latido", "Latido", "Tensión"],
          ["pop", "Pop", "Interfaz"],
          ["click", "Clic", "Interfaz"],
          ["campana", "Campana", "Avisos"],
          ["exito", "Acierto", "Avisos"],
        ];
        return cat.map(([id, name, category]) => ({ id, name, category, path: `/sfx/${id}.mp3` }));
      }
      case "export_overlay_begin":
        return "/tmp/cutvideo-mock-overlay";
      case "export_write_raw":
        // Las siluetas van en crudo: solo contamos bytes para poder medir.
        if (payload instanceof Uint8Array) {
          const w = window as unknown as { __rawBytes?: number; __rawFrames?: number };
          w.__rawBytes = (w.__rawBytes ?? 0) + payload.length;
          w.__rawFrames = (w.__rawFrames ?? 0) + 1;
        }
        return null;
      case "export_write_frame":
        // Guardamos los frames en `window.__frames` (base64) para poder mirar
        // las máscaras y los textos desde la consola sin exportar de verdad.
        if (payload instanceof Uint8Array) {
          const w = window as unknown as { __frames?: string[] };
          const frames = (w.__frames ??= []);
          // En trozos, que un PNG de 4K no cabe de una en fromCharCode.
          let bin = "";
          for (let i = 0; i < payload.length; i += 8192) {
            bin += String.fromCharCode(...payload.subarray(i, i + 8192));
          }
          if (frames.length < 400) frames.push(btoa(bin));
        }
        return null;
      case "export_overlay_end":
      case "plugin:event|unlisten":
      case "plugin:window|set_theme":
      case "plugin:opener|open_url":
      case "plugin:opener|reveal_item_in_dir":
      case "secret_delete":
      case "cancel_export":
        return null;
      case "secret_status":
        // Simulamos que hay clave de Groq para poder probar el flujo de subtítulos.
        return { kind: "api", id: args.id, present: args.id === "groq", hint: args.id === "groq" ? "…mock" : null };
      case "secret_set":
        return { kind: "api", id: args.id, present: true, hint: "…mock" };
      case "transcribe": {
        await sleep(800);
        const text =
          "Hola, esto es una prueba de subtítulos automáticos generados con CutVideo. Cada palabra lleva su tiempo y el karaoke va sincronizado. Funciona de maravilla, ¿verdad?";
        let t = 0.3;
        const words = text.split(" ").map((word) => {
          const start = t;
          t += 0.28 + word.length * 0.03;
          const w = { word, start, end: t };
          if (/[.?!]$/.test(word)) t += 0.5;
          return w;
        });
        return {
          text,
          language: "es",
          duration: t,
          words,
          segments: [{ start: 0.3, end: t, text }],
          provider: (args.request as { provider: string }).provider,
          model: "simulado",
        };
      }
      case "list_patches":
        return devPatches;
      case "import_patch": {
        const path = String(args.path);
        const file = path.split("/").pop() ?? "parche.png";
        const asset = { id: file, name: file.replace(/\.[^.]+$/, ""), path, sizeBytes: 12345 };
        if (!devPatches.some((p) => p.id === asset.id)) devPatches.push(asset);
        return asset;
      }
      case "delete_patch": {
        const i = devPatches.findIndex((p) => p.id === args.id);
        if (i >= 0) devPatches.splice(i, 1);
        return null;
      }
      case "list_projects":
        return devProjects.map(({ file, thumbnail }) => ({
          id: file.id,
          name: file.name,
          createdAt: file.createdAt,
          modifiedAt: file.modifiedAt,
          sizeBytes: JSON.stringify(file).length,
          clipCount: file.clipCount,
          durationSec: file.durationSec,
          thumbnail,
          missingMedia: 0,
        }));
      case "load_project": {
        const found = devProjects.find((p) => p.file.id === args.id);
        if (!found) throw `No se pudo leer el proyecto ${args.id}`;
        return found.file;
      }
      case "save_project": {
        const file = args.file as { id: string; createdAt: number; modifiedAt: number };
        file.modifiedAt = Date.now();
        if (!file.createdAt) file.createdAt = file.modifiedAt;
        const i = devProjects.findIndex((p) => p.file.id === file.id);
        const entry = { file, thumbnail: (args.thumbnail as string | null) ?? null };
        if (i >= 0) devProjects[i] = entry;
        else devProjects.push(entry);
        return {
          ...file,
          sizeBytes: JSON.stringify(file).length,
          thumbnail: entry.thumbnail,
          missingMedia: 0,
        };
      }
      case "delete_project": {
        const i = devProjects.findIndex((p) => p.file.id === args.id);
        if (i >= 0) devProjects.splice(i, 1);
        return null;
      }
      case "projects_storage":
        return ["/tmp/cutvideo-mock/projects", devProjects.reduce((n, p) => n + JSON.stringify(p.file).length, 0)];
      case "detect_silences":
        // Dos pausas simuladas para probar el recorte automático.
        return [
          { start: 1.4, end: 2.4 },
          { start: 4.8, end: 5.9 },
        ];
      case "analyze_beats": {
        await sleep(400);
        const bpm = 120;
        const beats = Array.from({ length: 60 }, (_, i) => (i * 60) / bpm);
        return { bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0), duration: 30, confidence: 0.8 };
      }
      case "check_music_rights":
        await sleep(600);
        return {
          verdict: "copyrighted",
          confidence: 0.9,
          tags: { title: "Canción simulada", artist: "Artista", album: null, isrc: "ESA011234567", copyright: null, publisher: null },
          findings: ["Tiene código ISRC (ESA011234567): es una grabación registrada comercialmente."],
          limitations: ["Sin huella acústica: modo navegador."],
          identifiedAs: "Artista — Canción simulada",
        };
      case "suggest_free_music":
        await sleep(400);
        return [
          { title: "Sunny Days", creator: "Kevin CC", license: "CC BY 4.0", url: "https://example.org/1", duration: 132, audioUrl: `${DIR}/music.mp3` },
          { title: "Night Drive", creator: "Openverse", license: "CC0 1.0", url: "https://example.org/2", duration: 98, audioUrl: `${DIR}/music.mp3` },
        ];
      case "download_track":
        await sleep(700);
        return `${DIR}/music.mp3`;
      case "ai_models":
        return ["qwen2.5:7b-instruct", "llama3.1:8b", "qwen2.5:14b-instruct"];
      case "ai_edit_plan": {
        await sleep(900);
        // Con material delante, la IA simulada se queda con el mejor tramo de
        // cada clip hasta llenar el objetivo, igual que haría la de verdad.
        const req = args.request as {
          provider?: string;
          targetSeconds?: number | null;
          material?: { index: number; candidates: { in: number; out: number; score: number }[] }[];
        };
        const picks: { clip: number; in: number; out: number; why: string }[] = [];
        let total = 0;
        for (const m of req.material ?? []) {
          const mejor = [...m.candidates].sort((a, b) => b.score - a.score)[0];
          if (!mejor || total >= (req.targetSeconds ?? 60)) continue;
          picks.push({ clip: m.index, in: mejor.in, out: mejor.out, why: "pico de interés" });
          total += mejor.out - mejor.in;
        }
        return {
          title: "Así se hace",
          titlePreset: "pop",
          highlights: [
            { time: 2, text: "Empieza aquí" },
            { time: 6, text: "El truco" },
          ],
          picks,
          subtitleStyle: "discreto",
          transition: "zoom",
          musicQuery: "upbeat electronic background",
          reasoning: `Plan simulado en modo navegador (${req.provider ?? "groq"}).`,
        };
      }
      case "measure_loudness": {
        // Una curva inventada que sube y baja, a -18 LUFS de media.
        await sleep(600);
        const plan = args.plan as { video: { in: number; out: number }[] };
        const dur = plan.video.reduce((n, c) => n + (c.out - c.in), 0);
        const n = Math.round(dur / 0.1);
        const curve = (k: number, amp: number) => Array.from({ length: n }, (_, i) => -18 + amp * Math.sin(i / k));
        return { integrated: -18.2, range: 6.4, truePeak: -2.3, step: 0.1, momentary: curve(3, 6), shortTerm: curve(12, 3) };
      }
      case "export_video": {
        await sleep(1200);
        const plan = args.plan as { output: string };
        return { output: plan.output, encoder: "simulado", seconds: 1.2 };
      }
      default:
        throw `Modo navegador: comando no simulado: ${cmd}`;
    }
  });

  // mockIPC no pasa las cabeceras al simulador, y los scopes van en ellas:
  // se intercepta antes.
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => Promise<unknown> } })
    .__TAURI_INTERNALS__;
  const inner = internals.invoke;
  internals.invoke = (cmd: unknown, args: unknown, opts?: unknown) => {
    if (cmd !== "video_scope") return inner(cmd, args, opts);
    const raw = (opts as { headers?: HeadersInit } | undefined)?.headers;
    const h = new Headers(raw);
    return Promise.resolve(
      mockScope(args as Uint8Array, h.get("x-kind") ?? "waveform", Number(h.get("x-width")), Number(h.get("x-height")), h.get("x-grade")),
    );
  };
  console.info("[CutVideo] API de Tauri simulada (modo navegador)");
}

/**
 * Copia en JS de `Grade::apply` (src-tauri/src/grade.rs) para el modo
 * navegador. Solo simula: la app de verdad usa la de Rust.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockGradeLut(g: any): Uint8Array {
  const N = 33;
  const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const luma = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const temp = g.temperature / 100, tint = g.tint / 100, exp = 2 ** g.exposure, con = g.contrast / 100;
  const [hl, sh, wh, bl] = [g.highlights, g.shadows, g.whites, g.blacks].map((v: number) => v / 100);
  const sat = g.saturation / 100, vib = g.vibrance / 100, faded = g.faded / 100;
  const gains = [1 + 0.35 * temp, 1 - 0.3 * tint, 1 - 0.35 * temp];
  const apply = (c: number[]) => {
    let v = c.map((q, k) => toSrgb(Math.max(0, toLin(q) * gains[k] * exp)));
    const b0 = -bl * 0.15, w0 = 1 - wh * 0.15;
    v = v.map((q) => (q - b0) / Math.max(w0 - b0, 1e-3));
    const l = luma(v);
    const nl = Math.max(0, l + sh * 0.35 * clamp(1 - l) ** 3 + hl * 0.35 * clamp(l) ** 3);
    if (l > 1e-5) v = v.map((q) => (q * nl) / l);
    if (Math.abs(con) > 1e-4) {
      const k = 1 + con;
      v = v.map((q) => {
        q = clamp(q);
        const s = q * q * (3 - 2 * q);
        return k >= 1 ? q + (s - q) * (k - 1) : 0.5 + (q - 0.5) * k;
      });
    }
    if (faded > 0) v = v.map((q) => q * (1 - 0.25 * faded) + 0.12 * faded);
    const l2 = clamp(luma(v));
    v = v.map((q, k) => q + (g.shadowTint[k] - 0.5) * 0.3 * (1 - l2) + (g.highlightTint[k] - 0.5) * 0.3 * l2);
    const l3 = luma(v);
    const cur = Math.max(...v) - Math.min(...v);
    const s = sat * (1 + vib * (1 - clamp(cur)));
    return v.map((q) => clamp(l3 + (q - l3) * s));
  };
  const out = new Uint8Array(N * N * N * 3);
  let i = 0;
  for (let b = 0; b < N; b++)
    for (let gg = 0; gg < N; gg++)
      for (let r = 0; r < N; r++) for (const q of apply([r / (N - 1), gg / (N - 1), b / (N - 1)])) out[i++] = Math.round(q * 255);
  return out;
}

/**
 * Scopes simulados para el modo navegador: misma salida que scopes.rs
 * ([ancho, alto, RGBA]) pero con un trazo sencillo, sin la escala de FilmCraft.
 */
function mockScope(px: Uint8Array, kind: string, w: number, h: number, gradeJson: string | null): ArrayBuffer {
  // Con corrección de color, cada píxel pasa por el LUT simulado (vecino más próximo).
  const lut = gradeJson ? mockGradeLut(JSON.parse(gradeJson)) : null;
  const N = 33;
  const rgb = (i: number) => {
    const c = [px[i], px[i + 1], px[i + 2]];
    if (!lut) return c;
    const [r, g, b] = c.map((v) => Math.round((v / 255) * (N - 1)));
    const j = (r + g * N + b * N * N) * 3;
    return [lut[j], lut[j + 1], lut[j + 2]];
  };
  const put = (out: Uint8ClampedArray, ow: number, x: number, y: number, col: number[]) => {
    const k = (y * ow + x) * 4;
    for (let c = 0; c < 3; c++) out[k + c] = Math.min(255, out[k + c] + col[c] * 0.35);
    out[k + 3] = Math.min(255, out[k + 3] + 90);
  };
  let ow = w, oh = 256;
  if (kind === "parade") ow = w * 3;
  if (kind === "vectorscope") ow = oh = 255;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb((y * w + x) * 4);
      if (kind === "waveform") put(out, ow, x, 255 - Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b), [140, 255, 150]);
      else if (kind === "parade") {
        put(out, ow, x, 255 - r, [255, 80, 80]);
        put(out, ow, x + w, 255 - g, [80, 255, 90]);
        put(out, ow, x + 2 * w, 255 - b, [90, 130, 255]);
      } else {
        const cb = (-0.1146 * r - 0.3854 * g + 0.5 * b) / 255;
        const cr = (0.5 * r - 0.4542 * g - 0.0458 * b) / 255;
        const vx = Math.round((cb / 0.6 / 2 + 0.5) * 254), vy = Math.round((0.5 - cr / 0.6 / 2) * 254);
        if (vx >= 0 && vx < 255 && vy >= 0 && vy < 255) put(out, ow, vx, vy, [r, g, b].map((v) => 140 + v / 2.2));
      }
    }
  const buf = new Uint8Array(8 + out.length);
  new DataView(buf.buffer).setUint32(0, ow, true);
  new DataView(buf.buffer).setUint32(4, oh, true);
  buf.set(out, 8);
  return buf.buffer;
}
