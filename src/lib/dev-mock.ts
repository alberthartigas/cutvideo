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
      case "export_video": {
        await sleep(1200);
        const plan = args.plan as { output: string };
        return { output: plan.output, encoder: "simulado", seconds: 1.2 };
      }
      default:
        throw `Modo navegador: comando no simulado: ${cmd}`;
    }
  });
  console.info("[CutVideo] API de Tauri simulada (modo navegador)");
}
