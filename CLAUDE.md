# CutVideo — contexto para Claude Code

Editor de vídeo estilo CapCut para Mac y Windows, con autoedición por IA.
Software libre (MIT), de **Alberth Artigas**. Repo: <https://github.com/alberthartigas/cutvideo>.

Este archivo es la memoria del proyecto: se carga solo al abrir Claude Code en
esta carpeta, en cualquier ordenador. El historial de una sesión **no** viaja
entre máquinas (vive en `~/.claude/projects/…` de cada una), así que lo que
importa se escribe aquí.

## Cómo trabajar aquí

- **Habla español**, directo y con opinión. El usuario es cómodo con web/JS;
  **Rust es nuevo para él**: explicar lo de Rust sin dar nada por sabido.
- **Las claves de API nunca se pegan en el chat ni entran en el repo.** Van en
  Ajustes → Claves de API y acaban en el llavero del sistema (`secrets.rs`).
- Se entrega funcionando y verificado, no a medias.
- Los comentarios del código van en español y explican el *porqué*, no el qué.

### Comandos

```bash
npm install
npm run dev          # modo navegador: UI con la API de Tauri simulada (dev-mock.ts)
npm run tauri dev    # app de verdad
npm run check        # svelte-check (debe salir 0 errores)
cd src-tauri && cargo test           # 34 tests
./scripts/release.sh 0.1.12          # publica versión (ver abajo)
```

### Cómo se verifica

1. **Modo navegador** (`npm run dev`, http://localhost:1420): `src/lib/dev-mock.ts`
   simula ffmpeg, transcripción, IA, proyectos… Sirve para comprobar la UI y los
   flujos enteros sin backend. Los medios de prueba van en `static/dev-media/`
   (fuera de git).
2. **Tests de Rust**. Los que necesitan ffmpeg de verdad se saltan solos si no
   están las variables: `CUTVIDEO_FFMPEG`, `CUTVIDEO_TEST_DIR` (por ejemplo
   `static/dev-media`), `CUTVIDEO_KEYCHAIN_TEST=1`.
3. En el navegador oculto `requestAnimationFrame` no avanza: la reproducción
   parece congelada y **no es un fallo**.

## Stack (decidido, no reabrir)

- **Tauri 2 + Rust** (backend) y **SvelteKit + Svelte 5 (runes) + Tailwind v4**
  (frontend). Vite.
- **ffmpeg/ffprobe como sidecar**: `src-tauri/binaries/ffmpeg-<triple>[.exe]`
  (`scripts/setup-ffmpeg.sh`). En Windows los baja el CI en versión **LGPL**,
  para no arrastrar la GPL a una app MIT.
- Export por ffmpeg con codificador de hardware: VideoToolbox (Mac),
  NVENC/QSV/AMF (Windows), con caída a x264.
- IA por BYOK: **Groq** (gratis, por defecto), Gemini, **Ollama** (local, sin
  clave), OpenAI, Claude, y «Sin IA». Todo se llama desde Rust (`ai.rs`).
- La transcripción (subtítulos) sí necesita nube (Groq/OpenAI): Whisper local
  sigue pendiente.

## Arquitectura y decisiones que duelen si se olvidan

**Pistas**: T1 (títulos) · S1 (subtítulos) · P1 (parches) · O3/O2/O1 (capas
encima) · V1 (principal, magnética) · F1 (fondo) · A1 (audio). O1 es la capa
pegada a V1 y la primera que se llena; en el timeline solo se enseñan las
usadas más una libre.

**Reloj del preview** (`playback-clock.ts`): el `<video>` activo de V1 es el
reloj y el playhead lo sigue; si V1 está vacía, manda la primera capa que suene.
Nunca al revés: con `performance.now()` como reloj, un `play()` bloqueado por el
WebView provocaba un seek por fotograma — vídeo a saltos, sin sonido y la CPU al
máximo.

**Proxies** (`proxies.rs`): el material de móvil (HEVC 4K) se edita con copias
H.264 a 540 px; 11× más ligeras y 14× más rápidas de decodificar. Se piden
siempre que cambia la lista de medios. El export usa los originales.

**Capas** (`layers.ts`, `VideoLayer.svelte`, `export.rs`): croma y recorte de
personas (MediaPipe `selfie_segmenter` empaquetado en `static/`, sin internet).
En el preview van en un shader (`preview/layer-gl.ts`); al exportar, el frontend
escribe la silueta en crudo y ffmpeg la aplica con `alphamerge`. **Las capas
suenan**; un clip puede ir mudo y su audio separarse a A1 y volver a unirse.

**Timeline con imagen**: `ClipArt.svelte` pinta en un canvas los fotogramas de
la tira (`make_filmstrip`) y la forma de onda (`make_waveform`, picos a 50/s).
La tira usa `fps=20.5/duración`, no `thumbnail=20`, que dejaba en negro todo lo
que pasara de los primeros segundos.

**Autoedición** (`src/lib/autoedit/`): monta lo que haya en Medios por fecha de
grabación → la IA ve **todo el material** (cada clip con sus tramos puntuados
por sonido y movimiento y lo que se dice en ellos) y elige los momentos →
transiciones variadas → subtítulos → título y rótulos. Los rótulos nunca cruzan
un corte. El estilo de subtítulo por defecto es «discreto» (pequeño, abajo,
entra y sale deslizándose). Nada se encima por su cuenta: las escenas sin montar
van al final de V1 con transición.

**Aprende de cómo edita él** (`learning.rs` + `autoedit/learning.ts`): al
exportar se compara lo que propuso la autoedición con lo que quedó en el
timeline y se guarda un perfil en `<app data>/aprendizaje.json`. Ese perfil se
le cuenta a la IA en el siguiente encargo y ajusta los automatismos (duración de
los planos, estilo y tamaño de subtítulo, si poner rótulos o música). Se ve y se
borra en el panel de Autoedición.

## Publicar una versión

`./scripts/release.sh <versión>` sube la versión en los cuatro sitios, compila,
firma el paquete del actualizador y crea la release en GitHub. Necesita:

- **La clave privada del actualizador en `~/.tauri/cutvideo.key`** (fuera del
  repo). El CLI de Tauri solo lee `TAURI_SIGNING_PRIVATE_KEY`; la variante
  `_PATH` la ignora. Si esa clave se pierde, los ya instalados dejan de
  actualizarse.
- Certificado **Developer ID Application** (equipo 86YZGR88FV) para el .app.
- Windows lo compila GitHub Actions (`.github/workflows/windows.yml`) al
  publicar la release y añade los `.exe`/`.msi` a la misma;
  `scripts/merge-latest-json.sh` junta los `latest.json` de cada plataforma.

## Windows

Compila y se empaqueta, pero **está sin probar de verdad**. Lo dudoso: dónde
acaban las claves (Administrador de credenciales), los codificadores
NVENC/QSV/AMF y el sidecar de ffmpeg. El guion de pruebas, con lo que hay que
mirar y cómo poner la IA en local con Ollama, está en
[`docs/pruebas-windows.md`](docs/pruebas-windows.md).

No hay build de 32 bits: no existen binarios LGPL de FFmpeg para win32.
