/**
 * Reglas del cambio de PIN propio — ESPEJO intencional de
 * backend/src/modules/sesion/sesion.pin.ts (mismos dos chequeos, mismo
 * criterio). No hay paquete compartido entre backend/ y mobile/ en este
 * monorepo, así que se duplica a propósito: el backend sigue siendo la
 * autoridad final (rechaza lo mismo aunque este archivo tuviera un bug),
 * pero sin esto la persona solo se entera de que su PIN nuevo es débil
 * DESPUÉS de un viaje a la red — con la WiFi de la tienda, eso puede
 * tardar varios segundos por algo que se podía decir al toque.
 *
 * Si `sesion.pin.ts` cambia sus reglas, este archivo tiene que cambiar
 * junto — es el motivo de que ambos casos vivan también en
 * `sesion.pin.test.ts` (backend) y `pin.test.ts` (acá), con los mismos
 * ejemplos.
 */

/**
 * El PIN que genera el seed: el id del colaborador con ceros adelante
 * (María Rojas 102 -> "000102"). La pantalla de login lista a todas las
 * personas de la sucursal con su nombre, así que cualquiera que la abra
 * deduce el PIN de todos — nadie debería poder ELEGIRLO como propio.
 */
export function esPinPredecible(colaboradorId: number, pin: string): boolean {
  return pin === String(colaboradorId).padStart(6, '0');
}

/**
 * PINs que no se aceptan aunque el largo sea correcto: los tres patrones
 * que cualquiera prueba primero. No es una política de contraseñas
 * completa — con 6 dígitos no hay mucho margen.
 */
export function esPinTrivial(pin: string): boolean {
  // Todos los dígitos iguales: 000000, 111111...
  if (/^(\d)\1{5}$/.test(pin)) return true;
  // Secuencias corridas, para arriba y para abajo.
  if ('01234567890'.includes(pin) || '09876543210'.includes(pin)) return true;
  return false;
}

/**
 * Valida el PIN NUEVO de un cambio propio. Devuelve el mensaje de rechazo
 * (para mostrarlo tal cual en un `Alert`) o `null` si el PIN se puede
 * intentar contra el backend — que es quien tiene la última palabra: esto
 * es solo para no hacerle perder un viaje a la red a alguien que ya eligió
 * un PIN débil.
 *
 * Mismos tres casos que `validarCambioDePin` del backend, mismo orden.
 */
export function validarPinNuevo(pinActual: string, pinNuevo: string, colaboradorId: number): string | null {
  if (pinNuevo === pinActual) {
    return 'El PIN nuevo tiene que ser distinto del actual.';
  }
  if (esPinPredecible(colaboradorId, pinNuevo)) {
    return 'Ese PIN es el que genera el sistema a partir de tu número de colaborador: cualquiera que vea la lista de login lo deduce. Elegí otro.';
  }
  if (esPinTrivial(pinNuevo)) {
    return 'Evitá PINs como 000000, 111111 o 123456: son los primeros que alguien prueba.';
  }
  return null;
}
