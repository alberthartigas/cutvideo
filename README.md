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

## Firma (macOS)

La app se firma con el certificado **Developer ID Application** del equipo
`86YZGR88FV` (ver `bundle.macOS` en `src-tauri/tauri.conf.json`). Firmar con una
identidad estable es lo que evita que el llavero pida permiso en cada
compilación para leer las claves de API guardadas.

`src-tauri/entitlements.plist` lleva lo que necesitan el WebView (JIT) y los
sidecars de FFmpeg (`disable-library-validation`, porque enlazan librerías que
no firmamos nosotros).

Para **distribuir** la app a otros Macs hace falta además notarizarla: exporta
`APPLE_ID`, `APPLE_PASSWORD` (contraseña específica de app) y `APPLE_TEAM_ID`
antes de `npm run tauri build`, y Tauri la envía a Apple automáticamente.

## Icono

`app-icon.svg` es la fuente. Para regenerar todos los tamaños:

```bash
npx tauri icon app-icon.svg
```
