/**
 * Quien puede ver la matriz de auditoria. PUROS -- sin Prisma, sin Express
 * -- para testearlos sin base (mismo criterio que hojas.permisos.ts).
 *
 * Esto NO es configuracion de permisos: es la regla de negocio que sostiene
 * todo el sistema. La matriz contiene `stockErp`, el numero que los 3
 * conteos cruzados existen para NO conocer. Quien ve esta pantalla antes de
 * tiempo puede hacer que el inventario "cuadre" simplemente diciendo el
 * numero en voz alta.
 */

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import type { EstadoInventario } from '../historial/historial.permisos';

/**
 * EL ROL `conteo` NO ESTA, Y NUNCA VA A ESTAR.
 *
 * Un contador que ve el stock del ERP deja de contar a ciegas: ya no cuenta
 * lo que hay, confirma lo que el sistema espera. Todo el ciclo de 3 conteos
 * cruzados -- 8.000 items, 160 hojas, tres pasadas, el mes entero de
 * trabajo de once personas -- existe unicamente para eso. Abrirle esta
 * pantalla al rol `conteo` no seria un permiso de mas: seria vaciar de
 * sentido el proceso completo.
 */
const ROLES_CON_ACCESO: readonly Rol[] = ['administrador', 'auditor', 'coordinador'];

/**
 * Estados en los que el ciclo de conteo YA TERMINO y las cantidades estan
 * fijas. Ver prisma/schema.prisma#EstadoInventario.
 */
const ESTADOS_CERRADOS: readonly EstadoInventario[] = ['conteo_cerrado', 'liquidado', 'lacrado'];

export function inventarioCerrado(estado: EstadoInventario): boolean {
  return ESTADOS_CERRADOS.includes(estado);
}

export interface InventarioParaPermisos {
  sucursalId: number;
  estado: EstadoInventario;
}

/**
 * LA DECISION SOBRE EL COORDINADOR, y por que no es la contradiccion que
 * parece.
 *
 * Las dos fuentes parecen chocar: en la reunion Gilmer dice que el
 * coordinador no ve resultados, y el mockup le da acceso a liquidacion. No
 * chocan -- hablan de PANTALLAS DISTINTAS. El mockup le abre la Pantalla 6
 * (liquidacion: plata y nomina, el descuento de cada persona), no la
 * Pantalla 5 (la matriz ERP vs los 3 conteos). Son dos cosas diferentes y
 * solo una contiene el stock del ERP.
 *
 * Lo que decide es el conteo ciego, y el coordinador es el caso MAS
 * sensible de todos: es quien asigna las hojas y quien habla con los once
 * contadores durante la jornada. Si ve el stock del ERP con el ciclo
 * abierto, le alcanza con decir "fijate que ahi tendrian que ser 120" para
 * que el inventario cuadre sin haberse contado. Contamina mas que un
 * contador mirando su propia hoja, porque llega a todos.
 *
 * Pero esa razon SE TERMINA cuando el ciclo se cierra. Un inventario con el
 * conteo cerrado ya no se puede contaminar: las cantidades estan fijas y no
 * hay nadie contando. Ahi el coordinador tiene motivos legitimos para
 * mirar la matriz -- es quien va a explicarle al equipo por que su tienda
 * quedo con faltante.
 *
 * De ahi la regla: EL COORDINADOR VE LA MATRIZ SOLO DE INVENTARIOS
 * CERRADOS, nunca del que esta en curso. Honra a las dos fuentes en vez de
 * elegir una: Gilmer hablaba del inventario en curso (es de lo que se
 * hablaba en esa reunion) y el mockup le da visibilidad del cierre.
 *
 * `auditor` y `administrador` no tienen este recorte: auditar el inventario
 * mientras se cuenta es literalmente el trabajo del auditor (la 3ra ronda
 * es suya).
 */
export function validarAccesoALaMatriz(actor: ColaboradorAutenticado, inventario: InventarioParaPermisos): void {
  if (!ROLES_CON_ACCESO.includes(actor.rol)) {
    throw new Prohibido(
      'Tu rol no tiene acceso a la auditoria. El conteo es ciego: quien cuenta no ve el stock del ERP.',
    );
  }

  validarSucursal(actor, inventario.sucursalId);

  if (actor.rol === 'coordinador' && !inventarioCerrado(inventario.estado)) {
    throw new Prohibido(
      'La auditoria de un inventario en curso es solo del auditor: el coordinador coordina a quienes cuentan, y ver el stock del ERP antes de cerrar el ciclo rompe el conteo ciego. Vas a poder verla cuando el conteo cierre.',
    );
  }
}

/**
 * El administrador no pertenece a ninguna sucursal (sucursalId null): es
 * del sistema y ve todo. Para los otros tres roles, salir de la propia
 * tienda esta prohibido -- si no, cualquiera leeria el inventario de otra
 * sucursal cambiando un id en la URL. Mismo criterio que
 * hojas.permisos.ts#validarSucursal.
 */
export function validarSucursal(actor: ColaboradorAutenticado, sucursalIdDelInventario: number): void {
  if (actor.rol === 'administrador') return;
  if (actor.sucursalId !== sucursalIdDelInventario) {
    throw new Prohibido('Ese inventario es de otra sucursal.');
  }
}

/**
 * Si este actor puede ver la matriz de ESTE inventario, sin lanzar. Lo usa
 * el listado para marcar cada inventario como consultable o no, en vez de
 * ofrecer uno que despues devuelve 403 al abrirlo.
 */
export function puedeVerLaMatriz(actor: ColaboradorAutenticado, inventario: InventarioParaPermisos): boolean {
  try {
    validarAccesoALaMatriz(actor, inventario);
    return true;
  } catch {
    return false;
  }
}
