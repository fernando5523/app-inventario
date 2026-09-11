/**
 * Quien accede a la liquidacion. PURO -- sin Prisma, sin Express -- para
 * testearlo sin base (mismo criterio que auditoria.permisos.ts).
 */

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';

/**
 * LA LIQUIDACION ES DEL AUDITOR: verla Y ejecutarla (leer la planilla y la
 * conciliacion, cargar los ajustes del mes, liquidar). Decision del cliente,
 * 2026-09-11, textual: "el Coordinador deja de ver la liquidacion y
 * ejecutarlo, ahora lo realiza el auditor". Es lo que Gilmer (el auditor,
 * dueno del proceso) dijo de los coordinadores en la reunion de requisitos:
 * "ellos no van a poder ver el resultado del inventario, eso netamente nos
 * corresponde a mi persona y a Michell".
 *
 * Por eso UN solo permiso para mirar y para ejecutar. Hasta ese dia eran dos:
 * el coordinador cerraba la planilla y el auditor solo la miraba.
 *
 * Afuera, y a proposito:
 *  - `coordinador`: ni para mirar. Lo que pidio Gilmer es que no vea el
 *    resultado, no solo que no lo ejecute.
 *  - `administrador`: es tecnico (cuentas, tiendas, credenciales de
 *    Dynamics) y no participa del proceso de inventario. No tiene la
 *    pantalla en la app; solo le quedaba el acceso por API.
 *  - `conteo`: el descuento de cada companero no es asunto de quien cuenta.
 *    Cada persona ve el suyo en el recibo, no la planilla de los once.
 *
 * Sin recorte por sucursal: el auditor audita toda la cadena (correccion del
 * cliente, 2026-09-09), asi que ninguna tienda le es ajena.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA DECISION DEJA ABIERTO -- no se decide aca
 * ---------------------------------------------------------------------------
 * El control de dos personas del lacrado (historial.permisos.ts) se apoyaba en
 * que quien cierra la planilla no la firma: el auditor quedaba afuera de
 * liquidar justamente por eso. Ahora un mismo auditor puede liquidar Y ser una
 * de las firmas. Lo que sigue exigiendo a otra persona es el minimo de firmas
 * DISTINTAS (`APROBACIONES_REQUERIDAS`, configurable): con ese minimo en 1, una
 * sola persona liquida y lacra. Impedir que quien liquido firme seria una
 * regla nueva, y la tiene que pedir el cliente.
 */
export function validarAcceso(actor: ColaboradorAutenticado): void {
  if (actor.rol !== 'auditor') {
    // Decir quien SI: quien lee esto tiene que saber a quien pedirselo, no
    // quedarse mirando la pantalla (mismo criterio que
    // historial.permisos.ts#validarPuedeAprobar).
    throw new Prohibido('La liquidación la revisa y la cierra el auditor: tu rol no tiene acceso a la planilla.');
  }
}
