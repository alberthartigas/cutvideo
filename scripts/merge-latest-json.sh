#!/usr/bin/env bash
# Junta en un solo latest.json las plataformas de una release: la de macOS, que
# sube el Mac del autor, y la de Windows, que sube GitHub Actions. Cada una
# escribe el suyo, así que sin esto la última en subir borra a la otra.
set -euo pipefail
TAG="${1:?Uso: merge-latest-json.sh <etiqueta>}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Todos los latest.json que haya ahora mismo en la release.
gh release download "$TAG" --pattern "latest*.json" --dir "$TMP" --clobber 2>/dev/null || true
if ! ls "$TMP"/*.json >/dev/null 2>&1; then
  echo "No hay ningún latest.json en $TAG; no hay nada que juntar."
  exit 0
fi

python3 - "$TMP" > "$TMP/latest.json.nuevo" <<'PY'
import json, pathlib, sys
dir = pathlib.Path(sys.argv[1])
plataformas, base = {}, None
# El más reciente manda en version/notes; las plataformas se acumulan.
for f in sorted(dir.glob("*.json"), key=lambda p: p.stat().st_mtime):
    d = json.loads(f.read_text())
    base = d
    plataformas.update(d.get("platforms", {}))
base["platforms"] = plataformas
print(json.dumps(base, indent=2, ensure_ascii=False))
PY

mv "$TMP/latest.json.nuevo" "$TMP/latest.json"
echo "Plataformas en el latest.json final:"
python3 -c "import json,sys;print(' '.join(json.load(open(sys.argv[1]))['platforms']))" "$TMP/latest.json"
gh release upload "$TAG" "$TMP/latest.json" --clobber
