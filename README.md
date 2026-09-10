# CutVideo

Editor de vídeo rápido para Mac y Windows: cortes, transiciones, efectos,
textos animados, subtítulos automáticos, recorte de personas, capas
superpuestas y autoedición con IA.

Desarrollado por **Alberth Artigas**. Software libre con licencia
[MIT](LICENSE).

Tauri 2 + Rust en el backend, SvelteKit + Svelte 5 + Tailwind v4 en la interfaz,
FFmpeg como sidecar.

## Instalar

Descarga la última versión desde [Releases](../../releases). La app avisa
sola cuando hay una nueva: **Acerca de → Buscar actualizaciones**.

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


## Publicar una versión

Las actualizaciones van firmadas: la app solo instala paquetes firmados con la
clave privada del autor, y comprueba la firma con la pública que lleva dentro
(`plugins.updater.pubkey` en `src-tauri/tauri.conf.json`).

```bash
# La clave privada se generó con `npx tauri signer generate` y vive fuera del
# repositorio. Si se pierde, los usuarios ya instalados dejan de recibir
# actualizaciones y hay que reinstalar a mano.
scripts/release.sh 0.2.0   # coge la clave de ~/.tauri/cutvideo.key
```

El script sube la versión en los tres manifiestos, compila, genera el
`latest.json` que consulta el actualizador y publica la release en GitHub.

## Windows

Desde macOS no se puede compilar para Windows: hacen falta el toolchain de
MSVC, WebView2 y el instalador. Lo hace GitHub en una máquina Windows con el
flujo `.github/workflows/windows.yml`, que se dispara al publicar una release y
añade el `.exe` a la misma. FFmpeg se baja ahí en su versión LGPL, para no
arrastrar la GPL a una app MIT.

Hace falta guardar una vez la clave de firma del actualizador como secreto del
repositorio:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo alberthartigas/cutvideo < ~/.tauri/cutvideo.key
```

(`--repo` hace falta si no estás dentro de la carpeta del repositorio: `gh`
deduce el repositorio del remoto de git, y desde otro sitio no lo encuentra.)

Cada plataforma sube su propio `latest.json`, así que
`scripts/merge-latest-json.sh` los junta para que el actualizador vea las dos.

Para probar la app en Windows hay un guion con lo que conviene mirar (y cómo
poner la IA en local con Ollama): [`docs/pruebas-windows.md`](docs/pruebas-windows.md).

Los instaladores **no van firmados**, así que Windows avisa de «editor
desconocido» y el antivirus los inspecciona. Qué hacer mientras tanto y cuánto
costaría firmarlos: [`docs/windows-firma.md`](docs/windows-firma.md).

## Firma de la app (macOS)

`src-tauri/tauri.conf.json` lleva el Developer ID del autor en
`bundle.macOS.signingIdentity`. Si haces un fork, cámbialo por el tuyo o quita
esa línea para compilar sin firmar.

## Claves de API

Las claves (Groq, Gemini, OpenAI, Anthropic) se pegan en **Ajustes** y se
guardan en el llavero del sistema: llavero de macOS o Administrador de
credenciales de Windows. Nunca se escriben en un archivo ni viajan al
repositorio.

El backend no expone ningún comando para leerlas: la interfaz solo puede
guardarlas, borrarlas y preguntar si existen, y lo único que recibe de vuelta
es una pista con los cuatro últimos caracteres (`…abcd`). Ver
`src-tauri/src/secrets.rs`.

## Licencias de lo que se distribuye

- El código de CutVideo es MIT.
- Los efectos de sonido de `src-tauri/resources/sfx/` están sintetizados con
  `scripts/gen-sfx.sh`: son originales y van bajo la misma licencia.
- FFmpeg se distribuye como binario aparte (sidecar), con su propia licencia.
- La música que sugiere el panel de audio viene de Openverse y **no** se
  distribuye con la app: cada pista conserva su licencia.
