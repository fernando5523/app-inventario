/**
 * Reglas del cambio de PIN PROPIO. PURAS -- sin Prisma, sin Express -- para
 * testearlas sin base (mismo criterio que usuarios.permisos.ts).
 *
 * POR QUE ESTE CAMINO TIENE QUE EXISTIR, y no alcanza con que un
 * administrador resetee los PIN uno por uno:
 *
 * Quien resetea ELIGE el PIN, asi que lo conoce. Un PIN que otra persona
 * conoce no autentica a nadie -- identifica a dos. Y este sistema apoya
 * sobre el PIN algo bastante mas serio que un login: la firma que cierra el
 * inventario del mes. Si el administrador sabe el PIN de Gilmer y el de
 * Rosa, puede entrar como los dos y completar solo la doble validacion del
 * lacrado, que es justamente el control que vinimos a construir.
 *
 * El reseteo del administrador sigue haciendo falta (alguien se olvida el
 * PIN y hay que devolverle el acceso), pero tiene que ser el camino de
 * excepcion, no el unico. El normal es que cada persona ponga uno que solo
 * ella sepa, y que el reseteo sea el punto de partida de eso.
 */

import { SolicitudInvalida } from '../../shared/errores';

/**
 * El PIN que genera el seed: el id del colaborador rellenado con ceros
 * (Maria Rojas 102 -> "000102"). La pantalla de login LISTA a todas las
 * personas con su nombre, asi que cualquiera que abra la app deduce el PIN
 * de todos, incluido el del administrador.
 *
 * Sirve para desarrollo y esta documentado, pero nadie deberia poder
 * ELEGIRLO como PIN propio: seria volver voluntariamente al agujero.
 */
export function esPinPredecible(colaboradorId: number, pin: string): boolean {
  return pin === String(colaboradorId).padStart(6, '0');
}

/**
 * PINs que no se aceptan aunque el largo sea correcto. No es una politica
 * de contrasenas completa -- con 6 digitos no hay mucho margen -- son los
 * tres patrones que cualquiera prueba primero.
 */
export function esPinTrivial(pin: string): boolean {
  // Todos los digitos iguales: 000000, 111111...
  if (/^(\d)\1{5}$/.test(pin)) return true;
  // Secuencias corridas, para arriba y para abajo.
  if ('01234567890'.includes(pin) || '09876543210'.includes(pin)) return true;
  return false;
}

export interface CambioDePin {
  colaboradorId: number;
  pinActual: string;
  pinNuevo: string;
}

/**
 * Valida la forma del cambio. NO verifica el PIN actual contra el hash --
 * eso necesita la base y vive en el service; aca esta todo lo que se puede
 * decidir mirando solo los dos valores.
 */
export function validarCambioDePin(datos: CambioDePin): void {
  if (datos.pinNuevo === datos.pinActual) {
    throw new SolicitudInvalida('El PIN nuevo tiene que ser distinto del actual.');
  }
  if (esPinPredecible(datos.colaboradorId, datos.pinNuevo)) {
    throw new SolicitudInvalida(
      'Ese PIN es el que genera el sistema a partir de tu numero de colaborador: cualquiera que vea la lista de login lo deduce. Elegi otro.',
    );
  }
  if (esPinTrivial(datos.pinNuevo)) {
    throw new SolicitudInvalida('Evita PINs como 000000, 111111 o 123456: son los primeros que alguien prueba.');
  }
}
