/**
 * QUIEN PUEDE CAMBIAR UN CONTEO, Y EN QUE MOMENTO.
 *
 * PURO -- sin Prisma, sin Express -- para testearlo sin base (mismo criterio
 * que `auditoria.permisos.ts`). Vive en el modulo de inventarios y no en el
 * de hojas, aunque la correccion del Coordinador pegue en una hoja, porque lo
 * que decide todas estas reglas es el ESTADO DEL INVENTARIO: son cinco
 * ventanas de la misma maquina de estados y separarlas en dos archivos seria
 * dejar que se contradigan.
 *
 * ---------------------------------------------------------------------------
 * LA MAQUINA, EN UNA LINEA
 * ---------------------------------------------------------------------------
 *
 *   rondas 1..N  --cierra la ultima-->  sigue `en_curso`, esperando al Auditor
 *        |                                        |
 *        |                        +---------------+---------------+
 *        |                        |                               |
 *        |              abre OTRA ronda                  inicia el AJUSTE
 *        |                        |                               |
 *        +<-----------------------+                       `ajuste_auditor`
 *                                                                 |
 *                                                     cierra -> `conteo_cerrado`
 *
 * CERRAR LA ULTIMA RONDA YA NO CIERRA EL CONTEO. Es el cambio que hay que
 * tener en la cabeza para leer todo lo de abajo: el inventario se queda en
 * `en_curso` esperando una decision del Auditor, y esa espera es exactamente
 * la ventana en la que el Coordinador todavia puede corregir con la ronda ya
 * cerrada (decision del cliente).
 *
 * ---------------------------------------------------------------------------
 * LAS DOS VENTANAS, Y POR QUE NO SE SOLAPAN
 * ---------------------------------------------------------------------------
 * El Coordinador corrige mientras `en_curso`; el Auditor ajusta en
 * `ajuste_auditor`. Nunca los dos a la vez, y no es prolijidad: los dos
 * escriben la MISMA fila de `Conteo`. Si el Coordinador pudiera corregir
 * durante el ajuste, pisaria en silencio el valor que el Auditor acaba de
 * poner mirando el stock -- y el Auditor no tiene forma de enterarse, porque
 * una correccion no le avisa a nadie. El inventario se cerraria con el numero
 * de quien no vio el stock, que es al reves de lo que el cliente pidio.
 */

import { Conflicto, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import type { EstadoInventario } from '../historial/historial.permisos';

/**
 * PROVISORIO, Y ES UNA LINEA QUE HAY QUE BORRAR.
 *
 * `Inventario.estado` ya tiene `ajuste_auditor` en Postgres y en el cliente
 * generado de Prisma; el que todavia no lo tiene es el union escrito a mano
 * de `historial.permisos.ts#EstadoInventario`, que es de otro lote. Esto lo
 * ensancha acá para no bloquear ni tocar un archivo ajeno: el dia que aquel
 * union sume `'ajuste_auditor'`, este alias sobra y se reemplaza por
 * `EstadoInventario` en todo el archivo sin cambiar nada mas.
 */
export type EstadoConAjuste = EstadoInventario | 'ajuste_auditor';

/**
 * CORREGIR LO CONTADO NO ES CORREGIR EL STOCK. Regla que el cliente dejo
 * explicita, y es la linea que separa lo que este modulo permite de lo que
 * NADIE puede hacer:
 *
 *   - LO CONTADO (`Conteo.sueltas` y sus lineas de empaque) es lo que una
 *     persona afirmo haber visto en la gondola. Se equivoca, y por eso se
 *     corrige: lo corrige el Coordinador, lo corrige el Auditor, y cada
 *     cambio queda con autor, motivo, antes y despues.
 *
 *   - EL STOCK (`CatalogoItem.stockErp`) es lo que dice Dynamics. NO LO
 *     CORRIGE NADIE desde la app: ni el Auditor, ni el administrador, ni por
 *     esta via ni por el ajuste final. Es la foto del ERP tomada al abrir el
 *     mes, y es el unico lado de la comparacion que el inventario no produce
 *     -- si se pudiera editar, "cuadrar" seria escribir el numero que falta
 *     de los dos lados y el inventario entero dejaria de probar nada.
 *     (Verificado: el unico `catalogoItem.create` de `src/` es el snapshot de
 *     `d365-catalogo.service.ts`, y su `stockErp` sale del catalogo de
 *     Dynamics, nunca del cuerpo del request. No hay ningun `update` de esa
 *     tabla alcanzable por HTTP.)
 *
 * Si algun dia el stock del ERP esta mal, se arregla EN DYNAMICS y se vuelve
 * a tomar el snapshot. No hay un endpoint que lo edite, y no puede haberlo.
 *
 * ---------------------------------------------------------------------------
 * QUIEN CORRIGE Y QUIEN AJUSTA
 * ---------------------------------------------------------------------------
 * EL AUDITOR ESTA EN LAS DOS LISTAS, y no es una redundancia: son dos vias
 * que NUNCA estan abiertas a la vez (ver `validarCorreccion` y
 * `validarAjusteEnCurso`). Mientras el inventario esta en rondas corrige por
 * la misma puerta que el Coordinador; en cuanto inicia su ajuste final esa
 * puerta se le cierra y sigue por la pantalla de ajuste. Decision del
 * cliente: no dos caminos para lo mismo al mismo tiempo.
 *
 * El `administrador` entra en las dos por soporte, igual que en
 * `inventarios.routes.ts#puedeEscribir`: es quien destraba una tienda cuando
 * el que corresponde no puede entrar. Queda en el log de auditoria como
 * cualquier otro cambio.
 *
 * El rol `conteo` no esta en ninguna: quien conto no se corrige a si mismo.
 */
const ROLES_QUE_CORRIGEN: readonly Rol[] = ['coordinador', 'auditor', 'administrador'];
const ROLES_QUE_AJUSTAN: readonly Rol[] = ['auditor', 'administrador'];

/** Lo minimo del inventario que hace falta para decidir cualquiera de las cinco. */
export interface InventarioParaAjuste {
  sucursalId: number;
  estado: EstadoConAjuste;
}

/**
 * El administrador no pertenece a ninguna sucursal (`sucursalId` null) y el
 * auditor audita TODA la cadena -- correccion del cliente (2026-09-09), misma
 * regla que `auditoria.permisos.ts#validarSucursal`. El Coordinador si queda
 * atado a la suya: si no, corregiria conteos de otra tienda cambiando un id
 * en la URL, y esos conteos terminan en el sueldo de gente que no conoce.
 */
export function validarSucursal(actor: ColaboradorAutenticado, sucursalIdDelInventario: number): void {
  if (actor.rol === 'administrador' || actor.rol === 'auditor') return;
  if (actor.sucursalId !== sucursalIdDelInventario) {
    throw new Prohibido('Ese inventario es de otra sucursal.');
  }
}

/**
 * CORREGIR UN CONTEO CARGADO: `PATCH /api/hojas/:id/conteos/:productoId/corregir`.
 *
 * La usan el Coordinador Y el Auditor, y para los dos la ventana es la misma:
 * el inventario tiene que estar `en_curso`, con la ronda ABIERTA O CERRADA
 * (decision del cliente). Que valga con la ronda cerrada es lo que obliga a
 * que el ajuste del Auditor arranque con un boton y no solo al cerrar la
 * ultima ronda: si el ajuste empezara automaticamente, esta ventana no
 * existiria.
 *
 * SE CORTA EN `ajuste_auditor` PARA LOS DOS, y por razones distintas:
 *
 *   - Al Coordinador porque el Auditor ya esta escribiendo valores mirando el
 *     stock: una correccion se los pisaria en silencio.
 *   - Al Auditor porque a partir de ahi tiene SU pantalla, la del ajuste. Dos
 *     caminos abiertos a la vez para lo mismo es como terminan discrepando --
 *     decision del cliente, textual: no dos vias para lo mismo al mismo
 *     tiempo.
 *
 * LO QUE NO ES IGUAL PARA LOS DOS ES QUE VEN. El Auditor ve el `stockErp` al
 * corregir y el Coordinador no. No se decide aca sino en lo que el endpoint
 * DEVUELVE (`hojas.service.ts#corregirConteo`), y no con una lista de roles
 * nueva sino reusando `auditoria.permisos.ts#puedeVerLaMatriz`: quien ya
 * puede ver el stock de ESE inventario en su panel lo ve tambien aca, y a
 * quien no, se le sigue ocultando. Una sola definicion de quien ve el numero
 * del ERP.
 *
 * Para el Coordinador eso da `false` con el inventario en rondas, que es todo
 * el conteo ciego: si viera el stock mientras corrige, dejaria de corregir un
 * error de conteo y pasaria a hacer que el inventario cuadre.
 */
export function validarCorreccion(actor: ColaboradorAutenticado, inventario: InventarioParaAjuste): void {
  if (!ROLES_QUE_CORRIGEN.includes(actor.rol)) {
    // Decir quien SI, para que quien lee sepa a quien pedirselo (mismo
    // criterio que `liquidacion.permisos.ts#validarAcceso`).
    throw new Prohibido(
      'Corregir un conteo cargado es del Coordinador de la tienda o del Auditor: ' +
        'tu rol no puede cambiar lo que otro conto.',
    );
  }
  validarSucursal(actor, inventario.sucursalId);

  if (inventario.estado === 'ajuste_auditor') {
    // El mensaje sirve para los dos roles que llegan hasta aca, y les dice
    // cosas distintas sin tener que ramificar: al Coordinador, que el valor
    // paso a otras manos; al Auditor, que su via ahora es la pantalla de
    // ajuste. Los dos necesitan lo mismo -- saber por donde sigue.
    throw new Conflicto(
      'El ajuste final de este inventario ya esta iniciado: desde ahora los valores se cambian ahí, ' +
        'en la pantalla de ajuste del Auditor, que es la única que compara contra el stock. ' +
        'Una correccion por esta via pisaria ese trabajo sin que nadie se entere.',
    );
  }
  if (inventario.estado !== 'en_curso') {
    throw new Conflicto(
      'El conteo de este inventario ya esta cerrado: los valores quedaron firmes y pasaron a liquidacion.',
    );
  }
}

/**
 * ABRIR UNA RONDA EXTRA: `POST /api/inventarios/:id/rondas/abrir`.
 *
 * Es del AUDITOR y no del Coordinador, aunque el Coordinador sea quien cierra
 * las rondas del ciclo: lo que el cliente pidio es que el Auditor decida si
 * hace falta otra pasada. El Coordinador cierra el tramo automatico; de ahi
 * en adelante decide el que audita.
 *
 * Ventana: `en_curso`. Una vez iniciado el ajuste no se vuelve atras -- el
 * Auditor ya empezo a escribir valores mirando el stock, y abrir una ronda
 * despues mandaria a contar a ciegas algo que ya tiene un valor decidido con
 * el stock a la vista.
 *
 * Que la ULTIMA RONDA este cerrada no se valida acá: es un dato de la base
 * (hay hojas sin finalizar, existe la ronda siguiente) y lo chequea el
 * service, que puede preguntarselo. Acá solo vive lo que se decide con el rol
 * y el estado.
 */
export function validarAbrirRondaExtra(actor: ColaboradorAutenticado, inventario: InventarioParaAjuste): void {
  validarRolDelAjuste(actor, 'abrir otra ronda de conteo');
  validarSucursal(actor, inventario.sucursalId);

  if (inventario.estado === 'ajuste_auditor') {
    throw new Conflicto(
      'Ya iniciaste el ajuste final de este inventario: no se pueden abrir mas rondas. ' +
        'El ajuste es el ultimo paso del conteo.',
    );
  }
  validarSigueEnCurso(inventario);
}

/**
 * INICIAR EL AJUSTE: `POST /api/inventarios/:id/ajuste/iniciar` -- `en_curso`
 * pasa a `ajuste_auditor`.
 *
 * ARRANCA CON UN BOTON, no al cerrar la ultima ronda (decision del cliente).
 * El motivo es la ventana del Coordinador: entre que se cierra la ultima
 * ronda y que el Auditor aprieta esto, el Coordinador todavia puede corregir
 * lo que cargaron los contadores. Si el ajuste empezara solo, esa ventana
 * duraria cero.
 *
 * Es idempotente en el service (iniciar dos veces no rompe), pero acá se
 * rechaza igual: apretar el boton cuando ya estas adentro es señal de que la
 * pantalla se desincronizo, y decirlo es mejor que no hacer nada en silencio.
 */
export function validarIniciarAjuste(actor: ColaboradorAutenticado, inventario: InventarioParaAjuste): void {
  validarRolDelAjuste(actor, 'iniciar el ajuste final');
  validarSucursal(actor, inventario.sucursalId);

  if (inventario.estado === 'ajuste_auditor') {
    throw new Conflicto('El ajuste final de este inventario ya esta iniciado.');
  }
  validarSigueEnCurso(inventario);
}

/**
 * AJUSTAR UN VALOR y CERRAR EL AJUSTE: solo con el inventario ya en
 * `ajuste_auditor`.
 *
 * La misma ventana para las dos porque son el mismo tramo: el Auditor entra
 * al ajuste, cambia lo que tenga que cambiar y lo cierra. Fuera de ese tramo
 * no hay nada que ajustar ni que cerrar.
 *
 * ACA SI SE VE EL STOCK, y es la diferencia con la correccion del
 * Coordinador: el trabajo del Auditor es comparar contra el ERP. Por eso el
 * ajuste esta separado en su propio estado y no es "la correccion, pero del
 * auditor" -- el conteo ciego se levanta recien acá, cuando ya no queda nadie
 * contando.
 */
export function validarAjusteEnCurso(actor: ColaboradorAutenticado, inventario: InventarioParaAjuste, accion: string): void {
  validarRolDelAjuste(actor, accion);
  validarSucursal(actor, inventario.sucursalId);

  if (inventario.estado === 'en_curso') {
    throw new Conflicto(
      'El ajuste final de este inventario todavia no esta iniciado. ' +
        'Inicialo primero: hasta entonces el Coordinador puede seguir corrigiendo conteos.',
    );
  }
  if (inventario.estado !== 'ajuste_auditor') {
    throw new Conflicto('El conteo de este inventario ya esta cerrado: el ajuste final termino.');
  }
}

function validarRolDelAjuste(actor: ColaboradorAutenticado, accion: string): void {
  if (!ROLES_QUE_AJUSTAN.includes(actor.rol)) {
    throw new Prohibido(`El ajuste final del conteo es del Auditor: tu rol no puede ${accion}.`);
  }
}

/**
 * El mensaje de "ya no estas a tiempo" para los dos botones del Auditor que
 * viven en `en_curso`. Sale acá y no repetido en cada uno para que los dos
 * digan lo mismo: son el mismo hecho.
 */
function validarSigueEnCurso(inventario: InventarioParaAjuste): void {
  if (inventario.estado !== 'en_curso') {
    throw new Conflicto(
      'El conteo de este inventario ya esta cerrado: no se puede volver a abrir. ' +
        'Si falta recontar algo, entra en el inventario del mes que viene.',
    );
  }
}
