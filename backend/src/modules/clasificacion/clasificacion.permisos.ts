/**
 * Quien puede clasificar productos -- CERO Prisma a proposito, igual que
 * usuarios.permisos.ts: es la regla de negocio, y tiene que poder probarse
 * sin base de datos.
 *
 * SOLO el Auditor. Ni el administrador: la clasificacion empresa/empleado
 * mueve plata de un lado a otro de la liquidacion, y el cliente puso esa
 * decision en manos del Auditor. El middleware `requiereRol('auditor')` de la
 * ruta ya lo frena antes; esto es cinturon y tiradores, no el unico lugar.
 */

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';

/** Lanza Prohibido si `actor` no es Auditor. */
export function validarPermisoDeClasificacion(actor: ColaboradorAutenticado): void {
  if (actor.rol !== 'auditor') {
    throw new Prohibido('Solo el Auditor puede clasificar productos.');
  }
}
