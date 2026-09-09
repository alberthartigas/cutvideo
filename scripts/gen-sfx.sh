#!/usr/bin/env bash
# Genera los efectos de sonido de la app. Se sintetizan aquí para que no
# dependan de ninguna librería de terceros ni arrastren licencias.
set -euo pipefail
OUT="$1"; mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Genera el efecto y lo normaliza al mismo pico (-1.5 dBFS), que si no unos
# suenan a nada y otros revientan.
g() { # g <nombre> <filtro lavfi>
  ffmpeg -v error -y -f lavfi -i "$2" -ac 2 -ar 44100 -c:a pcm_s16le "$TMP/x.wav"
  local max
  max="$(ffmpeg -v info -i "$TMP/x.wav" -af volumedetect -f null - 2>&1 |
         sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p' | head -1)"
  local gain
  gain="$(python3 -c "print(round(-1.5 - ($max), 2))")"
  ffmpeg -v error -y -i "$TMP/x.wav" -af "volume=${gain}dB" \
    -ac 2 -ar 44100 -c:a libmp3lame -q:a 4 "$OUT/$1.mp3"
}
N='anoisesrc=c=white:a=0.9'

# --- Transiciones -------------------------------------------------------
g whoosh-corto     "$N:d=0.45,highpass=f=400,lowpass=f=6000,volume='min(1,t*14)*exp(-6*t)':eval=frame,aphaser=speed=2"
g whoosh-largo     "$N:d=1.1,highpass=f=250,lowpass=f=8000,volume='(t/1.1)^2*exp(-2.2*t)*3':eval=frame,aphaser=speed=1.2"
g whoosh-reverso   "$N:d=0.9,highpass=f=300,lowpass=f=7000,volume='exp(-4*(0.9-t))':eval=frame"
g swish            "$N:d=0.3,bandpass=f=2500:w=1800,volume='sin(PI*t/0.3)':eval=frame"
g barrido          "aevalsrc='0.5*sin(2*PI*(120+2600*t*t)*t)':d=1.2,volume='min(1,t*3)*min(1,(1.2-t)*4)':eval=frame"

# --- Golpes y graves ----------------------------------------------------
g impacto          "aevalsrc='0.9*sin(2*PI*(160*exp(-7*t))*t)':d=1.0,volume='exp(-3.2*t)':eval=frame"
g impacto-seco     "aevalsrc='0.9*sin(2*PI*(220*exp(-14*t))*t)+0.25*(random(0)*2-1)*exp(-40*t)':d=0.5,volume='exp(-7*t)':eval=frame"
g subgrave         "aevalsrc='0.9*sin(2*PI*(90*exp(-2.2*t))*t)':d=2.2,volume='min(1,t*8)*exp(-1.3*t)':eval=frame"
g tambor           "aevalsrc='0.8*sin(2*PI*(190*exp(-22*t))*t)':d=0.4,volume='exp(-9*t)':eval=frame"
g platillo         "$N:d=1.6,highpass=f=4500,volume='exp(-2.6*t)':eval=frame"

# --- Tensión ------------------------------------------------------------
g riser            "aevalsrc='0.45*sin(2*PI*(180+1500*(t/2.5)^2.4)*t)':d=2.5,volume='(t/2.5)^1.6':eval=frame,aphaser=speed=2"
g riser-ruido      "$N:d=2.2,highpass=f='300',volume='(t/2.2)^2.2':eval=frame,aphaser=speed=2"
g latido           "aevalsrc='0.9*sin(2*PI*55*t)*(exp(-16*mod(t,1.1))+0.7*exp(-16*max(0,mod(t,1.1)-0.28)))':d=3.3"

# --- Interfaz -----------------------------------------------------------
g pop              "aevalsrc='0.8*sin(2*PI*(950*exp(-26*t))*t)':d=0.2,volume='exp(-16*t)':eval=frame"
g click            "$N:d=0.06,highpass=f=1800,volume='exp(-55*t)':eval=frame"
g burbuja          "aevalsrc='0.7*sin(2*PI*(420+900*t)*t)':d=0.25,volume='sin(PI*t/0.25)':eval=frame"
g campana          "aevalsrc='0.5*sin(2*PI*1568*t)+0.3*sin(2*PI*2093*t)+0.15*sin(2*PI*3136*t)':d=1.8,volume='exp(-2.4*t)':eval=frame"
g exito            "aevalsrc='0.5*sin(2*PI*(523+261*floor(min(2,t*7)))*t)':d=1.2,volume='min(1,t*30)*exp(-2.2*t)':eval=frame"
g error            "aevalsrc='0.5*sin(2*PI*(160-40*t)*t)+0.25*sin(2*PI*(80-20*t)*t)':d=0.7,volume='min(1,t*25)*exp(-3.5*t)':eval=frame"
g moneda           "aevalsrc='0.45*sin(2*PI*if(lt(t\,0.07)\,1319\,1976)*t)':d=0.5,volume='exp(-5*t)':eval=frame"
g cuenta-atras     "aevalsrc='0.5*sin(2*PI*880*t)*exp(-9*mod(t,1))':d=3.0"
g teclado          "$N:d=0.08,bandpass=f=2200:w=1400,volume='exp(-45*t)':eval=frame"
g camara           "$N:d=0.35,bandpass=f=3000:w=2600,volume='exp(-24*t)+0.6*exp(-24*max(0,t-0.13))':eval=frame"
g glitch           "aevalsrc='0.55*sin(2*PI*(300+2000*floor(mod(t*22,4))/3)*t)':d=0.6,volume='exp(-3*t)':eval=frame"
g cristal          "aevalsrc='0.35*(sin(2*PI*2637*t)+sin(2*PI*3520*t)+sin(2*PI*4186*t))/2':d=1.4,volume='exp(-3.4*t)':eval=frame"
