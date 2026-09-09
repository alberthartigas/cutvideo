/**
 * Stickers que vienen con la app. Son dibujos propios en SVG (no hay imágenes
 * de terceros: los memes suelen ser fotos con derechos y no se pueden
 * empaquetar). Para usar los tuyos está el botón "Añadir".
 */
export interface BuiltinSticker {
  id: string;
  name: string;
  group: string;
}

/** El prefijo distingue estos de los archivos del usuario en `mediaPath`. */
export const BUILTIN_PREFIX = "builtin:";

export const BUILTIN_STICKERS: BuiltinSticker[] = [
  { id: "cara-feliz", name: "Feliz", group: "Caras" },
  { id: "cara-risa", name: "Risa", group: "Caras" },
  { id: "cara-sorpresa", name: "Sorpresa", group: "Caras" },
  { id: "cara-gafas", name: "Gafas", group: "Caras" },
  { id: "cara-guino", name: "Guiño", group: "Caras" },
  { id: "cara-enfado", name: "Enfado", group: "Caras" },

  { id: "corazon", name: "Corazón", group: "Reacciones" },
  { id: "estrella", name: "Estrella", group: "Reacciones" },
  { id: "fuego", name: "Fuego", group: "Reacciones" },
  { id: "rayo", name: "Rayo", group: "Reacciones" },
  { id: "corona", name: "Corona", group: "Reacciones" },
  { id: "pulgar-arriba", name: "Me gusta", group: "Reacciones" },
  { id: "brillos", name: "Brillos", group: "Reacciones" },

  { id: "check", name: "Correcto", group: "Señales" },
  { id: "equis", name: "Incorrecto", group: "Señales" },
  { id: "interrogacion", name: "Duda", group: "Señales" },
  { id: "exclamacion", name: "Atención", group: "Señales" },
  { id: "bombilla", name: "Idea", group: "Señales" },

  { id: "flecha-derecha", name: "Flecha", group: "Flechas" },
  { id: "flecha-abajo", name: "Abajo", group: "Flechas" },
  { id: "flecha-curva", name: "Curva", group: "Flechas" },
  { id: "circulo-marcador", name: "Rodear", group: "Flechas" },

  { id: "bocadillo-wow", name: "¡Wow!", group: "Bocadillos" },
  { id: "bocadillo-jaja", name: "Jaja", group: "Bocadillos" },
  { id: "bocadillo-mira", name: "¡Mira!", group: "Bocadillos" },

  { id: "etiqueta-nuevo", name: "Nuevo", group: "Etiquetas" },
  { id: "etiqueta-oferta", name: "Oferta", group: "Etiquetas" },
  { id: "etiqueta-suscribete", name: "Suscríbete", group: "Etiquetas" },
  { id: "etiqueta-siguenos", name: "Sígueme", group: "Etiquetas" },
];

export const STICKER_GROUPS = [...new Set(BUILTIN_STICKERS.map((s) => s.group))];

/** Ruta que se guarda en el clip; `mediaSrc` la reconoce por el prefijo. */
export const builtinPath = (id: string) => `${BUILTIN_PREFIX}/stickers/${id}.svg`;
