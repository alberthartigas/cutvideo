import type { Clip } from "$lib/project.svelte";
import { mediaSrc } from "$lib/tauri/media";
import { patchAt } from "./types";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Carga las imágenes de los parches una sola vez (para el export). */
export async function loadPatchImages(clips: Clip[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...new Set(clips.filter((c) => c.patch).map((c) => c.mediaPath))].map(
      (path) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            out.set(path, img);
            resolve();
          };
          img.onerror = () => resolve(); // un parche que no carga simplemente no sale
          img.src = mediaSrc(path);
        }),
    ),
  );
  return out;
}

/** Dibuja los parches visibles en el instante `t`. */
export function drawPatches(
  ctx: Ctx,
  clips: Clip[],
  images: Map<string, HTMLImageElement>,
  t: number,
  frame: { width: number; height: number },
) {
  for (const clip of clips) {
    const patch = clip.patch;
    if (!patch) continue;
    const duration = clip.out - clip.in;
    if (t < clip.start || t >= clip.start + duration) continue;
    const img = images.get(clip.mediaPath);
    if (!img?.width) continue;

    const pos = patchAt(patch, t);
    const w = patch.width * pos.scale * frame.width;
    const h = (img.height / img.width) * w;
    ctx.save();
    ctx.globalAlpha = patch.opacity;
    ctx.translate(pos.x * frame.width, pos.y * frame.height);
    if (patch.rotation) ctx.rotate((patch.rotation * Math.PI) / 180);
    if (patch.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
