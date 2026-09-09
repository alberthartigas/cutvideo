#!/usr/bin/env bash
# Publica una versión nueva: sube el número en los tres manifiestos, compila,
# firma el paquete de actualización y crea la release en GitHub.
#
#   scripts/release.sh 0.2.0
#
# Necesita `gh auth login` hecho y la clave de firma del actualizador:
#   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/cutvideo.key)"
#   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Uso: scripts/release.sh <versión>   (por ejemplo 0.2.0)" >&2
  exit 1
fi
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ -f "$HOME/.tauri/cutvideo.key" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/cutvideo.key")"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  else
    echo "✗ Falta la clave de firma del actualizador (TAURI_SIGNING_PRIVATE_KEY)." >&2
    exit 1
  fi
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "✗ Hay cambios sin guardar. Haz commit antes de publicar." >&2
  exit 1
fi

echo "→ Versión $VERSION"
python3 - "$VERSION" <<'PY'
import json, pathlib, re, sys
v = sys.argv[1]
for f in ("package.json", "src-tauri/tauri.conf.json"):
    p = pathlib.Path(f); d = json.loads(p.read_text())
    d["version"] = v
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
p = pathlib.Path("src-tauri/Cargo.toml")
p.write_text(re.sub(r'^version = "[^"]+"', f'version = "{v}"', p.read_text(), count=1, flags=re.M))
PY

echo "→ Compilando"
npm run tauri build

TARGET="$(rustc --print host-tuple 2>/dev/null || rustc -vV | sed -n 's/^host: //p')"
BUNDLE="src-tauri/target/release/bundle"
ARCHIVO="$(ls "$BUNDLE"/macos/*.app.tar.gz 2>/dev/null | head -1 || true)"
if [[ -z "$ARCHIVO" ]]; then
  echo "✗ No se generó el paquete de actualización. ¿Está createUpdaterArtifacts activado?" >&2
  exit 1
fi
FIRMA="$(cat "$ARCHIVO.sig")"
NOTAS="${NOTAS:-Mejoras y correcciones.}"

echo "→ latest.json"
python3 - "$VERSION" "$(basename "$ARCHIVO")" "$FIRMA" "$TARGET" > "$BUNDLE/latest.json" <<'PY'
import json, sys, datetime
version, archivo, firma, target = sys.argv[1:5]
plataforma = "darwin-aarch64" if "aarch64-apple" in target else \
             "darwin-x86_64" if "x86_64-apple" in target else \
             "windows-x86_64"
url = f"https://github.com/alberthartigas/cutvideo/releases/download/v{version}/{archivo}"
print(json.dumps({
    "version": version,
    "notes": "Mejoras y correcciones.",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    "platforms": {plataforma: {"signature": firma, "url": url}},
}, indent=2, ensure_ascii=False))
PY

echo "→ Publicando en GitHub"
# Si la versión ya era esa, no hay nada que guardar.
git diff --quiet || git commit -am "Versión $VERSION"
git tag "v$VERSION"
git push --follow-tags
gh release create "v$VERSION" --title "CutVideo $VERSION" --notes "$NOTAS" \
  "$ARCHIVO" "$ARCHIVO.sig" "$BUNDLE/latest.json" \
  "$BUNDLE"/dmg/CutVideo_*.dmg
echo "✓ Publicada la $VERSION"
