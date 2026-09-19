/**
 * QUIÉN PASA LISTA Y HASTA CUÁNDO. PURO -- sin Prisma, sin Express -- para
 * testearlo sin base (mismo criterio que `auditoria.permisos.ts`).
 *
 * Esto no es configuración de permisos: la asistencia registrada acá es el
 * insumo de la multa por inasistencia, que se descuenta del sueldo. Quien
 * puede escribir en esta tabla puede sacarle plata a un compañero, o
 * ahorrársela. Por eso la lista de roles es corta y la de estados, más corta
 * todavía.
 */

import { Conflicto, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import type { EstadoInventario } from '../historial/historial.permisos';

/**
 * EL ROL `conteo` NO ESTÁ, Y NO ES UN OLVIDO: nadie se marca a sí mismo
 * presente. La marca es la que decide si esa persona paga multa; dejarla en
 * manos de quien la paga sería pedirle a cada uno que declare su propio
 * descuento. La toma el coordinador, que es quien está en la tienda mirando
 * quién llegó -- es el mismo criterio con el que ya reparte las hojas.
 *
 * EL `auditor` TAMPOCO PASA LISTA. No es por desconfianza ni por alcance de
 * sucursal (el auditor audita toda la cadena, ver `auditoria.permisos.ts`):
 * es que él no estuvo en la jornada. El auditor revisa lo que otros hicieron,
 * y la planilla que cierra se apoya en estas marcas -- si además las cargara,
 * estaría auditando su propio dato.
 *
 * Lo que SÍ hace, desde las justificaciones: LEER la lista y PERDONAR faltas
 * (`ROLES_QUE_JUSTIFICAN`, más abajo). Son dos permisos distintos sobre la
 * misma pantalla y la separación es el control entero: quien registra la
 * ausencia no es quien la perdona. Si el coordinador pudiera justificar,
 * marcaría ausente a alguien y le perdonaría la falta sin que nadie más
 * intervenga, y la multa dejaría de depender de dos personas.
 *
 * El `administrador` entra por soporte, igual que en `inventarios.routes.ts`:
 * es quien destraba una tienda cuando el coordinador no puede entrar. Queda
 * en el log de auditoría como cualquier otra marca.
 */
const ROLES_QUE_PASAN_LISTA: readonly Rol[] = ['coordinador', 'administrador'];

/**
 * QUIÉN JUSTIFICA UNA FALTA: el auditor, y nadie más.
 *
 * Decisión del cliente: el auditor puede perdonar una inasistencia y entonces
 * no se aplica el descuento. Es coherente con el resto de su rol -- la
 * liquidación entera es suya (`liquidacion.permisos.ts`) y el perdón es una
 * decisión sobre la planilla, no sobre la jornada.
 *
 * EL `administrador` NO ESTÁ, y acá sí es a propósito aunque en
 * `ROLES_QUE_PASAN_LISTA` entre por soporte. Pasar lista es una tarea
 * operativa que alguien tiene que poder destrabar; perdonar una multa es una
 * decisión de negocio sobre la plata de una persona, y el administrador es un
 * rol técnico que no participa del proceso de inventario (mismo criterio que
 * `liquidacion.permisos.ts`, que también lo deja afuera).
 */
const ROLES_QUE_JUSTIFICAN: readonly Rol[] = ['auditor'];

/**
 * Los estados en los que TODAVÍA se puede justificar: hasta antes de liquidar.
 *
 * `en_curso` y `ajuste_auditor` mientras se cuenta, y `conteo_cerrado` --
 * que es el caso NORMAL, no la excepción: el reclamo aparece cuando el
 * auditor mira la planilla, y eso pasa con el conteo ya cerrado.
 *
 * `liquidado` y `lacrado` quedan afuera, y ahí está el límite de verdad: la
 * planilla ya se firmó y los montos ya se descontaron de un sueldo. Una
 * justificación tardía cambiaría un descuento que ya salió en un recibo. Y
 * `anulado` tampoco: ese inventario no produce histórico contable, no hay
 * multa que perdonar.
 */
const ESTADOS_QUE_ADMITEN_JUSTIFICAR: readonly EstadoInventario[] = [
  'en_curso',
  'ajuste_auditor',
  'conteo_cerrado',
];

/** Lo mínimo del inventario que hace falta para decidir acceso. */
export interface InventarioParaPermisos {
  sucursalId: number;
  estado: EstadoInventario;
}

/**
 * El administrador no pertenece a ninguna sucursal (`sucursalId` null): es
 * del sistema y llega a todas. El coordinador queda atado a la suya -- si no,
 * cualquiera pasaría lista en el inventario de otra tienda cambiando un id en
 * la URL, y le pondría o le sacaría la multa a gente que no conoce.
 *
 * Acá el auditor NO tiene la excepción que sí tiene en `auditoria.permisos.ts`
 * (ahí ve todas las sucursales): no porque el alcance sea otro, sino porque
 * este módulo no lo deja escribir en ninguna -- ver ROLES_QUE_PASAN_LISTA.
 */
export function validarSucursal(actor: ColaboradorAutenticado, sucursalIdDelInventario: number): void {
  if (actor.rol === 'administrador') return;
  if (actor.sucursalId !== sucursalIdDelInventario) {
    throw new Prohibido('Ese inventario es de otra sucursal.');
  }
}

/**
 * VER la lista: el mismo rol y la misma sucursal, en CUALQUIER estado.
 *
 * Que un inventario esté cerrado congela la asistencia, no la esconde. El
 * coordinador es quien le va a explicar al equipo por qué a Delia le
 * descontaron dos días, y esa conversación pasa después del cierre, no antes
 * -- mandarlo a mirar la planilla (que no puede ver, ver
 * `liquidacion.permisos.ts`) sería dejarlo sin la respuesta.
 */
export function validarLectura(actor: ColaboradorAutenticado, inventario: InventarioParaPermisos): void {
  // El AUDITOR lee sin recorte de sucursal: audita toda la cadena (corrección
  // del cliente, 2026-09-09), y desde que puede justificar faltas necesita
  // ver la lista para saber a quién le está perdonando qué día. Escribir
  // marcas sigue sin poder -- eso lo corta `validarRegistro`.
  if (ROLES_QUE_JUSTIFICAN.includes(actor.rol)) return;

  if (!ROLES_QUE_PASAN_LISTA.includes(actor.rol)) {
    // Decir quién SÍ: quien lee esto tiene que saber a quién pedírselo
    // (mismo criterio que `liquidacion.permisos.ts#validarAcceso`).
    throw new Prohibido('La asistencia la registra el coordinador de la tienda: tu rol no tiene acceso.');
  }
  validarSucursal(actor, inventario.sucursalId);
}

/**
 * ESCRIBIR (marcar o borrar una marca): lo mismo, pero SOLO con el inventario
 * `en_curso`.
 *
 * El límite no es una formalidad. Al cerrar el conteo se congela
 * `ResultadoInventario.diasDelInventario` -- el denominador de todas las
 * multas del mes (ver `dominio/asistencia.ts#diasDelInventario`). Una marca
 * agregada después caería en un día que ese número congelado no cuenta: la
 * planilla diría que el inventario duró 3 días mientras la tabla muestra 4,
 * y la multa de todos saldría de un total que ya no coincide con el detalle.
 * Peor todavía si el mes ya se liquidó: los descuentos están pagados y la
 * planilla la firmó alguien.
 *
 * Por eso `Conflicto` (409) y no `Prohibido` (403): el rol es el correcto, lo
 * que no da es el momento. Y el mensaje lo dice, porque quien se lo encuentra
 * necesita saber que el problema no se arregla pidiendo permisos.
 */
export function validarRegistro(actor: ColaboradorAutenticado, inventario: InventarioParaPermisos): void {
  // NO se apoya en `validarLectura`: desde que el auditor lee, esa función lo
  // deja pasar, y pasar lista sigue sin ser suyo. El rol se vuelve a chequear
  // acá contra la lista corta.
  if (!ROLES_QUE_PASAN_LISTA.includes(actor.rol)) {
    throw new Prohibido('La asistencia la registra el coordinador de la tienda: tu rol no tiene acceso.');
  }
  validarSucursal(actor, inventario.sucursalId);

  if (inventario.estado !== 'en_curso') {
    throw new Conflicto(
      'El conteo de este inventario ya cerró: la asistencia quedó firme y no se puede cambiar. ' +
        'Si falta o sobra una marca, es un reclamo para el auditor.',
    );
  }
}

/**
 * JUSTIFICAR (o dar de baja una justificación): sólo el auditor, y sólo hasta
 * antes de liquidar.
 *
 * Sin recorte por sucursal, igual que el resto de lo que hace el auditor: no
 * hay tienda que le sea ajena.
 *
 * Los dos errores dicen cosas distintas a propósito. `Prohibido` (403) es
 * "este no es tu rol" y no se arregla esperando; `Conflicto` (409) es "el rol
 * es el correcto, lo que no da es el momento", y quien se lo encuentra tiene
 * que entender que pedir permisos no lo va a destrabar -- el mismo criterio
 * que `validarRegistro`.
 */
export function validarJustificacion(actor: ColaboradorAutenticado, inventario: InventarioParaPermisos): void {
  if (!ROLES_QUE_JUSTIFICAN.includes(actor.rol)) {
    throw new Prohibido(
      'Las faltas las justifica el auditor: tu rol no puede perdonar una multa por inasistencia.',
    );
  }

  if (!ESTADOS_QUE_ADMITEN_JUSTIFICAR.includes(inventario.estado)) {
    throw new Conflicto(
      'La planilla de este inventario ya se cerró: las justificaciones cambian la multa, y esa multa ya se descontó. ' +
        'Cualquier ajuste entra en el período siguiente.',
    );
  }
}
