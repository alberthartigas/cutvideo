#!/usr/bin/env bash
# Rehace la firma del actualizador después de que SignPath haya firmado los
# instaladores de Windows, y sube todo a la release.
#
# Por qué hace falta: Tauri calcula la firma del actualizador sobre el
# instalador recién empaquetado. Al firmarlo con Authenticode cambian los bytes,
# así que esa firma deja de valer. Si no se rehace, el actualizador se baja la
# versión nueva, no le cuadra la firma y la rechaza: los usuarios se quedan
# clavados en la versión que tengan.
#
# Uso: refirmar-windows.sh <etiqueta> <carpeta-con-los-firmados>
set -euo pipefail
TAG="${1:?Uso: refirmar-windows.sh <etiqueta> <carpeta>}"
FIRMADOS="${2:?Uso: refirmar-windows.sh <etiqueta> <carpeta>}"
: "${TAURI_SIGNING_PRIVATE_KEY:?Falta TAURI_SIGNING_PRIVATE_KEY}"

CLAVE="$(mktemp)"
trap 'rm -f "$CLAVE"' EXIT
printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" > "$CLAVE"

encontrados=0
for f in "$FIRMADOS"/*.exe "$FIRMADOS"/*.msi; do
  [[ -e "$f" ]] || continue
  encontrados=$((encontrados + 1))
  rm -f "$f.sig"

  salida="$(npx --yes @tauri-apps/cli signer sign \
    -f "$CLAVE" -p "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$f" 2>&1)" || {
    echo "$salida" >&2
    echo "✗ No se pudo firmar $f con la clave del actualizador" >&2
    exit 1
  }

  # Según la versión, el CLI escribe el .sig al lado del archivo o solo lo
  # imprime. Se cubren los dos casos y se para si no sale ninguna firma: subir
  # un latest.json con una firma vieja rompería el actualizador en silencio.
  if [[ ! -s "$f.sig" ]]; then
    grep -oE '[A-Za-z0-9+/=]{60,}' <<< "$salida" | tail -1 > "$f.sig"
  fi
  if [[ ! -s "$f.sig" ]]; then
    echo "✗ El CLI de Tauri no devolvió firma para $f" >&2
    exit 1
  fi
  echo "✓ $(basename "$f"): firmado y con .sig nuevo"
done

if [[ "$encontrados" -eq 0 ]]; then
  echo "✗ No hay ningún .exe ni .msi en $FIRMADOS" >&2
  exit 1
fi

# El latest.json lleva la firma de cada plataforma; hay que cambiar las de
# Windows por las que se acaban de calcular.
if gh release download "$TAG" --pattern "latest.json" --dir . --clobber 2>/dev/null; then
  python3 - latest.json "$FIRMADOS" <<'PY'
import json, pathlib, sys, urllib.parse

manifiesto, firmados = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
datos = json.loads(manifiesto.read_text())
cambios = 0
for plataforma, entrada in datos.get("platforms", {}).items():
    archivo = urllib.parse.unquote(entrada.get("url", "").rsplit("/", 1)[-1])
    sig = firmados / f"{archivo}.sig"
    if sig.exists():
        entrada["signature"] = sig.read_text().strip()
        cambios += 1
        print(f"  {plataforma}: firma nueva de {archivo}")
if not cambios:
    print("  (ninguna plataforma del latest.json coincide con lo firmado)")
manifiesto.write_text(json.dumps(datos, indent=2, ensure_ascii=False))
PY
  gh release upload "$TAG" latest.json --clobber
else
  echo "La release todavía no tiene latest.json; solo se suben los instaladores."
fi

gh release upload "$TAG" "$FIRMADOS"/* --clobber
echo "✓ Instaladores firmados subidos a $TAG"
