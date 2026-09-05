/**
 * Interpreta lo que la persona tipeó en el campo numérico de cantidad
 * (reemplazo del stepper de +/-, decisión del cliente del 5 sep 2026).
 *
 * Vive en un módulo aparte de ModalConteo.tsx por la misma razón que
 * escaner-confirmacion.ts: es lógica pura, así que se puede probar de
 * verdad sin montar el componente.
 */
export type ResultadoCantidad = { ok: true; valor: number } | { ok: false; mensaje: string };

const SOLO_DIGITOS = /^[0-9]+$/;

/**
 * Solo enteros >= 0: sin coma, sin punto decimal, sin signo, sin letras.
 * El campo vacío (mientras la persona borra todo para volver a tipear)
 * se interpreta como 0 — cero es un valor válido ("no hay el producto"),
 * no un estado de error.
 */
export function interpretarCantidad(texto: string): ResultadoCantidad {
  const limpio = texto.trim();
  if (limpio === '') return { ok: true, valor: 0 };
  if (!SOLO_DIGITOS.test(limpio)) {
    return { ok: false, mensaje: 'Solo números enteros, sin comas ni negativos.' };
  }
  const valor = Number(limpio);
  if (!Number.isSafeInteger(valor)) {
    return { ok: false, mensaje: 'Ese número es demasiado grande.' };
  }
  return { ok: true, valor };
}
