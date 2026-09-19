/**
 * RECLASIFICACION AL LIQUIDAR (liquidacion v2).
 *
 * Decision del cliente, correccion sobre el diseno original: la
 * clasificacion empresa/empleado de un item se evalua AL LIQUIDAR, no al
 * abrir ni al cerrar el conteo. Motivo textual: la liquidacion la hace el
 * Auditor, y si reclasifica un producto (ej. "las cervezas ahora son
 * empresa") DESPUES de que el conteo ya cerro, tiene que aplicarse igual --
 * lo que el Auditor ve en pantalla al liquidar es lo que se liquida, y el
 * lacrado lo sella tal cual quedo en ese momento.
 *
 * Por eso ESTE archivo, y no `rondas.service.ts#cerrar` (que sigue sin
 * tocarse), es quien decide `DiferenciaItem.esEmpresa` de verdad. Lo que
 * escribe el cierre del conteo (el default `false` de la columna) es
 * PROVISORIO: se pisa aca, una sola vez, en el mismo momento en que se
 * congela el resto de la planilla.
 *
 * ---------------------------------------------------------------------------
 * DOS FUNCIONES QUE NO SE MUEVEN DOS VECES A LA VEZ EL MISMO MONTO
 * ---------------------------------------------------------------------------
 * `ResultadoInventario.montoFaltanteBruto` (congelado al cerrar el conteo, en
 * rondas.service.ts) YA INCLUYE el faltante de productos de empresa -- es
 * `resumirAuditoria(...).valorFaltante`, la suma de TODOS los faltantes, sin
 * filtrar por `esEmpresa`. La formula de `historial.calculos.ts` resta
 * `montoFaltanteEmpresa` UNA sola vez para sacarlo de ahi:
 *
 *   montoFaltanteNeto = bruto - negativos - empresa - sobranteEmpleado
 *
 * Si `montoFaltanteEmpresa` (el que devuelve `reclasificarAlLiquidar` de
 * aca) se calculara EXCLUYENDO empresa del bruto en vez de like un monto
 * APARTE que se resta, la empresa se descontaria dos veces. Por eso esta
 * funcion devuelve el faltante de empresa como un monto en positivo, para
 * restar, y nunca toca `montoFaltanteBruto`.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  claseEfectiva,
  empaqueEfectivo,
  repartirDiferencia,
  type ClaseItem,
} from '../../dominio/faltante-por-paquete';
import { redondear } from '../historial/historial.calculos';

// ---------------------------------------------------------------------------
// PURO -- sin Prisma, testeable sin base (ver liquidacion.reclasificacion.test.ts)
// ---------------------------------------------------------------------------

/**
 * Una fila de `DiferenciaItem`, con la clasificacion que tenia su
 * `CatalogoItem` (la de Dynamics de ESE inventario, sin la excepcion del
 * Auditor todavia aplicada).
 */
export interface FilaDiferenciaParaReclasificar {
  codigo: string;
  /** conteoFinal - stockSistema. Negativo = faltante, positivo = sobrante. */
  diferencia: number;
  /** null = el item no tenia precio: no se puede valorizar, pero SI se clasifica. */
  montoDiferencia: number | null;
  /** `CatalogoItem.esEmpresa` (Dynamics), congelado en el snapshot de este inventario. */
  esEmpresaCatalogo: boolean;
  /** `CatalogoItem.clase` (snapshot), sin la excepcion del Auditor aplicada. */
  claseCatalogo: ClaseItem;
  /** El denominador segun el ERP. `null` = no se pudo resolver. */
  empaqueCompra: number | null;
  /** El que corrigio el Auditor, en vivo. `null` = sin corregir. */
  empaqueCompraCorregido: number | null;
}

export interface ResultadoReclasificacion {
  /**
   * codigo -> clase EFECTIVA. La contracara de tres vias de
   * `esEmpresaPorCodigo`, y lo que hay que congelar en `DiferenciaItem.clase`
   * para poder auditar la planilla meses despues.
   */
  clasePorCodigo: Map<string, ClaseItem>;
  /** El cuadro de paquetes, en plata: lo que sale del descuento al personal. */
  montoFaltantePaquete: number;
  /**
   * codigo -> clasificacion efectiva. Es lo que hay que escribir en
   * `DiferenciaItem.esEmpresa` para CADA fila (incluidas las que no
   * valorizaron: la clasificacion no depende del precio).
   */
  esEmpresaPorCodigo: Map<string, boolean>;
  /** Faltante de productos de empresa, en positivo -- para restar en la formula. */
  montoFaltanteEmpresa: number;
  /** Sobrante de productos NO empresa, a favor del empleado -- para restar en la formula. */
  montoSobranteEmpleado: number;
}

/**
 * La excepcion del Auditor manda; si no hay excepcion para ese codigo, manda
 * Dynamics. La excepcion sale de `ClasificacionProducto`, la fuente VIVA,
 * leida contra su valor VIGENTE al momento de liquidar -- no de
 * `CatalogoItem.esEmpresaManual` (esa columna quedo sin uso con la decision
 * del cliente de evaluar la clasificacion al liquidar y no al cerrar el
 * conteo: nadie la escribe).
 */
export function esEmpresaEfectivo(
  codigo: string,
  esEmpresaCatalogo: boolean,
  clasificacionManualPorCodigo: ReadonlyMap<string, boolean>,
): boolean {
  return clasificacionManualPorCodigo.get(codigo) ?? esEmpresaCatalogo;
}

/**
 * El calculo central de esta funcionalidad: recorre las diferencias
 * CONGELADAS del cierre (nunca vuelve a consultar Dynamics ni a recontar
 * nada) y aplica la clasificacion vigente HOY para decidir, por item, si su
 * faltante lo absorbe la empresa o si su sobrante compensa al empleado.
 */
export function reclasificarAlLiquidar(
  filas: readonly FilaDiferenciaParaReclasificar[],
  clasificacionManualPorCodigo: ReadonlyMap<string, boolean>,
  claseManualPorCodigo: ReadonlyMap<string, ClaseItem> = new Map(),
  umbral = 0.5,
  /** `codigo -> empaque corregido por el Auditor`. Vacio = ninguna correccion. */
  empaqueCorregidoPorCodigo: ReadonlyMap<string, number> = new Map(),
): ResultadoReclasificacion {
  const esEmpresaPorCodigo = new Map<string, boolean>();
  const clasePorCodigo = new Map<string, ClaseItem>();
  let montoFaltanteEmpresa = 0;
  let montoFaltantePaquete = 0;
  let montoSobranteEmpleado = 0;

  for (const fila of filas) {
    const esEmpresa = esEmpresaEfectivo(fila.codigo, fila.esEmpresaCatalogo, clasificacionManualPorCodigo);
    esEmpresaPorCodigo.set(fila.codigo, esEmpresa);

    // EL ORDEN NO ES INTERCAMBIABLE: primero el empaque EFECTIVO, despues la
    // clase. Al reves, un item que el ERP trae con empaque 1 degradaria a
    // `unidad` antes de que nadie mire la correccion del Auditor, y corregir
    // el empaque no moveria un solo sol (ver `claseEfectiva`).
    const empaque = empaqueEfectivo(
      empaqueCorregidoPorCodigo.get(fila.codigo) ?? fila.empaqueCompraCorregido,
      fila.empaqueCompra,
    );
    // La MISMA conciliacion que usa la matriz: `esEmpresa` manda, y la guarda
    // del empaque se resuelve con el denominador delante.
    const clase = claseEfectiva(
      null,
      conciliarClase(esEmpresa, claseManualPorCodigo.get(fila.codigo) ?? null, fila.claseCatalogo),
      empaque,
    );
    clasePorCodigo.set(fila.codigo, clase);

    if (fila.montoDiferencia === null || fila.diferencia === 0) continue;

    // EL PRECIO UNITARIO, despejado del monto: `montoDiferencia` es
    // `diferencia x precio`, asi que dividir devuelve el precio sin tener que
    // traerlo de nuevo del catalogo. Es exacto -- los dos salen de la misma
    // multiplicacion en `diferenciaValor`.
    const precioUnitario = fila.montoDiferencia / fila.diferencia;
    const reparto = repartirDiferencia(fila.diferencia, clase, empaque, umbral);

    if (fila.diferencia < 0) {
      // Faltante: se acumula en positivo, como el resto de los montos de la
      // formula.
      if (esEmpresa) montoFaltanteEmpresa += -fila.montoDiferencia;
      else montoFaltantePaquete += -reparto.aPaquetes * precioUnitario;
    } else {
      // Sobrante: `montoDiferencia` ya viene positivo. El sobrante que se va a
      // paquetes TAMBIEN sale del circuito del personal -- el cliente nombro
      // los dos ("sobrantes, faltantes por paquete").
      if (!esEmpresa) montoSobranteEmpleado += reparto.alPersonal * precioUnitario;
    }
  }

  return {
    esEmpresaPorCodigo,
    clasePorCodigo,
    montoFaltanteEmpresa: redondear(montoFaltanteEmpresa),
    montoFaltantePaquete: redondear(montoFaltantePaquete),
    montoSobranteEmpleado: redondear(montoSobranteEmpleado),
  };
}

// ---------------------------------------------------------------------------
// IMPURO -- Prisma. Punto de enganche para liquidacion.cierre.ts#liquidar
// (ver el comentario de cabecera de ese archivo y el reporte de esta tarea:
// NO SE TOCA liquidacion.cierre.ts desde aca, min-5 lo cablea).
// ---------------------------------------------------------------------------

/**
 * Las diferencias congeladas de un inventario, con la clasificacion que
 * tenia su `CatalogoItem` en ESE snapshot (join por `codigo`, mismo
 * inventario -- nunca el catalogo de HOY, que puede ser de otro mes).
 */
export async function datosParaReclasificar(inventarioId: number): Promise<FilaDiferenciaParaReclasificar[]> {
  const [diferencias, catalogo] = await Promise.all([
    prisma.diferenciaItem.findMany({
      where: { inventarioId },
      select: { codigo: true, diferencia: true, montoDiferencia: true },
    }),
    prisma.catalogoItem.findMany({
      where: { inventarioId },
      select: { codigo: true, esEmpresa: true, clase: true, empaqueCompra: true },
    }),
  ]);

  const esEmpresaCatalogoPorCodigo = new Map(catalogo.map((c) => [c.codigo, c.esEmpresa]));

  const catalogoPorCodigo = new Map(catalogo.map((c) => [c.codigo, c]));

  return diferencias.map((d) => ({
    codigo: d.codigo,
    diferencia: d.diferencia,
    montoDiferencia: d.montoDiferencia === null ? null : d.montoDiferencia.toNumber(),
    claseCatalogo: catalogoPorCodigo.get(d.codigo)?.clase ?? 'unidad',
    empaqueCompra: catalogoPorCodigo.get(d.codigo)?.empaqueCompra ?? null,
    // Lo llena `reclasificarAlLiquidar` con el mapa que recibe: esta funcion
    // solo lee el snapshot del inventario, la correccion es en vivo.
    empaqueCompraCorregido: null,
    // Sin fila de catalogo para ese codigo no deberia pasar (la diferencia
    // sale del mismo snapshot), pero `false` (nunca empresa) es el default
    // seguro si pasara: no le regala a nadie una exclusion que Dynamics no dio.
    esEmpresaCatalogo: esEmpresaCatalogoPorCodigo.get(d.codigo) ?? false,
  }));
}

/** La excepcion VIGENTE del Auditor, por codigo -- ver ClasificacionProducto en el schema. */
export async function clasificacionManualVigente(): Promise<Map<string, boolean>> {
  const filas = await prisma.clasificacionProducto.findMany({ select: { codigo: true, esEmpresa: true } });
  return new Map(filas.map((f) => [f.codigo, f.esEmpresa]));
}

/**
 * La excepcion manual del Auditor en su forma de TRES VIAS: `codigo -> clase`.
 *
 * `ClasificacionProducto.clase` es nullable y NULL significa "excepcion vieja,
 * de cuando esto era un booleano": esas filas NO entran al Map, y el item cae
 * a la clase de su snapshot. Traducir un `esEmpresa: false` viejo a
 * `clase: 'unidad'` seria inventar una decision -- el Auditor marco "no es de
 * la empresa", nunca dijo nada sobre paquetes.
 */
export async function claseManualVigente(): Promise<Map<string, ClaseItem>> {
  const filas = await prisma.clasificacionProducto.findMany({ select: { codigo: true, clase: true } });
  const mapa = new Map<string, ClaseItem>();
  for (const fila of filas) {
    if (fila.clase !== null) mapa.set(fila.codigo, fila.clase);
  }
  return mapa;
}

/**
 * El empaque que el Auditor corrigio, `codigo -> empaque`. EN VIVO y
 * cross-tienda: si el ERP trae mal el empaque de un producto, lo trae mal en
 * todas las tiendas a la vez (*"asi evitamos estar corrigiendo 1:1"*).
 *
 * Las filas sin corregir (`NULL`) NO entran al Map: ahi manda el snapshot.
 */
export async function empaqueCorregidoVigente(): Promise<Map<string, number>> {
  const filas = await prisma.clasificacionProducto.findMany({
    select: { codigo: true, empaqueCompraCorregido: true },
  });
  const mapa = new Map<string, number>();
  for (const fila of filas) {
    if (fila.empaqueCompraCorregido !== null) mapa.set(fila.codigo, fila.empaqueCompraCorregido);
  }
  return mapa;
}

export interface MontosDeClasificacion {
  /** codigo -> clase efectiva. `null` en el regimen CONGELADO, igual que `esEmpresaPorCodigo`. */
  clasePorCodigo: Map<string, ClaseItem> | null;
  montoFaltanteEmpresa: number;
  /**
   * EL CUADRO DE PAQUETES, en plata: lo que sale del descuento al personal
   * porque completa cajas enteras (`dominio/faltante-por-paquete.ts`).
   *
   * Se RECALCULA en vivo igual que `montoFaltanteEmpresa` y por la misma
   * razon -- el Auditor reclasifica al liquidar -- y por eso no hay columna
   * congelada para el en `ResultadoInventario`: se deriva del mismo lugar que
   * los otros dos, y una cuarta columna seria una cuarta cosa que puede
   * discrepar.
   */
  montoFaltantePaquete: number;
  montoSobranteEmpleado: number;
  /**
   * codigo -> clasificacion efectiva, SOLO en el regimen VIGENTE (recien
   * recalculado). `null` en el regimen CONGELADO: ya esta escrito en
   * `DiferenciaItem`, no hay nada que volver a escribir. `liquidar()` es el
   * unico llamador que lee este campo (siempre en regimen vigente, por las
   * guardas que lo preceden) para armar
   * `operacionesDeEscrituraClasificacion`.
   */
  esEmpresaPorCodigo: Map<string, boolean> | null;
}

export interface ResultadoCongelado {
  montoFaltanteEmpresa: number;
  /** `null` = inventario liquidado antes de que existiera esta regla. */
  montoSobranteEmpleado: number | null;
}

/**
 * LA UNICA FUENTE de `montoFaltanteEmpresa`/`montoSobranteEmpleado` para
 * CUALQUIER lugar del backend que arme un `EntradaLiquidacion` -- historial
 * (listado, detalle, comparativo), la pantalla de liquidacion (antes Y
 * despues de liquidar) y `liquidacion.cierre.ts#liquidar`. Ningun llamador
 * tiene permitido leer `ResultadoInventario.montoFaltanteEmpresa` directo
 * para esto: pasa por aca, siempre.
 *
 * BUG QUE ESTA FUNCION EXISTE PARA QUE NO VUELVA A PASAR (2026-09-14,
 * reportado por min-3 con numeros): antes de esta funcion, cada lugar que
 * mostraba el faltante neto armaba su propio `EntradaLiquidacion` a mano, y
 * varios de ellos NUNCA se enteraron de que existia `montoSobranteEmpleado`
 * ni de que `montoFaltanteEmpresa` podia cambiar con la clasificacion vigente
 * ANTES de liquidar. Resultado real: con bruto 130, negativos 40 por Excel,
 * una cerveza de faltante 30 reclasificada como empresa y un sobrante de
 * empleado de 50 -- la pantalla ANTES de liquidar mostraba neto 90 (ni
 * empresa ni sobrante), el ENCABEZADO despues de liquidar mostraba 60 (sin
 * el sobrante) mientras la PLANILLA (que si pasaba por
 * `reclasificarAlLiquidar`) usaba el correcto, 10. Se mostraba un numero y
 * se firmaba otro.
 *
 * DOS REGIMENES, la decision del cliente:
 *   - `liquidado` / `lacrado`: CONGELADO. Lo que `liquidar()` escribio es lo
 *     que se firmo -- se lee tal cual, NUNCA se recalcula (ni si la
 *     clasificacion cambia despues).
 *   - cualquier otro estado (en la practica, `conteo_cerrado`, que es el
 *     unico con `ResultadoInventario`): VIGENTE. Se recalcula con la
 *     clasificacion de HOY (`ClasificacionProducto`), en modo LECTURA -- es
 *     EXACTAMENTE la misma cuenta que hara `liquidar()` al cerrar la
 *     planilla, para que la vista previa nunca mienta sobre lo que se va a
 *     firmar.
 */
export async function resolverMontosDeClasificacion(
  inventarioId: number,
  estado: string,
  congelado: ResultadoCongelado,
): Promise<MontosDeClasificacion> {
  if (estado === 'liquidado' || estado === 'lacrado') {
    return {
      montoFaltanteEmpresa: congelado.montoFaltanteEmpresa,
      montoFaltantePaquete: await montoPaqueteCongelado(inventarioId),
      montoSobranteEmpleado: congelado.montoSobranteEmpleado ?? 0,
      esEmpresaPorCodigo: null,
      clasePorCodigo: null,
    };
  }

  const [filas, clasificacionManual, claseManual, umbral, empaqueCorregido] = await Promise.all([
    datosParaReclasificar(inventarioId),
    clasificacionManualVigente(),
    claseManualVigente(),
    umbralDelInventario(inventarioId),
    empaqueCorregidoVigente(),
  ]);
  const r = reclasificarAlLiquidar(filas, clasificacionManual, claseManual, umbral, empaqueCorregido);
  return {
    montoFaltanteEmpresa: r.montoFaltanteEmpresa,
    montoFaltantePaquete: r.montoFaltantePaquete,
    montoSobranteEmpleado: r.montoSobranteEmpleado,
    esEmpresaPorCodigo: r.esEmpresaPorCodigo,
    clasePorCodigo: r.clasePorCodigo,
  };
}

/**
 * EL CUADRO DE PAQUETES DE UN INVENTARIO YA LIQUIDADO, derivado de lo que
 * quedo CONGELADO -- no recalculado con el catalogo de hoy.
 *
 * NO HAY COLUMNA `montoFaltantePaquete` EN `ResultadoInventario`, y no hace
 * falta: las tres entradas de la cuenta ya estan congeladas por separado --
 * `DiferenciaItem.clase` (la clase con la que se liquido, que min-1 congela
 * justo para esto), `DiferenciaItem.diferencia/montoDiferencia`, y el
 * `empaqueCompra` del snapshot, que no cambia. Una cuarta columna con el total
 * seria un dato guardado al lado de sus partes, que es lo que este repo evita
 * en todos lados (ver el comentario de `Conteo` en schema.prisma).
 *
 * `clase` en NULL = fila escrita ANTES de las tres vias. Esos inventarios se
 * liquidaron sin cuadro de paquetes, asi que aportan 0 -- que es exactamente
 * lo que se les descontó.
 */
async function montoPaqueteCongelado(inventarioId: number): Promise<number> {
  const [diferencias, catalogo, umbral] = await Promise.all([
    prisma.diferenciaItem.findMany({
      where: { inventarioId },
      select: { codigo: true, diferencia: true, montoDiferencia: true, clase: true },
    }),
    prisma.catalogoItem.findMany({ where: { inventarioId }, select: { codigo: true, empaqueCompra: true } }),
    umbralDelInventario(inventarioId),
  ]);
  const empaquePorCodigo = new Map(catalogo.map((c) => [c.codigo, c.empaqueCompra]));

  let monto = 0;
  for (const d of diferencias) {
    // Solo faltantes: el cuadro de paquetes de los SOBRANTES no resta del neto
    // (los sobrantes entran por `montoSobranteEmpleado`, que ya sale repartido).
    if (d.clase === null || d.montoDiferencia === null || d.diferencia >= 0) continue;
    const empaque = empaquePorCodigo.get(d.codigo) ?? null;
    const precioUnitario = d.montoDiferencia.toNumber() / d.diferencia;
    const reparto = repartirDiferencia(d.diferencia, d.clase, empaque, umbral);
    if (d.clase !== 'empresa') monto += -reparto.aPaquetes * precioUnitario;
  }
  return redondear(monto);
}

/**
 * El umbral CONGELADO de este inventario. Se lee del inventario y no de la
 * config global por la misma razon que `tamanoHoja`: recalcular agosto con la
 * perilla de hoy le cambiaria el descuento a alguien sobre un sueldo pagado.
 */
async function umbralDelInventario(inventarioId: number): Promise<number> {
  const inv = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { umbralMediaUnidadPaquete: true },
  });
  // El `?.` sobre la columna, no solo sobre la fila: en produccion no puede
  // faltar (es `Decimal` NOT NULL con default en el schema), pero un `select`
  // parcial de otro llamador -- o un mock -- la dejaria en undefined, y
  // reventar acá haria caer la liquidacion entera por un dato que tiene
  // default. El 0.5 es el MISMO default que declara la columna, no un numero
  // inventado: ver `Inventario.umbralMediaUnidadPaquete` en schema.prisma.
  return inv?.umbralMediaUnidadPaquete?.toNumber() ?? 0.5;
}

export interface ItemParaClasificar {
  codigo: string;
  /** `CatalogoItem.esEmpresa` (Dynamics) -- lo que ya trae `armarMatriz`. */
  esEmpresa: boolean;
  /** `CatalogoItem.clase` (snapshot) -- las tres vias. */
  clase: ClaseItem;
  /**
   * La que el Auditor forzo a mano. Viaja APARTE de `clase` porque el empaque
   * re-deriva la clase, y fundirlas haria que la re-derivacion pise al
   * Auditor (ver `ItemAuditoria.claseForzada`).
   */
  claseForzada: ClaseItem | null;
  /**
   * El empaque corregido por el Auditor. Lo LLENA esta funcion en el regimen
   * VIGENTE; en el congelado queda como vino (null), porque una correccion de
   * hoy no puede cambiarle el descuento a un mes ya pagado.
   */
  empaqueCompraCorregido: number | null;
}

/**
 * Aplica el MISMO regimen vigente/congelado que `resolverMontosDeClasificacion`
 * -- pero por ITEM, no en un total -- a cualquier lista que tenga `codigo` y
 * `esEmpresa` (hoy: la matriz de auditoria, `auditoria.service.ts#matriz`/
 * `#resumen`, ANTES de calcular veredicto/resumen sobre ella).
 *
 * BUG que esto corrige (2026-09-14, reportado por min-4): la matriz leia
 * `CatalogoItem.esEmpresa` (Dynamics) directo y nunca la excepcion del
 * Auditor -- una cerveza que Gilmer clasifica como empresa seguia apareciendo
 * en la matriz como faltante del empleado, mientras la liquidacion (que SI
 * pasaba por `resolverMontosDeClasificacion`) ya la sacaba. Dos pantallas de
 * la misma app diciendo cosas distintas -- la misma familia de bug que el
 * del neto, y la misma solucion: una sola fuente para la decision
 * vigente/congelada (`estado === 'liquidado' || 'lacrado'`), reusada aca en
 * vez de copiada.
 *
 *   - VIGENTE (`conteo_cerrado` o antes): `esEmpresaEfectivo` contra
 *     `ClasificacionProducto` -- la MISMA funcion que usa
 *     `reclasificarAlLiquidar`.
 *   - CONGELADO (`liquidado`/`lacrado`): lo que `liquidar()` ya escribio en
 *     `DiferenciaItem.esEmpresa`. Los items SIN fila ahi (los que cuadraron,
 *     diferencia 0 -- ver `diferenciasParaPersistir`) conservan el
 *     `esEmpresa` de Dynamics: no importa cual sea, `veredicto()` los marca
 *     `cuadrado` ANTES de mirar `esEmpresa` (auditoria.calculos.ts).
 */
export async function aplicarClasificacionVigente<T extends ItemParaClasificar>(
  inventarioId: number,
  estado: string,
  items: readonly T[],
): Promise<T[]> {
  if (estado === 'liquidado' || estado === 'lacrado') {
    const filas = await prisma.diferenciaItem.findMany({
      where: { inventarioId },
      select: { codigo: true, esEmpresa: true, clase: true },
    });
    const congelado = new Map(filas.map((f) => [f.codigo, f]));
    return items.map((item) => {
      const fila = congelado.get(item.codigo);
      return {
        ...item,
        esEmpresa: fila?.esEmpresa ?? item.esEmpresa,
        // `clase` es nullable en `DiferenciaItem`: las filas escritas ANTES de
        // las tres vias la tienen en NULL. Ahi manda la del snapshot, que para
        // esos inventarios es `unidad` -- exactamente como se liquidaron.
        clase: fila?.clase ?? item.clase,
      };
    });
  }

  const [clasificacionManual, claseManual, empaqueCorregido] = await Promise.all([
    clasificacionManualVigente(),
    claseManualVigente(),
    empaqueCorregidoVigente(),
  ]);
  return items.map((item) => {
    const esEmpresa = esEmpresaEfectivo(item.codigo, item.esEmpresa, clasificacionManual);
    return {
      ...item,
      esEmpresa,
    // LA EXCEPCION DEL AUDITOR QUEDA APLICADA ACA Y EN NINGUN OTRO LADO.
    // `resumir` y el export leen `item.clase` ya con ella adentro: si cada uno
    // resolviera la suya, la matriz y la planilla podrian clasificar el mismo
    // item distinto -- el bug de 2026-09-14 que esta funcion existe para no
    // repetir.
    //
    // ACA SOLO SE APLICA LA PRECEDENCIA (manual > snapshot), no la guarda del
    // empaque: este archivo no conoce `empaqueCompra` y meterle un `null`
    // degradaria TODO a `unidad`, que es justamente vaciar la funcionalidad.
    // Esa guarda vive en `repartirDiferencia`, que si tiene el denominador
    // delante -- ver `claseEfectiva`.
      // `clase` queda como la del SNAPSHOT conciliada con `esEmpresa`; la
      // forzada va en su propio campo. Las dos las vuelve a mirar
      // `claseEfectiva`, que es quien sabe en que orden pesan.
      clase: conciliarClase(esEmpresa, null, item.clase),
      claseForzada: esEmpresa ? null : (claseManual.get(item.codigo) ?? null),
      // LA CORRECCION DEL EMPAQUE, tambien en vivo y tambien cross-tienda. NO
      // pisa `empaqueCompra`: los dos viajan juntos para poder responder "el
      // ERP dijo 1 y el Auditor lo corrigio a 12". Cual de los dos MIDE lo
      // decide `empaqueEfectivo`, y el ORDEN en que se resuelve importa -- ver
      // el comentario de `claseEfectiva` en dominio/faltante-por-paquete.ts.
      empaqueCompraCorregido: empaqueCorregido.get(item.codigo) ?? null,
    };
  });
}

/**
 * `esEmpresa` Y `clase` TIENEN QUE DECIR LO MISMO. La invariante es
 * `esEmpresa === (clase === 'empresa')` -- min-1 la dejo con test en el
 * snapshot, y acá hay que sostenerla a mano porque los dos valores salen de
 * DOS COLUMNAS DISTINTAS de `ClasificacionProducto`: la vieja (`esEmpresa`) y
 * la nueva (`clase`, nullable).
 *
 * EL CASO QUE ROMPIA, y que no es hipotetico: una excepcion VIEJA del Auditor
 * (`esEmpresa: true, clase: null`) hacia `esEmpresa = true` pero dejaba la
 * clase del snapshot en `unidad`. El item quedaba marcado como "lo absorbe la
 * empresa" para el veredicto y la pantalla, y al mismo tiempo su faltante caia
 * en el cuadro `unidad` -- o sea que se le descontaba al personal un faltante
 * que segun la misma fila absorbe la empresa. Plata descontada dos veces
 * segun quien mire.
 *
 * El criterio: `esEmpresa` MANDA, porque es la columna que llevan escrita
 * todas las excepciones (la otra es opcional y reciente), y porque el sello
 * del lacrado y los inventarios ya liquidados la leen a ella.
 */
export function conciliarClase(
  esEmpresa: boolean,
  claseManual: ClaseItem | null,
  claseDelSnapshot: ClaseItem,
): ClaseItem {
  if (esEmpresa) return 'empresa';
  const elegida = claseManual ?? claseDelSnapshot;
  // Sin excepcion de empresa vigente, la clase no puede seguir diciendo
  // `empresa`: el Auditor le saco la excepcion y el faltante vuelve al
  // circuito normal. `unidad` es el destino conservador -- el de antes de que
  // existiera el cuadro de paquetes.
  return elegida === 'empresa' ? 'unidad' : elegida;
}

/**
 * Las operaciones de escritura de `DiferenciaItem.esEmpresa`, UNA por
 * codigo, listas para entrar al `$transaction` de `liquidar()` junto con el
 * resto (la planilla y el cambio de estado) -- ver el comentario de
 * `liquidacion.cierre.ts#liquidar` sobre por que planilla y estado van
 * juntos o ninguno. No ejecuta nada: devuelve la lista para que quien
 * arma la transaccion la agregue a su propio array.
 */
export function operacionesDeEscrituraClasificacion(
  inventarioId: number,
  esEmpresaPorCodigo: ReadonlyMap<string, boolean>,
): Prisma.PrismaPromise<Prisma.BatchPayload>[] {
  return [...esEmpresaPorCodigo.entries()].map(([codigo, esEmpresa]) =>
    prisma.diferenciaItem.updateMany({ where: { inventarioId, codigo }, data: { esEmpresa } }),
  );
}
