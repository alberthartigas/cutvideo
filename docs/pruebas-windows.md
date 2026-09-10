# Probar CutVideo en Windows

Guion de pruebas para la sesión de Windows. Lo de aquí se ha verificado en Mac
(y en modo navegador); lo que falta es comprobar que en Windows se comporta
igual, porque hay partes que dependen del sistema: el ffmpeg empaquetado, el
codificador por hardware, las rutas y el llavero.

## 1. Instalar

1. Descarga el instalador de la última release:
   <https://github.com/alberthartigas/cutvideo/releases/latest>
   - `CutVideo_<versión>_x64-setup.exe` (o el `.msi`) para PC normal.
   - `CutVideo_<versión>_arm64-setup.exe` para portátiles ARM (Snapdragon).
2. Windows enseñará el aviso de SmartScreen (la app no está firmada con
   certificado de Windows): **Más información → Ejecutar de todas formas**.
3. Ábrela y comprueba en **⚙ → Acerca de** que la versión es la que instalaste.

## 2. Lo que hay que probar

Marca lo que falle y con qué archivo pasó.

**Base**
- [ ] Importar vídeos del móvil (HEVC/H.265) y que salgan miniaturas y ondas.
- [ ] Que el preview vaya fluido (usa proxies; la primera vez tarda en crearlos).
- [ ] Reproducir con sonido; si Windows lo bloquea, sale un botón para activarlo.
- [ ] Exportar un vídeo corto y abrirlo. Mirar qué codificador usó (lo dice al
      terminar): en Windows debería salir **NVENC**, **QSV** o **AMF**; si sale
      `libx264` es que no encontró el de la tarjeta.

**Timeline**
- [ ] Los clips enseñan fotogramas y forma de onda.
- [ ] Clic derecho en un clip: cortar, separar audio, volver a unir, eliminar.
- [ ] Arrastrar un cuadro por una zona vacía marca varios clips; ⇧ y Ctrl suman.
- [ ] Mover clips entre pistas (V1 ↔ O1/O2) y que el audio de las capas suene.

**Medios**
- [ ] Al pasar el ratón por encima, el vídeo se reproduce con sonido desde donde
      apunta el cursor.
- [ ] Cuadro de selección y "Quitar N de Medios" (⌫ también).

**Autoedición**
- [ ] Importar 4–6 vídeos y darle a Autoeditar con IA: debe montar en orden de
      grabación, elegir momentos, poner transiciones variadas y subtítulos
      pequeños que entran y salen deslizándose.
- [ ] Los rótulos no deben quedar a caballo de un corte.
- [ ] Panel de Subtítulos: cambiar tamaño, altura y estilo de todos a la vez.
- [ ] Exportar y comprobar que aparece "la autoedición ha aprendido de esta
      edición"; volver a autoeditar y ver que arranca con tu tamaño de subtítulo.

**Actualizaciones**
- [ ] ⚙ → Acerca de → Buscar actualizaciones, instalar y reiniciar.

## 3. Cosas que pueden fallar solo en Windows

| Qué | Por qué | Dónde mirar |
| --- | --- | --- |
| No importa ni exporta | El sidecar `ffmpeg-x86_64-pc-windows-msvc.exe` no llegó al paquete | `src-tauri/binaries/`, `scripts/setup-ffmpeg.sh` |
| Exporta lento | No detecta NVENC/QSV/AMF y cae a x264 | `Encoder::candidates` en `src-tauri/src/export.rs` |
| Las claves de API no se guardan | El llavero en Windows es el Administrador de credenciales | `src-tauri/src/secrets.rs` |
| El recorte de personas no va | El WASM de MediaPipe no carga | consola del WebView (WebView2) |
| El instalador no actualiza | `installMode: passive` de NSIS | `tauri.conf.json` → `plugins.updater.windows` |

## 4. IA en local con Ollama

CutVideo trae el proveedor **Ollama** en Autoedición → *Dirigir con IA*: habla
con el modelo que tengas instalado en tu propio ordenador (`localhost:11434`),
sin clave y sin mandar nada a internet. La transcripción de los subtítulos sí
sigue yendo a Groq/OpenAI: Ollama no transcribe audio.

1. Instala Ollama: <https://ollama.com/download/windows>.
2. Mira qué tarjeta tienes y cuánta memoria de vídeo (VRAM). En PowerShell:

   ```powershell
   Get-CimInstance Win32_VideoController | Select-Object Name, @{n='VRAM_GB';e={[math]::Round($_.AdapterRAM/1GB,1)}}, DriverVersion
   nvidia-smi   # si es NVIDIA, da la VRAM real
   ```

   `AdapterRAM` se queda corto en tarjetas de más de 4 GB; si es NVIDIA, hazle
   caso a `nvidia-smi`.

3. Elige modelo por VRAM (todos en 4 bits, que es lo que baja Ollama por
   defecto). La regla: el modelo debe caber entero en la tarjeta, si no tira de
   CPU y va lentísimo.

   | VRAM | Modelo recomendado | Comando |
   | --- | --- | --- |
   | 4 GB | Llama 3.2 3B | `ollama pull llama3.2:3b` |
   | 6 GB | Qwen 2.5 7B (o Llama 3.1 8B justo) | `ollama pull qwen2.5:7b-instruct` |
   | 8 GB | Qwen 2.5 7B / Llama 3.1 8B | `ollama pull llama3.1:8b` |
   | 12 GB | Qwen 2.5 14B | `ollama pull qwen2.5:14b-instruct` |
   | 16 GB | Qwen 2.5 14B con contexto largo, o Gemma 2 27B apretado | `ollama pull qwen2.5:14b-instruct` |
   | 24 GB+ | Qwen 2.5 32B | `ollama pull qwen2.5:32b-instruct` |

   Para lo que hace CutVideo (leer la transcripción y devolver un JSON con los
   momentos y los textos) un 7B–14B que siga instrucciones va sobrado; los
   modelos "razonadores" tardan más y no mejoran el resultado.

4. Dale contexto suficiente. Ollama arranca los modelos con 4096 tokens de
   contexto y el encargo de CutVideo (transcripción + resumen del material +
   esquema JSON) se acerca a ese límite: si se pasa, Ollama recorta el principio
   sin avisar y el plan sale pobre. Se sube una vez, en PowerShell, y se
   reinicia Ollama desde la bandeja del sistema:

   ```powershell
   [Environment]::SetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", "8192", "User")
   ```

   Ojo con la VRAM: el modelo se queda cargado 5 minutos tras usarlo y compite
   con el codificador de vídeo. Si vas justo, `ollama stop <modelo>` antes de
   exportar.

5. Comprueba que responde:

   ```powershell
   ollama run qwen2.5:7b-instruct "Responde solo con: listo"
   curl http://localhost:11434/v1/models
   ```

6. En CutVideo: **Autoedición → Dirigir con IA → Con: Ollama**. Si el modelo que
   descargaste no es de la lista de preferidos, la app coge el primero de texto
   que encuentre instalado.
