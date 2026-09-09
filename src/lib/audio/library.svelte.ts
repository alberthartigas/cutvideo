import { suggestFreeMusic, type FreeTrack } from "$lib/autoedit/run";
import { builtinSfx, type SoundAsset } from "$lib/tauri/sfx";

/**
 * Biblioteca de sonidos del panel de audio: música por géneros y efectos.
 *
 * Los efectos vienen con la app, así que están al instante. La música se busca
 * en Openverse (dominio público y Creative Commons) y se guarda en caché para
 * que al volver a abrir el panel ya esté puesta, sin esperar.
 */
export interface Genre {
  id: string;
  name: string;
  query: string;
}

export const GENRES: Genre[] = [
  { id: "lofi", name: "Lo-fi", query: "lofi chill beat" },
  { id: "cine", name: "Cine", query: "cinematic orchestral score" },
  { id: "electronica", name: "Electrónica", query: "electronic dance synth" },
  { id: "hiphop", name: "Hip hop", query: "hip hop beat instrumental" },
  { id: "rock", name: "Rock", query: "rock guitar instrumental" },
  { id: "ambiente", name: "Ambiente", query: "ambient calm atmosphere" },
  { id: "corporativa", name: "Corporativa", query: "corporate upbeat background" },
  { id: "alegre", name: "Alegre", query: "happy ukulele upbeat" },
  { id: "epica", name: "Épica", query: "epic trailer drums" },
  { id: "suspense", name: "Suspense", query: "suspense tension dark" },
];

const CACHE_KEY = "cutvideo.music-cache.v1";
/** Una semana: la música libre no cambia tan rápido como para pedirla más. */
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

type Cache = Record<string, { at: number; tracks: FreeTrack[] }>;

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* sin localStorage la caché dura solo esta sesión */
  }
}

class SoundLibrary {
  /** Pistas por género, ya cargadas. */
  music = $state<Record<string, FreeTrack[]>>({});
  /** Géneros que se están pidiendo ahora mismo. */
  loading = $state<Record<string, boolean>>({});
  errors = $state<Record<string, string>>({});
  sfx = $state<SoundAsset[]>([]);
  sfxError = $state<string | null>(null);

  #started = false;

  /** Categorías de efectos, en el orden en que vienen del backend. */
  get sfxCategories(): string[] {
    const out: string[] = [];
    for (const s of this.sfx) if (!out.includes(s.category)) out.push(s.category);
    return out;
  }

  /**
   * Carga los efectos y deja lista la música. Se llama al abrir el panel; las
   * veces siguientes no hace nada porque ya está todo en memoria.
   */
  async start() {
    if (this.#started) return;
    this.#started = true;

    builtinSfx()
      .then((s) => (this.sfx = s))
      .catch((e) => (this.sfxError = String(e)));

    // Lo que quedó en caché se enseña de inmediato.
    const cache = readCache();
    for (const [id, entry] of Object.entries(cache)) {
      if (Date.now() - entry.at < CACHE_TTL) this.music[id] = entry.tracks;
    }
    // Y lo que falte se va pidiendo por detrás, un género cada vez para no
    // castigar a la API con diez peticiones a la vez.
    for (const g of GENRES) {
      if (this.music[g.id]?.length) continue;
      await this.load(g);
    }
  }

  /** Pide un género (o lo vuelve a pedir si se fuerza). */
  async load(genre: Genre, force = false): Promise<void> {
    if (this.loading[genre.id]) return;
    if (!force && this.music[genre.id]?.length) return;
    this.loading[genre.id] = true;
    delete this.errors[genre.id];
    try {
      const tracks = await suggestFreeMusic(genre.query);
      this.music[genre.id] = tracks;
      const cache = readCache();
      cache[genre.id] = { at: Date.now(), tracks };
      writeCache(cache);
    } catch (e) {
      this.errors[genre.id] = String(e);
    } finally {
      this.loading[genre.id] = false;
    }
  }
}

export const library = new SoundLibrary();
