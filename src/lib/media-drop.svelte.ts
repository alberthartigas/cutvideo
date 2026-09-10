/**
 * Dónde caería ahora mismo el medio que se arrastra desde la lista.
 *
 * Vive fuera de los componentes porque lo escribe la página (que maneja el
 * arrastre) y lo lee el timeline (que pinta la guía de caída); pasarlo como
 * prop obligaría a encadenarlo por media interfaz.
 */
export const drop = $state<{ target: { trackId: string; time: number } | null }>({ target: null });
