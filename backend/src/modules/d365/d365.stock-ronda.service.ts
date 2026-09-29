/**
 * ===========================================================================
 * EL STOCK DEL ERP DE UN RECONTEO: `POST /api/inventarios/:id/rondas/:n/stock`
 * ===========================================================================
 *
 * DECISION DEL CLIENTE (2026-09-29): CADA RECONTEO TRAE STOCK NUEVO, y solo
 * de los faltantes y sobrantes que arrastra esa ronda.
 *
 * Hasta hoy el stock se bajaba UNA vez -- `CatalogoItem.stockErp`, la foto de
 * Dynamics al preparar el inventario -- y las tres rondas se comparaban contra
 * esa misma vara. El primer conteo es el dia 22 y los reconteos son los dias
 * que siguen: entre ronda y ronda la tienda vendio, recibio mercaderia y
 * Jocelyn parcho negativos a mano. Comparar el reconteo del dia 24 contra el
 * stock del 22 inventa diferencias que no estan en la gondola, y esas
 * diferencias se descuentan del sueldo de alguien.
 *
 * Este modulo es la DESCARGA. Donde se guarda (`StockRonda`) y como lo lee el
 * calculo (`auditoria.calculos.ts#stockDeLaMedicion`) son de min-1; aca esta
 * solo el "traelo de Dynamics y escribilo".
 *
 * ---------------------------------------------------------------------------
 * CUANTO TARDA -- MEDIDO, NO ESTIMADO
 * ---------------------------------------------------------------------------
 * Todo medido el 2026-09-29 contra el tenant real, almacen MD01_LUZ (Market
 * Luzuriaga), sobre el inventario 8078 de desarrollo.
 *
 * EL CASO CHICO, de punta a punta del POST y con los 6 items que arrastraba su
 * ronda 4:
 *
 *     primera llamada    2.733 ms   incluye pedirle el token a Azure
 *     segunda llamada      569 ms   token ya en cache -- este es el numero real
 *
 * Los 2,2 s de diferencia son el token, no la descarga: lo cachea
 * `d365-auth.service.ts` y solo lo paga la primera operacion del proceso (o la
 * primera despues de que venza). Si el Coordinador ya tomo el snapshot, ese
 * costo esta pagado.
 *
 * LA DESCARGA SOLA, por cantidad de codigos (sin el token, sin la base):
 *
 *       6 codigos   1 lote      474 ms
 *      80 codigos   1 lote      961 ms
 *     130 codigos   2 lotes   1.642 ms      <- la 3ra ronda del ejemplo del cliente
 *     240 codigos   3 lotes   3.526 ms
 *     650 codigos   9 lotes   7.591 ms      <- la 2da ronda del ejemplo del cliente
 *
 * O sea ~0,8-1,2 s por lote de 80 (`CODIGOS_POR_CONSULTA`): un caso real de
 * unos cientos de items son 2 a 4 segundos, y el peor caso plausible -- los 650
 * de la segunda ronda del ejemplo -- no llega a 8. El tiempo lo domina la
 * latencia por lote (un `$count` mas una pagina), no la cantidad de filas.
 *
 * Dos ordenes de magnitud menos que el snapshot completo (~90 s por 951 items
 * bajados, medido el 2026-09-05; varios minutos con los 11.863 del catalogo),
 * y por eso este endpoint puede ser un boton que se aprieta en cada ronda.
 * El progreso existe igual -- ver `d365.progreso.ts` --: 8 segundos sin nada
 * en pantalla tambien se leen como "se colgo".
 *
 * Y UN DATO QUE NO ES DEL RENDIMIENTO PERO SALIO DE LA MISMA MEDICION, porque
 * es la razon de ser de todo esto: de 650 items que el snapshot habia guardado
 * CON existencia en MD01_LUZ, hoy el ERP devuelve 637. Trece items que tenian
 * stock al abrir el mes ya no tienen fila en ese almacen. Contra la vara
 * congelada esos trece se recontarian contra un numero que Dynamics ya no
 * sostiene.
 *
 * ---------------------------------------------------------------------------
 * EL ORDEN IMPORTA: ESTO CORRE **ANTES** DE QUE EXISTAN LAS HOJAS DE LA RONDA
 * ---------------------------------------------------------------------------
 * `rondas.service.ts#universoDeLaRonda` saca los productos de las HOJAS de esa
 * ronda. Cuando el Coordinador pide el stock de la ronda N todavia no hay
 * ninguna hoja de la ronda N, asi que ese camino devolveria una lista vacia y
 * el endpoint contestaria "0 items" sin que nada falle.
 *
 * Por eso el conjunto se deriva de la comparacion de la RONDA ANTERIOR:
 * exactamente lo que hace el cliente -- filtra los faltantes y sobrantes de la
 * pasada y recien a ESOS les pide stock nuevo. Y se compara contra el stock CON
 * QUE SE MIDIO ESA PASADA, no contra el nuevo: el nuevo es el que se esta yendo
 * a buscar, y usarlo para decidir a quien buscar seria circular.
 *
 * Funciona igual si las hojas YA existen (hoy `cerrar()` las crea al cerrar la
 * ronda anterior): no las mira. El unico insumo es la ronda N-1.
 *
 * LA COMPARACION NO SE REESCRIBE ACA. Son las dos MISMAS funciones que usa
 * `rondas.service.ts#cerrar`, en el mismo orden: `universoDeLaRonda` para armar
 * la ronda anterior con el stock de cada item ya resuelto, y
 * `ciclo-conteos.ts#itemsParaLaRondaSiguiente` para decidir quien arrastra. Ver
 * `codigosQueArrastraLaRonda`, que son dos lineas justamente por eso.
 *
 * ---------------------------------------------------------------------------
 * LA RONDA 1 NO PASA POR ACA
 * ---------------------------------------------------------------------------
 * Su stock es el snapshot completo del catalogo, y lo escribe
 * `d365-catalogo.service.ts#guardarSnapshot` -- las filas de `stock_rondas` con
 * `numeroConteo = 1` salen de la MISMA transaccion que `catalogo_items`. Este
 * endpoint rechaza la ronda 1 con un 400 que lo dice.
 */

import { prisma } from '../../config/database';
import { itemsParaLaRondaSiguiente } from '../../dominio/ciclo-conteos';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, ErrorHttp, NoEncontrado, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarSucursal } from '../inventarios/ajuste.permisos';
import { universoDeLaRonda } from '../inventarios/rondas.service';
import { mensajeSinAlmacen } from '../tiendas/tiendas.almacen';
import { d365AuthService } from './d365-auth.service';
import { stockDeCodigos } from './d365-catalogo.service';
import * as progreso from './d365.progreso';

export interface StockDeRondaDto {
  inventarioId: number;
  /** La ronda que quedo con vara nueva. */
  numeroConteo: number;
  /** Cuantos items arrastraba la ronda: las filas de `StockRonda` que quedaron escritas. */
  items: number;
  /**
   * De esos, cuantos el ERP NO devolvio: quedaron en `stockErp: null`, que no
   * es 0 (ver `StockRonda.stockErp`). Va en la respuesta porque es lo unico
   * accionable que puede salir mal sin que nada falle: un item que el ERP dejo
   * de tener en el almacen no se puede auditar, y alguien tiene que ir a
   * mirarlo a Dynamics. Mismo criterio que `descartes` en el snapshot.
   */
  sinStockEnErp: number;
  /**
   * ISO del instante de la descarga -- el mismo para TODAS las filas. Es lo
   * que muestra la pantalla del Coordinador ("stock del ERP traido a las
   * 14:32") y lo que permite auditar, meses despues, contra que foto se
   * comparo ese reconteo.
   */
  tomadoEn: string;
}

/**
 * LOS CODIGOS QUE ARRASTRA LA RONDA `ronda`: los que no cuadraron en la
 * anterior.
 *
 * DOS LINEAS, Y LAS DOS SON PRESTADAS A PROPOSITO:
 *
 *   · `universoDeLaRonda` (`rondas.service.ts`) arma el universo de la ronda
 *     anterior -- sus productos, lo contado en cada pasada y el stock CON QUE SE
 *     MIDIO cada item, ya resuelto por `stockDeLaMedicion`.
 *   · `itemsParaLaRondaSiguiente` (`dominio/ciclo-conteos.ts`) decide quien pasa.
 *
 * SON EXACTAMENTE LAS DOS QUE USA `rondas.service.ts#cerrar`, en el mismo orden,
 * y eso es todo el diseño de esta funcion. El conjunto al que se le baja stock
 * nuevo y el conjunto que el cierre manda a recontar tienen que ser EL MISMO: si
 * fueran dos calculos parecidos, habria items con vara nueva que nadie cuenta e
 * items recontados contra el stock del dia 22, y la diferencia aparece recien en
 * el descuento de alguien a fin de mes.
 *
 * Esto ERA una copia de 60 lineas -- `contadoHastaLaRonda` duplicada incluida --
 * mientras `rondas.service.ts` estaba en manos de min-1. Ya no: la copia se
 * borro y `universoDeLaRonda` quedo exportada.
 *
 * OJO CON EL ARGUMENTO, que es el unico lugar donde esto se puede errar: se pide
 * el universo de `ronda - 1`. `universoDeLaRonda` saca los productos de las
 * HOJAS de la ronda que recibe, y las hojas de `ronda` todavia no existen cuando
 * el Coordinador aprieta este boton -- pedirle `ronda` devolveria una lista
 * vacia y el endpoint contestaria "0 items" sin que nada falle.
 *
 * Conserva el orden de los `Producto` de la ronda anterior, que es el recorrido
 * de la tienda con el que se armaron las hojas. No importa para la consulta a
 * Dynamics; importa para poder cruzar el log a ojo contra la hoja.
 */
export async function codigosQueArrastraLaRonda(inventarioId: number, ronda: number): Promise<string[]> {
  const universo = await universoDeLaRonda(inventarioId, ronda - 1);
  return itemsParaLaRondaSiguiente(universo).map((i) => i.codigo);
}

/** Lo minimo del inventario y su tienda para decidir y para poder consultar el ERP. */
async function inventarioParaLaDescarga(inventarioId: number) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: {
      id: true,
      sucursalId: true,
      estado: true,
      ultimaRondaCerrada: true,
      sucursal: { select: { nombre: true, almacenId: true } },
    },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');
  return inventario;
}

/**
 * LAS GUARDAS, en el orden en que le sirven a quien recibe el error.
 *
 * `validarSucursal` se REUSA de `ajuste.permisos.ts` y no se reescribe: es la
 * misma pregunta que ya se hace en el ajuste y en la auditoria (el
 * administrador no pertenece a ninguna tienda; el auditor ve la cadena
 * entera; el Coordinador queda atado a la suya). El rol ya lo filtro la ruta
 * -- administrador y coordinador, el mismo criterio que `POST /api/d365/snapshot`.
 */
function validarPuedeBajarStock(
  actor: ColaboradorAutenticado,
  inventario: Awaited<ReturnType<typeof inventarioParaLaDescarga>>,
  ronda: number,
): void {
  validarSucursal(actor, inventario.sucursalId);

  /**
   * EL AJUSTE FINAL YA EMPEZO: no hay ninguna ronda mas que preparar, y
   * ademas el Auditor esta escribiendo valores MIRANDO el stock de la ultima
   * ronda. Bajarle una vara nueva abajo le cambiaria los numeros a mitad de su
   * revision. Mismo corte y casi el mismo texto que
   * `ajuste.permisos.ts#validarAbrirRondaExtra`, que es la operacion para la
   * que este endpoint prepara el terreno.
   */
  if (inventario.estado === 'ajuste_auditor') {
    throw new Conflicto(
      'Ya se inicio el ajuste final de este inventario: no se pueden abrir mas rondas, asi que no hay ' +
        'ninguna a la que traerle stock nuevo. El ajuste es el ultimo paso del conteo.',
    );
  }
  if (inventario.estado !== 'en_curso') {
    // Sin el enum crudo en el mensaje: `conteo_cerrado` es un valor de
    // Postgres y no le dice nada a quien lo lee.
    throw new Conflicto(
      'El conteo de este inventario ya esta cerrado: no se pueden abrir mas rondas. ' +
        'Si falta recontar algo, entra en el inventario del mes que viene.',
    );
  }

  /**
   * LA RONDA ANTERIOR TIENE QUE ESTAR CERRADA, y no es una formalidad: los
   * items que arrastra una ronda son los que no cuadraron en la anterior, y
   * mientras esa siga abierta ese conjunto cambia con cada hoja que entra.
   * Bajar el stock antes dejaria vara nueva para unos items y ninguna para los
   * que descuadren despues -- media ronda medida contra el ERP de hoy y media
   * contra el del dia 22.
   *
   * La marca es `Inventario.ultimaRondaCerrada`, la misma que usa
   * `rondas.service.ts#cerrar` para no cerrar dos veces. `>=` y no `===`: con
   * la ronda 3 ya cerrada, pedir el stock de la 2 es pedir el de una pasada
   * que ya se conto.
   */
  const anterior = ronda - 1;
  if (inventario.ultimaRondaCerrada === null || inventario.ultimaRondaCerrada < anterior) {
    const cerrada = inventario.ultimaRondaCerrada ?? 0;
    throw new Conflicto(
      `Para traer el stock del conteo ${ronda} hay que cerrar antes el conteo ${anterior}: los items que se ` +
        `recuentan son los que no cuadraron en el, y mientras siga abierto ese grupo cambia con cada hoja que ` +
        `llega. ${cerrada === 0 ? 'Todavia no se cerro ningun conteo.' : `El ultimo cerrado es el ${cerrada}.`}`,
    );
  }
}

/**
 * TRAE EL STOCK DE HOY PARA LOS ITEMS QUE ARRASTRA LA RONDA, Y LO GUARDA.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENTE: VOLVER A LLAMARLO REEMPLAZA LA RONDA ENTERA
 * ---------------------------------------------------------------------------
 * El Coordinador tiene que poder reintentar -- la primera descarga puede haber
 * salido a medias, o la WiFi de la tienda se corta a mitad --, y dos toques
 * del boton NO pueden dejar media ronda medida contra el ERP de las 14:30 y
 * media contra el de las 14:35. Asi que:
 *
 *   · `deleteMany` + `createMany` de la ronda completa, en UNA transaccion. No
 *     un `upsert` por codigo: si el conjunto que arrastra la ronda cambio
 *     entre las dos llamadas (alguien corrigio un conteo con la ronda ya
 *     cerrada, que `ajuste.permisos.ts` permite a proposito), el upsert
 *     dejaria las filas viejas de los items que ya no arrastran. Borrar y
 *     reescribir deja la ronda diciendo exactamente lo que la comparacion dice
 *     hoy.
 *   · UN SOLO `tomadoEn` para todas las filas, calculado antes del insert. Es
 *     lo que hace que la fecha de la pantalla signifique algo: "el stock de
 *     esta ronda se bajo a las 14:32", no "cada item cuando le toco".
 *   · La transaccion abre DESPUES de hablar con Dynamics, nunca alrededor. Una
 *     transaccion de Postgres abierta durante segundos de red es una tabla
 *     bloqueada por la latencia de un tercero.
 *
 * Dos llamadas simultaneas no pueden mezclarse: cada una borra e inserta la
 * ronda completa, asi que gana entera la que commitee ultimo. Se pierde una
 * descarga, no se mezclan dos.
 */
export async function bajarStockDeLaRonda(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  ronda: number,
): Promise<StockDeRondaDto> {
  /**
   * LA RONDA 1 NO VA POR ACA, y el rechazo dice por que en vez de un 400
   * generico: el stock de la ronda 1 lo trae el snapshot completo del paso 1
   * del wizard, que baja el catalogo entero del almacen. Pedirlo de nuevo por
   * aca traeria el stock de los items que arrastra "la ronda 0", que no
   * existe.
   *
   * Es 400 y no 409: no depende del estado del inventario -- la ronda 1 nunca
   * tiene stock propio, en ningun inventario y en ningun momento.
   */
  if (ronda <= 1) {
    throw new SolicitudInvalida(
      'El stock del primer conteo no se baja por aca: lo trae el snapshot completo del catalogo, cuando se ' +
        'prepara el inventario (paso 1 del wizard, POST /api/d365/snapshot). Esta descarga es solo para los ' +
        'reconteos, que traen stock nuevo unicamente de los items que arrastran.',
    );
  }

  const inventario = await inventarioParaLaDescarga(inventarioId);
  validarPuedeBajarStock(actor, inventario, ronda);

  const codigos = await codigosQueArrastraLaRonda(inventarioId, ronda);

  /**
   * NADA QUE RECONTAR: se contesta 200 con `items: 0`, no un error.
   *
   * Que la ronda anterior haya cuadrado del todo es el caso FELIZ -- el embudo
   * del ciclo funcionando --, y ahi no hay ronda siguiente que abrir ni stock
   * que traer. Un 409 obligaria a la pantalla a tratar el mejor resultado
   * posible como una falla.
   *
   * Igual se BORRAN las filas de esa ronda, y por eso este camino tampoco es
   * un `return` seco antes de tocar la base: si una descarga anterior escribio
   * stock y despues alguien corrigio los conteos hasta que todo cuadrara,
   * dejarlas seria una vara para una ronda que ya no tiene items.
   *
   * Y NO SE TOCA DYNAMICS: sin codigos no hay nada que preguntar, asi que este
   * camino no exige ni almacen ni credenciales. Va ANTES de esas dos guardas a
   * proposito.
   */
  if (codigos.length === 0) {
    const tomadoEn = new Date();
    await prisma.stockRonda.deleteMany({ where: { inventarioId, numeroConteo: ronda } });
    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'inventario.stock_ronda_bajado',
      entidad: 'inventario',
      entidadId: inventarioId,
      detalle: { ronda, items: 0, sinStockEnErp: 0, motivo: 'la ronda anterior cuadro entera' },
    });
    return { inventarioId, numeroConteo: ronda, items: 0, sinStockEnErp: 0, tomadoEn: tomadoEn.toISOString() };
  }

  /**
   * LAS DOS PRECONDICIONES DEL ERP, con los mensajes que la pantalla sabe
   * distinguir (ver `inventario-api.ts#comoErrorSnapshot`): el texto del
   * almacen cae en `sin-almacen` -- lo arregla un Administrador en Tiendas -- y
   * el de las credenciales en `dynamics-no-configurado`, que se arregla en
   * Configuracion. Son dos salidas distintas para la persona y por eso son dos
   * mensajes distintos, no un "no se pudo traer el stock".
   *
   * El almacen sale de la SUCURSAL y no de un parametro, por lo mismo que en
   * `crearSnapshot`: un almacen que se tipea en cada llamada es un almacen que
   * alguna vez se va a tipear mal, y traer el stock de otra tienda no falla --
   * devuelve numeros que parecen validos.
   */
  const almacen = inventario.sucursal.almacenId;
  if (almacen === null) throw new ErrorHttp(400, mensajeSinAlmacen(inventario.sucursal.nombre));
  if (!(await d365AuthService.isConfigured())) {
    throw new ErrorHttp(
      400,
      'Dynamics no configurado. Configura D365_TENANT_ID/D365_CLIENT_ID/D365_CLIENT_SECRET/D365_BASE_URL ' +
        'antes de traer el stock de un reconteo.',
    );
  }

  /**
   * PROGRESO CONSULTABLE, de punta a punta. `iniciar` antes de la primera
   * llamada a Dynamics y `terminar` en un `finally`, por lo mismo que el
   * snapshot: si esto revienta a mitad, el progreso no puede quedar colgado en
   * "bajando" para siempre.
   */
  progreso.iniciarStockRonda(inventarioId, ronda, codigos.length);
  try {
    const stock = await stockDeCodigos(almacen, codigos, (resueltos, total) =>
      progreso.reportarStockRonda(inventarioId, ronda, resueltos, total),
    );

    const tomadoEn = new Date();
    const filas = codigos.map((codigo) => ({
      inventarioId,
      numeroConteo: ronda,
      codigo,
      // `?? null` y NUNCA `?? 0`, la regla del sistema entero: un item que el
      // ERP no devolvio es "no sabemos", y un 0 afirma "no deberia haber
      // ninguno" -- que se liquida. Ver `StockRonda.stockErp`.
      stockErp: stock.get(codigo) ?? null,
      tomadoEn,
    }));
    const sinStockEnErp = filas.filter((f) => f.stockErp === null).length;

    progreso.marcarGuardandoStockRonda(inventarioId, ronda);
    await prisma.$transaction(async (tx) => {
      await tx.stockRonda.deleteMany({ where: { inventarioId, numeroConteo: ronda } });
      await tx.stockRonda.createMany({ data: filas });
      // Dentro de la transaccion: si el insert hace rollback, el log no puede
      // afirmar que la ronda tiene stock nuevo.
      await registrarAuditoria(
        {
          actorId: actor.colaboradorId,
          accion: 'inventario.stock_ronda_bajado',
          entidad: 'inventario',
          entidadId: inventarioId,
          detalle: { ronda, items: filas.length, sinStockEnErp, almacen, tomadoEn: tomadoEn.toISOString() },
        },
        tx,
      );
    });

    return {
      inventarioId,
      numeroConteo: ronda,
      items: filas.length,
      sinStockEnErp,
      tomadoEn: tomadoEn.toISOString(),
    };
  } finally {
    progreso.terminarStockRonda(inventarioId, ronda);
  }
}

/**
 * Progreso de la descarga EN CURSO de esa ronda, o `null` si no hay ninguna.
 *
 * `200` con `null` y no un `404`, mismo criterio que
 * `GET /api/d365/snapshot/progreso`: "todavia no arranco" y "ya termino" son
 * respuestas validas del sondeo, no errores, y un 404 obligaria al front a
 * tratar el caso normal como falla.
 */
export function progresoDeLaDescarga(inventarioId: number, ronda: number): progreso.ProgresoStockRonda | null {
  return progreso.leerStockRonda(inventarioId, ronda);
}
