import type { TextData } from "./styles";

/** Presets de título listos para usar (estilo + animación), como la pestaña Texto de CapCut. */
export interface TitlePreset {
  id: string;
  name: string;
  data: Partial<TextData>;
}

const IMPACT = 'Impact, "Arial Black", Haettenschweiler, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export const TITLE_PRESETS: TitlePreset[] = [
  { id: "plain", name: "Simple", data: { animIn: "fade", animOut: "fade" } },
  { id: "pop", name: "Pop", data: { animIn: "pop", animOut: "fade", stroke: 0.05 } },
  { id: "bounce", name: "Rebote", data: { animIn: "bounce", animOut: "fade", fontFamily: IMPACT, bold: false, stroke: 0.05 } },
  { id: "typewriter", name: "Máquina", data: { animIn: "typewriter", animOut: "fade", fontFamily: '"SF Mono", Menlo, Consolas, monospace' } },
  { id: "zoom", name: "Zoom", data: { animIn: "zoom", animOut: "blur", fontFamily: IMPACT, bold: false } },
  { id: "rise", name: "Subir", data: { animIn: "rise", animOut: "fade", box: true, boxOpacity: 0.55 } },
  { id: "slide", name: "Deslizar", data: { animIn: "slide", animOut: "slide", box: true, boxColor: "#6b5cf6", boxOpacity: 0.8 } },
  { id: "wave", name: "Ola", data: { animIn: "wave", animOut: "fade", color: "#ffe066", stroke: 0.05 } },
  { id: "glitch", name: "Glitch", data: { animIn: "glitch", animOut: "glitch", color: "#7cf0ff", stroke: 0.04, strokeColor: "#0b0b12" } },
  { id: "neon", name: "Neón", data: { animIn: "fadezoom", animOut: "fade", color: "#ff5ec4", glow: true, shadow: false, stroke: 0 } },
  { id: "spin", name: "Giro", data: { animIn: "spin", animOut: "zoom", fontFamily: IMPACT, bold: false, stroke: 0.05 } },
  { id: "elastic", name: "Elástico", data: { animIn: "elastic", animOut: "pop", color: "#a3e635", stroke: 0.05 } },
  { id: "elegant", name: "Elegante", data: { animIn: "blur", animOut: "blur", fontFamily: SERIF, bold: false, stroke: 0, emphasis: "float" } },
  { id: "flash", name: "Flash", data: { animIn: "flash", animOut: "flash", fontFamily: IMPACT, bold: false, color: "#ffffff", stroke: 0.06 } },
  { id: "shake", name: "Temblor", data: { animIn: "pop", animOut: "fade", emphasis: "shake", fontFamily: IMPACT, bold: false, color: "#ff5555", stroke: 0.05 } },
  { id: "pulse", name: "Pulso", data: { animIn: "fadezoom", animOut: "fade", emphasis: "pulse", color: "#ffd166", stroke: 0.05 } },
  { id: "sweep", name: "Destello", data: { animIn: "words", animOut: "fade", emphasis: "lightsweep", highlightColor: "#ffffff", color: "#94a3b8", stroke: 0.04 } },
  { id: "banner", name: "Banda", data: { animIn: "wipe", animOut: "fade", box: true, boxColor: "#111827", boxOpacity: 0.9, color: "#ffe066", y: 0.82, fontSize: 0.06 } },
];
