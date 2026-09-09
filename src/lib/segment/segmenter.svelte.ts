import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

/**
 * Recorte de personas: separa a quien sale en el vídeo del fondo.
 *
 * Usa el segmentador de MediaPipe, que va empaquetado con la app (modelo y
 * WASM en `static/`), así que funciona sin conexión y sin descargar nada la
 * primera vez.
 */
export interface Mask {
  /** Confianza de "esto es persona", 0–1, fila a fila. */
  data: Float32Array;
  width: number;
  height: number;
}

class PersonSegmenter {
  #segmenter: ImageSegmenter | null = null;
  #loading: Promise<boolean> | null = null;
  /** MediaPipe exige marcas de tiempo crecientes aunque el playhead vaya hacia atrás. */
  #clock = 0;
  ready = $state(false);
  error = $state<string | null>(null);

  /** Carga el modelo la primera vez que hace falta. */
  load(): Promise<boolean> {
    this.#loading ??= (async () => {
      try {
        const files = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        this.#segmenter = await ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: "/models/selfie_segmenter.tflite", delegate: "GPU" },
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        this.ready = true;
        this.error = null;
        return true;
      } catch (e) {
        this.error = `No se pudo cargar el recorte de personas: ${e}`;
        return false;
      }
    })();
    return this.#loading;
  }

  /** Máscara de la persona en el frame actual del vídeo, o null si aún no está listo. */
  segment(video: HTMLVideoElement): Mask | null {
    const seg = this.#segmenter;
    if (!seg || video.readyState < 2 || !video.videoWidth) return null;
    this.#clock += 33;
    let mask: Mask | null = null;
    try {
      const result = seg.segmentForVideo(video, this.#clock);
      const confidence = result.confidenceMasks?.[0];
      if (confidence) {
        // Se copia porque MediaPipe reutiliza el búfer en la siguiente llamada.
        mask = {
          data: new Float32Array(confidence.getAsFloat32Array()),
          width: confidence.width,
          height: confidence.height,
        };
      }
      result.close();
    } catch (e) {
      this.error = String(e);
    }
    return mask;
  }

  close() {
    this.#segmenter?.close();
    this.#segmenter = null;
    this.#loading = null;
    this.ready = false;
  }
}

export const segmenter = new PersonSegmenter();
