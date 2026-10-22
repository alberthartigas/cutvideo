# Código copiado de FilmCraft

Crates `color`, `scopes` y `audio-dsp` de <https://github.com/storytold/filmcraft>
(commit en `COMMIT`), con licencia MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`).

Cambios respecto al original: los `Cargo.toml` ya no heredan del workspace de
FilmCraft y se quitaron los tests que dependían de `filmcraft-testkit`/`proptest`.
No se toca el código fuente para poder actualizar copiando de nuevo.

Además, `src-tauri/src/grade.rs` es una adaptación (camino SDR, sin viñeta ni
nitidez) de `fn lumetri` en `crates/render/src/effects.rs`, y los looks de
`src/lib/effects/grade.svelte.ts` usan los valores de `lumetri_presets.rs`.
