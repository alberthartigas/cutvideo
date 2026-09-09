#!/usr/bin/env bash
# Prepara los sidecars ffmpeg/ffprobe con el nombre que Tauri espera:
#   src-tauri/binaries/<nombre>-<target-triple>
#
# En desarrollo copiamos los binarios de Homebrew (enlazados dinámicamente:
# solo funcionan en esta máquina). Para distribuir hay que sustituirlos por
# builds estáticas LGPL — eso se hará en CI.
set -euo pipefail
cd "$(dirname "$0")/.."

TRIPLE="$(rustc --print host-tuple 2>/dev/null || rustc -vV | sed -n 's/^host: //p')"
mkdir -p src-tauri/binaries

for bin in ffmpeg ffprobe; do
  src="$(command -v "$bin" || true)"
  if [[ -z "$src" ]]; then
    echo "✗ No se encontró $bin en el PATH. Instálalo con: brew install ffmpeg" >&2
    exit 1
  fi
  dest="src-tauri/binaries/$bin-$TRIPLE"
  cp -L "$src" "$dest"
  # Los binarios de Homebrew vienen de solo lectura; el empaquetado de Tauri
  # necesita poder limpiarles los atributos extendidos (xattr) antes de firmar.
  chmod u+rwx,go+rx "$dest"
  echo "✓ $bin → $dest"
done
