/** Imágenes de las tiras de fotogramas, cargadas una sola vez por URL. */
const cache = new Map<string, Promise<HTMLImageElement>>();

export function imagenDe(src: string): Promise<HTMLImageElement> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      img.src = src;
    });
    p.catch(() => cache.delete(src));
    cache.set(src, p);
  }
  return p;
}
