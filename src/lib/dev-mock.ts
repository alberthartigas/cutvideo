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
  };
}

const FILES: MediaInfo[] = [
  fake("clipA.mp4", 4, { width: 1280, height: 720, fps: 30 }, true),
  fake("clipB.mp4", 3, { width: 1920, height: 1080, fps: 25 }, true),
  fake("mute.mp4", 2, { width: 640, height: 480, fps: 30 }, false),
  fake("music.mp3", 6, null, true),
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
        return FILES.map((f) => f.path);
      case "probe_media": {
        const info = FILES.find((f) => f.path === args.path);
        if (!info) throw `No existe el archivo: ${args.path}`;
        return info;
      }
      case "plugin:dialog|open":
        return FILES.map((f) => f.path);
      case "plugin:dialog|save":
        return "/tmp/QuickCut.mp4";
      case "plugin:event|listen":
        return ++listeners;
      case "export_overlay_begin":
        return "/tmp/quickcut-mock-overlay";
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
        return { kind: "api", id: args.id, present: false, hint: null };
      case "secret_set":
        return { kind: "api", id: args.id, present: true, hint: "…mock" };
      case "export_video": {
        await sleep(1200);
        const plan = args.plan as { output: string };
        return { output: plan.output, encoder: "simulado", seconds: 1.2 };
      }
      default:
        throw `Modo navegador: comando no simulado: ${cmd}`;
    }
  });
  console.info("[QuickCut] API de Tauri simulada (modo navegador)");
}
