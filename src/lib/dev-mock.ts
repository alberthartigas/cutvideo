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
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Proyectos guardados "en disco" mientras dura la sesión del navegador. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devProjects: { file: any; thumbnail: string | null }[] = [];

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
      case "export_overlay_begin":
        return "/tmp/cutvideo-mock-overlay";
      case "export_write_frame":
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
      case "ai_edit_plan":
        await sleep(900);
        return {
          title: "Así se hace",
          titlePreset: "pop",
          highlights: [
            { time: 2, text: "Empieza aquí" },
            { time: 6, text: "El truco" },
          ],
          subtitleStyle: "karaoke",
          transition: "zoom",
          musicQuery: "upbeat electronic background",
          reasoning: `Plan simulado en modo navegador (${(args.request as { provider?: string }).provider ?? "groq"}).`,
        };
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
