/**
 * Quien ve la liquidacion de una sucursal. PUROS -- sin Prisma, sin Express
 * -- para testearlos sin base (mismo criterio que auditoria.permisos.ts).
 */

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';

/**
 * EL COORDINADOR SI ENTRA ACA, y es la contracara exacta de la regla de
 * auditoria.permisos.ts -- conviene leer las dos juntas porque parecen
 * contradecirse y no lo hacen.
 *
 * La matriz de auditoria contiene `stockErp`: el numero que los 3 conteos
 * cruzados existen para no conocer. La liquidacion NO lo contiene. Es plata
 * y nomina -- faltante neto, cuota por persona, multas de asistencia -- y
 * nada de eso le dice a nadie cuanto stock espera el ERP de un articulo.
 * No hay conteo ciego que romper.
 *
 * Por eso el mockup le da al coordinador la Pantalla 6 (esta) y no la
 * Pantalla 5 (la matriz), y por eso el puerto del front dice textual "solo
 * lo usa el Coordinador (cierre de fin de mes, pantalla 6)". Las dos
 * fuentes que parecian chocar hablaban de pantallas distintas.
 *
 * `conteo` no esta: el descuento de cada companero no es asunto de quien
 * cuenta. Cada persona vera el suyo en el recibo, no la planilla de los once.
 */
const ROLES_CON_ACCESO: readonly Rol[] = ['administrador', 'auditor', 'coordinador'];

export function validarAcceso(actor: ColaboradorAutenticado, sucursalId: number): void {
  if (!ROLES_CON_ACCESO.includes(actor.rol)) {
    throw new Prohibido('Tu rol no tiene acceso a la liquidacion de la sucursal.');
  }
  // El administrador no pertenece a ninguna tienda: ve todas. Los otros dos
  // roles, solo la suya -- si no, cualquiera leeria la nomina de otra
  // sucursal cambiando un id en la URL.
  if (actor.rol !== 'administrador' && actor.sucursalId !== sucursalId) {
    throw new Prohibido('Esa sucursal no es la tuya.');
  }
}
