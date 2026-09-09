# CutVideo

Editor de vídeo rápido para Mac y Windows: cortes, transiciones, efectos,
textos animados, subtítulos automáticos y autoedición con IA.

Tauri 2 + Rust en el backend, SvelteKit + Svelte 5 + Tailwind v4 en la interfaz,
FFmpeg como sidecar.

## Desarrollo

```bash
npm install
npm run tauri dev
```

`npm run dev` a secas abre la interfaz en el navegador con la API nativa simulada
(útil para trabajar en la UI sin compilar Rust).

## Comprobaciones

```bash
npm run check                       # tipos de Svelte/TypeScript
cd src-tauri && cargo check         # backend
```

Los tests de Rust que necesitan FFmpeg o el llavero se activan con variables de entorno:

```bash
cd src-tauri
CUTVIDEO_FFMPEG="$(which ffmpeg)" CUTVIDEO_TEST_DIR=/ruta/con/clips cargo test
CUTVIDEO_KEYCHAIN_TEST=1 cargo test
```

## Icono

`app-icon.svg` es la fuente. Para regenerar todos los tamaños:

```bash
npx tauri icon app-icon.svg
```
