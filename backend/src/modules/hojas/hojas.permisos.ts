/**
 * Reglas de acceso a hojas y conteos. PURAS -- sin Prisma, sin Express --
 * para poder testearlas sin base de datos (mismo criterio que
 * usuarios.permisos.ts).
 *
 * El servidor es el ULTIMO candado, la app es solo el primero. Todo lo de
 * este archivo ya lo respeta el front; se vuelve a chequear igual, porque
 * "la pantalla no deja" no es una garantia: un APK viejo, un dispositivo
 * rooteado o un curl con un token valido se saltean la pantalla entera.
 */

import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';

/** Lo minimo de una hoja que hace falta para decidir acceso. */
export interface HojaParaPermisos {
  sucursalId: number;
  asignadoAId: number | null;
  asignadoA2Id: number | null;
}

/**
 * CONTEO CIEGO, primera mitad: quien puede pedir el LOTE ENTERO del
 * inventario (`alcance=todas`).
 *
 * El rol `conteo` NO esta, y no es un olvido: el puerto del front lo dice
 * textual -- "un Contador nunca deberia ver el lote entero". Ver el lote
 * completo es ver que conto el resto, y el conteo cruzado deja de ser ciego
 * en el momento en que una persona puede mirar el numero de otra.
 */
const ROLES_VISTA_DE_CONJUNTO: readonly Rol[] = ['coordinador', 'auditor', 'administrador'];

export function puedeVerTodasLasHojas(rol: Rol): boolean {
  return ROLES_VISTA_DE_CONJUNTO.includes(rol);
}

export function validarAlcance(actor: ColaboradorAutenticado, alcance: 'mias' | 'todas'): void {
  if (alcance === 'todas' && !puedeVerTodasLasHojas(actor.rol)) {
    throw new Prohibido('Tu rol solo puede ver las hojas que tenes asignadas.');
  }
}

/** Una hoja esta asignada a alguien si es cualquiera de los dos asignados. */
export function estaAsignadaA(hoja: HojaParaPermisos, colaboradorId: number): boolean {
  return hoja.asignadoAId === colaboradorId || hoja.asignadoA2Id === colaboradorId;
}

/**
 * El administrador no pertenece a ninguna sucursal (sucursalId null): es del
 * sistema y ve todo. Para los otros tres roles, salir de la propia sucursal
 * esta prohibido -- si no, cualquier coordinador leeria el inventario de otra
 * tienda con solo cambiar un id en la URL.
 */
export function validarSucursal(actor: ColaboradorAutenticado, sucursalIdDeLaHoja: number): void {
  if (actor.rol === 'administrador') return;
  if (actor.sucursalId !== sucursalIdDeLaHoja) {
    throw new Prohibido('Esa hoja es de otra sucursal.');
  }
}

/**
 * CONTEO CIEGO, segunda mitad: leer UNA hoja.
 *
 * Un contador solo abre las suyas. Coordinador/auditor pueden abrir
 * cualquiera de su sucursal (necesitan la vista de conjunto para repartir y
 * para auditar), y el administrador cualquiera.
 */
export function validarLecturaDeHoja(actor: ColaboradorAutenticado, hoja: HojaParaPermisos): void {
  validarSucursal(actor, hoja.sucursalId);
  if (actor.rol === 'conteo' && !estaAsignadaA(hoja, actor.colaboradorId)) {
    throw new Prohibido('Esa hoja no esta asignada a vos.');
  }
}

/**
 * ESCRIBIR (guardar un conteo, finalizar) exige estar ASIGNADO a la hoja.
 * Vale para todos los roles, administrador incluido.
 *
 * Es mas estricto que leer, a proposito: el inventario se audita, y la
 * pregunta "quien conto esto" tiene que tener una respuesta. Si un
 * coordinador pudiera escribir sobre una hoja que no es suya, el conteo
 * quedaria a nombre de alguien que no lo hizo. Que un rol tenga mas jerarquia
 * no lo pone frente a la gondola.
 */
export function validarEscrituraDeHoja(actor: ColaboradorAutenticado, hoja: HojaParaPermisos): void {
  validarSucursal(actor, hoja.sucursalId);
  if (!estaAsignadaA(hoja, actor.colaboradorId)) {
    throw new Prohibido('Solo quien tiene la hoja asignada puede contar en ella.');
  }
}
