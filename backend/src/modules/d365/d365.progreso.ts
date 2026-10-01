/**
 * PROGRESO DEL SNAPSHOT, consultable mientras corre.
 *
 * El problema, medido en el emulador el 2026-09-05: traer 951 items tardo
 * ~90 segundos y la pantalla mostro "0 items traidos..." TODO ese tiempo,
 * saltando a 951 recien al final. Al lado del cartel "puede tardar varios
 * minutos, no te vayas de la pantalla", un 0 inmovil se lee como "se colgo"
 * -- y el Coordinador toca Cancelar.
 *
 * ESTA FRASE DECIA OTRA COSA Y ESTABA MAL (corregido 2026-10-01). Decia: "con
 * los ~8.000 items de un almacen grande la espera es varias veces mayor", y
 * eso se contradice con el bloque de abajo, donde los ~8.000 son lo BAJADO en
 * esa misma prueba de 90 segundos. No es una imprecision de redaccion: dos
 * agentes leyeron el archivo el mismo dia y sacaron conclusiones opuestas
 * sobre si el snapshot entra o no en el corte de 230 segundos de Azure.
 *
 * LO QUE SI ES CIERTO, y es lo util: el tiempo del snapshot NO depende del
 * tamano de la tienda. `ReleasedProductsV2` se baja ENTERA -- el filtro por
 * responsable y por stock corre despues, en memoria (ver
 * d365-catalogo.service.ts#mapearCatalogo) -- asi que una tienda chica y una
 * grande bajan lo mismo y tardan lo mismo; lo que cambia es cuantos items
 * ENTRAN al final. Una tienda grande no espera mas, solo cuenta mas.
 *
 * La causa no era la pantalla: `POST /api/d365/snapshot` devuelve UNA sola
 * vez, al final, y no habia NINGUN endpoint de estado que consultar. El
 * adaptador del front ya lo dejaba escrito (mobile/lib/adaptadores/
 * inventario-api.ts): "para progreso REAL hace falta que el backend deje
 * estado consultable mientras pagina". Esto es ese estado.
 *
 * ---------------------------------------------------------------------------
 * QUE NUMERO SE REPORTA, Y POR QUE ESE
 * ---------------------------------------------------------------------------
 * El avance de la descarga de PRODUCTOS (`ReleasedProductsV2`): es la entidad
 * que define el universo del catalogo y la fase que domina el tiempo.
 *
 * OJO CON LA DIFERENCIA, que es real y no es un bug: se bajan ~8.000
 * productos de Dynamics y al inventario entran muchos menos (951 en la
 * prueba) -- el resto lo descarta el filtro de responsabilidad y stock. El
 * progreso cuenta lo BAJADO; el resultado del POST cuenta lo que ENTRO. La
 * pantalla ya distingue las dos cosas ("Se contaron los productos activos,
 * con stock en el almacen y que son responsabilidad del personal. El resto
 * quedo afuera"), asi que la barra llega a 8.000/8.000 y el cartel final
 * dice 951. Ninguno de los dos miente; miden cosas distintas.
 *
 * NO se reporta la suma de las 7 entidades que baja el snapshot: daria un
 * total enorme que no se parece a nada que la persona pueda reconocer, y el
 * puerto del front pide `{traidos, total}` de ITEMS (ver AvanceSnapshot).
 *
 * ---------------------------------------------------------------------------
 * EN MEMORIA, NO EN LA BASE
 * ---------------------------------------------------------------------------
 * Un contador que avanza por pagina son decenas de escrituras por snapshot
 * para un dato que deja de importar en cuanto termina. Vive en un Map del
 * proceso: si el backend se reinicia a mitad de un snapshot, el progreso se
 * pierde -- pero tambien se perdio el snapshot, asi que no hay estado que
 * quede inconsistente.
 *
 * La contra honesta: con varias instancias del backend detras de un balanceador,
 * el sondeo puede pegarle a la instancia que no esta bajando y ver `null`. Hoy
 * corre una sola instancia; el dia que sean varias, esto pasa a Redis o a una
 * columna. Queda escrito para que quien lo lea no lo descubra en produccion.
 */

/** Lo que ve quien sondea. Espeja `AvanceSnapshot` del puerto del front. */
export interface AvanceSnapshot {
  traidos: number;
  /**
   * `null` -- NUNCA 0 -- mientras no se sepa cuantos son. Antes del `$count`
   * de Dynamics no hay total, y un 0 ahi se dibuja como una barra llena o
   * como una division por cero. Mismo criterio que `CatalogoItem.stockErp`:
   * no saber no es un valor.
   */
  total: number | null;
}

/** Fase en la que esta el snapshot. Se expone para que el mensaje pueda cambiar. */
export type FaseSnapshot = 'bajando' | 'guardando';

export interface ProgresoSnapshot extends AvanceSnapshot {
  fase: FaseSnapshot;
  /** ISO de la ultima actualizacion -- permite detectar un snapshot colgado. */
  actualizadoEn: string;
}

// ---------------------------------------------------------------------------
// El calculo, puro
// ---------------------------------------------------------------------------

/**
 * Combina el avance de varias paginas en un solo numero, sin dejar que
 * retroceda.
 *
 * Que NO retroceda importa: las 7 entidades del snapshot se bajan con
 * `Promise.all`, asi que los callbacks de pagina llegan intercalados. Si el
 * registro tomara el ultimo valor recibido, la barra iria 500 -> 120 -> 800
 * y quien la mira dejaria de creerle. Un progreso que salta para atras es
 * peor que no tener progreso.
 */
export function avanceMonotono(anterior: number, nuevo: number): number {
  return nuevo > anterior ? nuevo : anterior;
}

/**
 * Recorta `traidos` al total conocido. Sin esto, un `$count` desactualizado
 * (Dynamics lo calcula aparte de la pagina) puede dar "8.100 de 8.000", que
 * se lee como un error del sistema aunque el snapshot este perfecto.
 */
export function acotarAlTotal(traidos: number, total: number | null): number {
  if (total === null) return traidos;
  return traidos > total ? total : traidos;
}

// ---------------------------------------------------------------------------
// El registro, con estado
// ---------------------------------------------------------------------------

const registro = new Map<number, ProgresoSnapshot>();

function ahora(): string {
  return new Date().toISOString();
}

/** Marca que arranco un snapshot para esa sucursal. Pisa cualquier anterior. */
export function iniciar(sucursalId: number): void {
  registro.set(sucursalId, { traidos: 0, total: null, fase: 'bajando', actualizadoEn: ahora() });
}

/**
 * Reporta una pagina bajada. Si no hay snapshot en curso para esa sucursal
 * NO crea uno: un reporte huerfano (de un snapshot que ya termino, o
 * cancelado) no debe resucitar un progreso que nadie esta esperando.
 */
export function reportar(sucursalId: number, traidos: number, total: number | null): void {
  const actual = registro.get(sucursalId);
  if (actual === undefined) return;

  const totalFinal = total ?? actual.total;
  registro.set(sucursalId, {
    ...actual,
    traidos: acotarAlTotal(avanceMonotono(actual.traidos, traidos), totalFinal),
    total: totalFinal,
    actualizadoEn: ahora(),
  });
}

/** Pasa a la fase de guardado (la transaccion de Postgres, que tambien tarda). */
export function marcarGuardando(sucursalId: number): void {
  const actual = registro.get(sucursalId);
  if (actual === undefined) return;
  registro.set(sucursalId, { ...actual, fase: 'guardando', actualizadoEn: ahora() });
}

/**
 * Borra el progreso. Se llama SIEMPRE al terminar -- con exito o con error --
 * desde un `finally`: un progreso que queda colgado en "bajando" para
 * siempre hace que el proximo sondeo muestre un avance de un snapshot que ya
 * no existe.
 */
export function terminar(sucursalId: number): void {
  registro.delete(sucursalId);
}

/** `null` = no hay snapshot en curso para esa sucursal. */
export function leer(sucursalId: number): ProgresoSnapshot | null {
  return registro.get(sucursalId) ?? null;
}

// ---------------------------------------------------------------------------
// EL OTRO PROGRESO: LA DESCARGA DE STOCK DE UNA RONDA
//
// `POST /api/inventarios/:id/rondas/:n/stock` baja el stock de HOY para los
// pocos items que arrastra un reconteo (ver d365.stock-ronda.service.ts).
// Tarda MUCHO menos que el snapshot -- decenas o cientos de items contra
// 11.863 -- pero tarda, y el Coordinador tiene que ver que algo pasa.
//
// SE REUSA LA MAQUINARIA DE ARRIBA Y NO SE DUPLICA: `avanceMonotono`,
// `acotarAlTotal`, `ahora` y la forma `{traidos, total, fase, actualizadoEn}`
// son las mismas, con las mismas razones (el total arranca en `null` y nunca
// en 0; el avance no retrocede; vive en memoria porque deja de importar en
// cuanto termina; la contra de las varias instancias detras de un balanceador
// es la misma y esta explicada arriba).
//
// LO QUE **NO** ENCAJA ES EL REGISTRO, y por eso hay un segundo Map en vez de
// una clave mas en el primero: `registro` esta indexado por `sucursalId` y
// esto se identifica por (inventario, ronda). Metidos en el mismo Map, el
// inventario 3 y la sucursal 3 serian la misma entrada -- un snapshot de la
// sucursal 3 borraria el progreso de la descarga del inventario 3 y la
// pantalla del Coordinador mostraria el avance del otro. Son dos espacios de
// identificadores distintos que se pisan por casualidad, y el dia que se
// pisen nadie va a mirar aca.
// ---------------------------------------------------------------------------

/** Lo que ve quien sondea la descarga de stock de una ronda. Misma forma que el snapshot. */
export interface ProgresoStockRonda extends AvanceSnapshot {
  fase: FaseSnapshot;
  actualizadoEn: string;
}

const registroStockRonda = new Map<string, ProgresoStockRonda>();

/**
 * La clave del segundo registro. String y no un numero combinado (`id * 100 +
 * ronda`): un numero compuesto se puede desarmar mal y la ronda no tiene tope
 * (el Auditor abre una 4ta y una 5ta pasada, y `RONDA_MAXIMA_ACEPTADA` es de
 * forma, no de negocio).
 */
function claveStockRonda(inventarioId: number, ronda: number): string {
  return `${inventarioId}:${ronda}`;
}

/**
 * Marca que arranco la descarga de stock de esa ronda. Pisa cualquier
 * anterior: si el Coordinador toca el boton de nuevo, el progreso que importa
 * es el de la descarga que acaba de lanzar.
 *
 * `total` se sabe DE ENTRADA y no se descubre paginando, al contrario que en
 * el snapshot: los codigos que arrastra la ronda se cuentan en la base ANTES
 * de hablar con Dynamics. Asi que la barra nace completa y no pasa por
 * `total: null` -- se acepta igual `null` en el tipo para no tener dos formas
 * de lo mismo.
 */
export function iniciarStockRonda(inventarioId: number, ronda: number, total: number | null): void {
  registroStockRonda.set(claveStockRonda(inventarioId, ronda), {
    traidos: 0,
    total,
    fase: 'bajando',
    actualizadoEn: ahora(),
  });
}

/** Un lote de codigos resuelto. Mismas reglas que `reportar`: no crea, no retrocede. */
export function reportarStockRonda(inventarioId: number, ronda: number, resueltos: number, total: number | null): void {
  const clave = claveStockRonda(inventarioId, ronda);
  const actual = registroStockRonda.get(clave);
  if (actual === undefined) return;

  const totalFinal = total ?? actual.total;
  registroStockRonda.set(clave, {
    ...actual,
    traidos: acotarAlTotal(avanceMonotono(actual.traidos, resueltos), totalFinal),
    total: totalFinal,
    actualizadoEn: ahora(),
  });
}

/** Pasa a la fase de guardado: el borrado + insercion en una transaccion. */
export function marcarGuardandoStockRonda(inventarioId: number, ronda: number): void {
  const clave = claveStockRonda(inventarioId, ronda);
  const actual = registroStockRonda.get(clave);
  if (actual === undefined) return;
  registroStockRonda.set(clave, { ...actual, fase: 'guardando', actualizadoEn: ahora() });
}

/** Siempre desde un `finally`, por lo mismo que `terminar`. */
export function terminarStockRonda(inventarioId: number, ronda: number): void {
  registroStockRonda.delete(claveStockRonda(inventarioId, ronda));
}

/** `null` = no hay ninguna descarga de stock en curso para esa ronda. */
export function leerStockRonda(inventarioId: number, ronda: number): ProgresoStockRonda | null {
  return registroStockRonda.get(claveStockRonda(inventarioId, ronda)) ?? null;
}

/** Solo para tests: deja LOS DOS registros limpios entre casos. */
export function limpiar(): void {
  registro.clear();
  registroStockRonda.clear();
}
