// Versiones exactas de las librerías JS de Tauri en el package-lock, una por
// línea (`@tauri-apps/api@2.11.1`). Las usa el flujo de Windows, que compila
// sin el lock, para no acabar con una versión menor distinta de la de Rust.
// El CLI se deja fuera: lleva binarios nativos por plataforma.
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
for (const [name, info] of Object.entries(lock.packages)) {
  const m = name.match(/^node_modules\/(@tauri-apps\/(?!cli)[^/]+)$/);
  if (m) console.log(`${m[1]}@${info.version}`);
}
