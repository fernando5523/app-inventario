/**
 * Comparacion de un item contra Dynamics tras el ciclo de conteos.
 * PUROS -- sin Prisma, sin Express -- para testearlos sin base (mismo
 * criterio que hojas.calculos.ts y historial.calculos.ts).
 *
 * ESPEJA mobile/lib/dominio/auditoria.ts, funcion por funcion y con las
 * mismas reglas. La cuenta que decide si el inventario cuadra tiene que dar
 * igual en el telefono y en el servidor: si difieren, el Auditor ve un
 * numero en la pantalla y otro en el cierre, y no hay forma de saber cual
 * era el bueno. Cualquier cambio aca va tambien alla, y al reves.
 *
 * ------------------------------------------------------------------------
 * LA REGLA MAS IMPORTANTE DE ESTE ARCHIVO: "NO SE" NO ES "CERO".
 *
 * Un item sin stock en el snapshot del ERP y un item cuyo ERP dice 0 son
 * cosas COMPLETAMENTE distintas en un inventario. El primero no se puede
 * auditar; el segundo dice "no deberia haber ninguno". Tratar el primero
 * como el segundo produjo, contra los 11.835 productos reales que todavia
 * no tienen stock cargado, un resumen que decia "100% cuadrados" -- un
 * falso "todo bien" en la unica pantalla donde se decide si el inventario
 * cierra.
 *
 * Por eso `stockErp` y las diferencias son `number | null`, y hay dos
 * veredictos (`sin_erp`, `sin_contar`) para lo que NO se puede afirmar. Un
 * inventario prefiere decir "no se" cien veces antes que decir "cuadra" una
 * vez sin evidencia.
 * ------------------------------------------------------------------------
 */

import { conteoQueManda } from '../../dominio/ciclo-conteos';
import {
  claseEfectiva,
  empaqueEfectivo,
  repartirDiferencia,
  type ClaseItem,
  type RepartoDeDiferencia,
} from '../../dominio/faltante-por-paquete';
import { redondear } from '../historial/historial.calculos';
import type { EstadoInventario } from '../historial/historial.permisos';

/**
 * Espeja tipos.ts#ItemAuditoria, con UNA diferencia deliberada:
 * `stockErp` y `precioVenta` son nullables. El tipo del front los declara
 * `number` a secas y eso obliga a inventar un 0 cuando el ERP no trajo el
 * dato -- ver el comentario de cabecera. Un tipo que no puede expresar "no
 * se" fuerza a mentir.
 */
export interface ItemAuditoria {
  productoId: number;
  codigo: string;
  descripcion: string;
  zona: string;
  /**
   * El rotulo de la hoja donde se conto ("003"), o VACIO si ninguna hoja
   * finalizada lo incluye todavia.
   *
   * Es el mismo tipo de dato que `zona`: sale de la hoja, es para mostrar y
   * para filtrar, y NO entra en ningun calculo de esta unidad. Vacio y no un
   * "sin hoja": cualquier texto que parezca un numero de hoja se leeria como
   * una hoja que existe.
   */
  hoja: string;
  /** null = el snapshot no trajo precio: la diferencia no se puede valorizar. */
  precioVenta: number | null;
  /** null = el snapshot no trajo stock: este item NO se puede auditar. */
  stockErp: number | null;
  /**
   * Lo contado en CADA ronda, en orden: indice 0 = ronda 1, indice 1 = ronda
   * 2, etc. `null` en una posicion = ese item no llego a necesitar esa pasada
   * (cuadro antes) o no se conto en ella.
   *
   * ERAN TRES CAMPOS SUELTOS (`conteo1/2/3`) hasta 2026-09-19. El cliente
   * pidio que el Auditor pueda abrir rondas extra -- una 4ta, una 5ta -- y
   * con tres campos eso no se puede representar: el 4to conteo no tendria
   * donde vivir, `conteoFinal` seguiria mirando el 3ro y la multa saldria de
   * un numero viejo. Es la MISMA forma que `ciclo-conteos.ts#ItemDeRonda`, que
   * ya era una lista desde el principio justamente por esto.
   *
   * La lista NO tiene largo fijo: un inventario que cerro en la ronda 2 trae
   * 2 elementos y uno con ajuste del Auditor puede traer 6.
   */
  conteos: ReadonlyArray<number | null>;
  /**
   * true = la categoria la asume la empresa por orden de gerencia (las
   * cervezas del ejemplo, por seguimiento de robo): el faltante existe y se
   * reporta, pero no se descuenta a nomina.
   *
   * REDUNDANTE CON `clase === 'empresa'` y se mantiene a proposito: lo leen el
   * sello del lacrado y los inventarios liquidados antes de que existieran las
   * tres vias. `esEmpresa === (clase === 'empresa')` es invariante -- min-1 la
   * dejo con test en el snapshot, y `resumir` la verifica de nuevo acá abajo.
   */
  esEmpresa: boolean;
  /**
   * COMO SE TRATA EL FALTANTE: `empresa` lo absorbe gerencia, `unidad` se le
   * descuenta al personal, `paquete` se PARTE con la regla del umbral (ver
   * `dominio/faltante-por-paquete.ts`).
   *
   * Es la clase del SNAPSHOT. La excepcion manual del Auditor se resuelve
   * aparte y EN VIVO -- ver `claseEfectiva` y liquidacion.reclasificacion.ts.
   */
  clase: ClaseItem;
  /**
   * LA CLASE QUE EL AUDITOR FORZO A MANO (`ClasificacionProducto.clase`),
   * APARTE de `clase`. `null` = no forzo ninguna.
   *
   * VIAJA SEPARADA A PROPOSITO, y esto no es prolijidad: desde que el empaque
   * RE-DERIVA la clase (ver `claseEfectiva`), fundir la excepcion dentro de
   * `clase` la volveria indistinguible de la del snapshot -- y la
   * re-derivacion pisaria al Auditor. Un item que el forzo a `unidad` con un
   * empaque de 12 volveria a `paquete` solo, que es exactamente lo que el
   * limite "la excepcion manual manda" existe para impedir.
   */
  claseForzada: ClaseItem | null;
  /**
   * El empaque DE COMPRA en unidades sueltas: el denominador de la regla del
   * umbral. NO es el de venta (ver el comentario de la columna en
   * schema.prisma: difiere en 1 de cada 6 items reales, y usar el otro cambia
   * a quien se le descuenta).
   *
   * `null` = no se pudo resolver. NULL NO ES 1: sin denominador la regla no
   * corre y el item degrada a `unidad`, o sea al descuento al personal.
   */
  empaqueCompra: number | null;
  /** "Emp.12" tal cual lo dice el ERP, para poder auditar de donde salio. */
  empaqueCompraSimbolo: string | null;
  /**
   * El empaque que el AUDITOR corrigio, cuando Dynamics lo trajo mal
   * (`ClasificacionProducto.empaqueCompraCorregido`, en vivo). `null` = sin
   * corregir.
   *
   * VIAJA AL LADO DEL SNAPSHOT, no lo pisa: los dos juntos son lo que permite
   * responder "el ERP dijo 1 y el Auditor lo corrigio a 12". Cual de los dos
   * MIDE lo decide `empaqueEfectivo` -- ver su comentario para por que este va
   * en vivo y el umbral va congelado.
   */
  empaqueCompraCorregido: number | null;
}

/**
 * Los tres veredictos de la maqueta MAS dos que dicen "no se".
 *
 * `sin_erp` y `sin_contar` no estaban en el mockup, y se agregan igual
 * porque el mockup asumia que siempre hay dato de los dos lados. Contra
 * datos reales eso no se cumple, y la alternativa era que un item sin
 * informacion se reportara como "cuadrado".
 */
export type VeredictoAuditoria = 'cuadrado' | 'falta' | 'empresa' | 'sin_erp' | 'sin_contar';

/**
 * Los 4 filtros que ya usa la pantalla (mobile/design/auditoria.html) mas
 * `sin_dato`, que junta los dos veredictos de "no se". Los cuatro
 * originales NO cambian de significado -- solo dejan de incluir por error a
 * los items que no tienen con que compararse.
 */
export const FILTROS_AUDITORIA = ['todos', 'cuadrados', 'faltante', 'empresa', 'sin_dato'] as const;
export type FiltroAuditoria = (typeof FILTROS_AUDITORIA)[number];

/**
 * El conteo que queda fijo para liquidar: el ULTIMO que se hizo. Si un item
 * cuadro en el 1er o 2do conteo no hay 3ro (ni 2do), asi que se toma el mas
 * avanzado que exista -- mirar siempre la ultima posicion daria null para los
 * ~7.350 items que cuadraron en la primera pasada, o sea para la enorme
 * mayoria del inventario.
 *
 * DELEGA EN `ciclo-conteos.ts#conteoQueManda`, no reimplementa la regla. Son
 * literalmente la misma decision de negocio -- "el ultimo conteo manda", con
 * su tradeoff documentado alla -- y hasta ahora estaban escritas dos veces
 * porque tenian formas distintas (una lista contra tres campos). Con la lista
 * de los dos lados, mantenerlas separadas seria garantizar que algun dia
 * difieran: el dominio diria que vale 17 y la auditoria que vale 12, sobre el
 * mismo item.
 */
export function conteoFinal(item: Pick<ItemAuditoria, 'conteos'>): number | null {
  return conteoQueManda(item.conteos);
}

/** true si hay con que comparar: stock del ERP Y algun conteo. */
export function esAuditable(item: Pick<ItemAuditoria, 'stockErp' | 'conteos'>): boolean {
  return item.stockErp !== null && conteoFinal(item) !== null;
}

/**
 * conteoFinal - stockErp. Negativo = faltante, positivo = sobrante.
 *
 * Devuelve `null` -- NO 0 -- cuando falta cualquiera de los dos lados. Un 0
 * significa "conte exactamente lo que decia el ERP", que es una afirmacion
 * fuerte; no puede ser tambien el valor de "no tengo idea". Esta distincion
 * es lo unico que impide que un catalogo sin stock cargado se reporte como
 * un inventario perfecto.
 */
export function diferenciaUnidades(item: Pick<ItemAuditoria, 'conteos' | 'stockErp'>): number | null {
  const final = conteoFinal(item);
  if (item.stockErp === null || final === null) return null;
  return final - item.stockErp;
}

/**
 * diferenciaUnidades * precioVenta -- nunca precio de compra.
 * `null` si no se puede calcular la diferencia o si no hay precio: la
 * diferencia en unidades sigue siendo valida aunque no se pueda valorizar.
 */
export function diferenciaValor(item: ItemAuditoria): number | null {
  const unidades = diferenciaUnidades(item);
  if (unidades === null || item.precioVenta === null) return null;
  return redondear(unidades * item.precioVenta);
}

/**
 * El orden de los chequeos es la regla, no un detalle de implementacion:
 *
 *   1. Sin stock del ERP -> `sin_erp`. No se puede afirmar NADA de este
 *      item, ni siquiera que la empresa lo asume.
 *   2. Sin ningun conteo -> `sin_contar`. Hay contra que comparar, pero
 *      nadie lo conto todavia.
 *   3. Diferencia 0 -> `cuadrado`.
 *   4. Hay diferencia y la asume gerencia -> `empresa`.
 *   5. El resto -> `falta`, sea faltante O SOBRANTE: la maqueta valida solo
 *      esos tres buckets, no hay un cuarto separado para sobrantes.
 */
export function veredicto(item: ItemAuditoria): VeredictoAuditoria {
  if (item.stockErp === null) return 'sin_erp';
  if (conteoFinal(item) === null) return 'sin_contar';
  if (diferenciaUnidades(item) === 0) return 'cuadrado';
  if (item.esEmpresa) return 'empresa';
  return 'falta';
}

/**
 * Cuantas pasadas necesito este item: la POSICION 1-BASED del ultimo conteo
 * que tiene. 0 = no se conto en ninguna.
 *
 * Es la ronda en la que quedo RESUELTO, no cuantas veces se lo conto: un item
 * contado en la 1 y en la 4 (salteado en la 2 y la 3) necesito 4 pasadas, no
 * 2. Ese numero es el que se congela como `DiferenciaItem.resueltoEnConteo` y
 * el que arma el embudo, y las dos cosas preguntan "hasta donde hubo que
 * llegar", no "cuanto trabajo costo".
 *
 * Ya no tiene techo en 3: con las rondas extra del Auditor puede devolver 5.
 */
export function rondasNecesarias(item: Pick<ItemAuditoria, 'conteos'>): number {
  for (let i = item.conteos.length - 1; i >= 0; i--) {
    const valor = item.conteos[i];
    if (valor !== null && valor !== undefined) return i + 1;
  }
  return 0;
}

/**
 * Aplica uno de los filtros de la pantalla. Los cuatro de la maqueta
 * (`todos`, `cuadrados`, `faltante`, `empresa`) mapean al veredicto; el
 * quinto, `sin_dato`, junta lo que no se puede auditar todavia.
 */
export function aplicarFiltro(items: ItemAuditoria[], filtro: FiltroAuditoria): ItemAuditoria[] {
  if (filtro === 'todos') return items;
  if (filtro === 'sin_dato') {
    return items.filter((i) => {
      const v = veredicto(i);
      return v === 'sin_erp' || v === 'sin_contar';
    });
  }
  const buscado: VeredictoAuditoria = filtro === 'cuadrados' ? 'cuadrado' : filtro === 'empresa' ? 'empresa' : 'falta';
  return items.filter((i) => veredicto(i) === buscado);
}

export interface ResumenAuditoria {
  items: number;
  cuadrados: number;
  conFalta: number;
  deEmpresa: number;
  /**
   * Items que el snapshot trajo SIN stock del ERP: no se pueden auditar.
   * Se cuentan aparte y NUNCA como cuadrados -- ver el comentario de
   * cabecera del archivo.
   */
  sinDatoErp: number;
  /** Tienen stock del ERP pero nadie los conto todavia. */
  sinContar: number;
  /**
   * CUANTOS ITEMS TIENEN ALGUN CONTEO CARGADO, tengan o no stock del ERP.
   *
   * NO es `items - sinContar`, y la diferencia importa: `sinContar` solo mira
   * los que SI tienen stock del ERP (los `sin_erp` salen del bucle una linea
   * antes), asi que restarlo daria por contado a un item sin ERP que nadie
   * conto. Se cuenta derecho, con la misma regla que el movil
   * (mobile/lib/dominio/auditoria.ts#resumirAuditoria): cuenta si
   * `conteoFinal` no es null.
   *
   * Existe porque el encabezado del Panel de auditoria dice "980 de 980 items
   * contados" y antes lo sacaba recorriendo la matriz EN EL TELEFONO. Al
   * mudarse la matriz a su propia pantalla, el panel dejo de pedirla -- eran
   * hasta 16 paginas de API para pintar un encabezado -- y este numero tenia
   * que venir con el resumen o dejar de existir.
   */
  contados: number;
  /**
   * CUANTOS PRODUCTOS DE EMPRESA SE CONTARON, tengan o no diferencia.
   *
   * NO es `porClase.empresa.items` ni `deEmpresa`: esos dos cuentan solo los
   * que tienen una diferencia distinta de cero. Un producto de empresa que
   * CUADRO igual se conto, y el Auditor quiere saber sobre cuantos esta
   * mirando la cifra de abajo.
   *
   * SE CUENTA CON LA CLASE EFECTIVA, la misma que usa `repartoDelItem`: la
   * excepcion manual del Auditor (`claseForzada`) es justamente de donde salen
   * la mayoria de los productos de empresa -- las cervezas, que en D365 van
   * del empleado. Con `item.clase` pelado esa decision no se veria, y la
   * tarjeta diria 0 sobre un cuadro que tiene plata.
   */
  contadosDeEmpresa: number;
  /** items - sinDatoErp - sinContar: sobre estos se puede afirmar algo. */
  auditables: number;
  /**
   * % de cuadrados sobre los AUDITABLES, no sobre el total. Sobre el total
   * mezclaria peras con manzanas: con 11.835 items sin stock cargado,
   * dividir por el total da un porcentaje que no significa nada.
   */
  porcentajeCuadrado: number;
  /** Que porcion del inventario se puede auditar hoy. */
  porcentajeAuditable: number;
  /** Unidades, siempre en positivo. */
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  /** Valorizado a precio de venta. */
  valorFaltante: number;
  valorSobrante: number;
  /**
   * Lo que SI se descuenta a nomina: el faltante que no absorbe la empresa.
   * Es el numero que entra a la liquidacion (Pantalla 6) como faltante
   * bruto -- separarlo aca evita que alguien reste las cervezas dos veces.
   */
  valorFaltanteDescontable: number;
  /**
   * Items con diferencia que NO se pudieron valorizar por falta de precio.
   * Se avisa en vez de callarse: si son muchos, el monto del faltante que
   * muestra la pantalla esta incompleto y quien lo lee tiene que saberlo.
   */
  sinPrecio: number;
  /**
   * LOS TRES CUADROS del cliente (reunion 2, 00:33:25): *"ponga empresa y se va
   * al cuadro de empresa, ponga paquetes se va al cuadro de paquetes, unidad se
   * queda ahi unidad para el descuento del personal"*.
   *
   * `unidad` es el UNICO que alimenta el descuento a nomina.
   *
   * LOS TRES SUMAN LOS TOTALES de arriba: `porClase.*.valorFaltante` suma
   * `valorFaltante`, y lo mismo con sobrantes y unidades. Se testea, porque es
   * lo que impide que un item se cuente dos veces o se pierda entre cuadros.
   *
   * CADA ITEM CAE EN UN SOLO CUADRO: el faltante no se parte. La suma de los
   * tres `items` es la cantidad de items con diferencia, sin repetidos.
   */
  porClase: PorClase;
}

/** Un cuadro. Los tres tienen la misma forma y se muestran uno al lado del otro. */
export interface CuadroDeDiferencias {
  /** Items con al menos una unidad EN ESTE cuadro. */
  items: number;
  /** Unidades, siempre en positivo. */
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  /** Valorizado a precio de venta, siempre en positivo. */
  valorFaltante: number;
  valorSobrante: number;
}

export interface PorClase {
  /** El descuento al personal sale de ACA y de ningun otro lado. */
  unidad: CuadroDeDiferencias;
  /** Se audita aparte -- "quizas se lo descuento al almacenero". */
  paquete: CuadroDeDiferencias;
  /** Lo absorbe gerencia (las cervezas). */
  empresa: CuadroDeDiferencias;
}

function cuadroVacio(): CuadroDeDiferencias {
  return { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 };
}

/**
 * Suma unidades y plata de UN item a UN cuadro. El signo decide el lado:
 * negativo = faltante, positivo = sobrante, y las dos columnas guardan
 * POSITIVOS (es lo que se muestra, y restar dos negativos confunde a quien lee).
 *
 * `unidades === 0` no suma ni cuenta el item: un cuadro que no recibio nada de
 * ese producto no tiene por que listarlo.
 */
function acumularEnCuadro(cuadro: CuadroDeDiferencias, unidades: number, precioVenta: number | null): void {
  if (unidades === 0) return;
  cuadro.items += 1;
  const valor = Math.abs(unidades) * (precioVenta ?? 0);
  if (unidades < 0) {
    cuadro.unidadesFaltantes += -unidades;
    cuadro.valorFaltante += valor;
  } else {
    cuadro.unidadesSobrantes += unidades;
    cuadro.valorSobrante += valor;
  }
}

/**
 * COMO QUEDA REPARTIDA la diferencia de un item, con la clase ya resuelta.
 *
 * `item.clase` LLEGA YA RESUELTA: `aplicarClasificacionVigente`
 * (liquidacion.reclasificacion.ts) le aplico la excepcion del Auditor antes de
 * que la matriz llegue acá. Un segundo lugar que la resolviera seria un segundo
 * lugar donde puede diferir.
 *
 * Lo que SI se resuelve acá es la guarda del empaque (`claseEfectiva`): sin
 * denominador no hay regla que correr y el item degrada a `unidad`.
 */
export function repartoDelItem(
  item: ItemAuditoria,
  umbral: number,
  excepcionDelAuditor: ClaseItem | null = null,
): RepartoDeDiferencia {
  const diferencia = diferenciaUnidades(item);
  // `null` = falta un lado (sin_erp o sin_contar). No se reparte lo que no se
  // sabe: es la misma regla que hace que `diferenciasParaPersistir` no escriba
  // la fila.
  if (diferencia === null) {
    return { alPersonal: 0, aPaquetes: 0, aEmpresa: 0, razon: null, paquetesEnteros: 0 };
  }

  // EL ORDEN NO ES INTERCAMBIABLE: primero el empaque efectivo. Si
  // `claseEfectiva` viera el del snapshot, los items que Dynamics trae con
  // empaque 1 (los displays con PurchaseUnitSymbol 'U') degradarian a `unidad`
  // ANTES de que nadie mire la correccion del Auditor, y la correccion no
  // moveria un solo sol. Ver el comentario de `claseEfectiva`.
  const empaque = empaqueEfectivo(item.empaqueCompraCorregido, item.empaqueCompra);
  // La forzada del item manda sobre el parametro: el parametro existe para los
  // llamadores que todavia no la tienen resuelta.
  const clase = claseEfectiva(item.claseForzada ?? excepcionDelAuditor, item.clase, empaque);
  return repartirDiferencia(diferencia, clase, empaque, umbral);
}

/**
 * El encabezado de la pantalla del Auditor. Se calcula sobre TODOS los
 * items del inventario, nunca sobre la pagina que se esta mostrando: un
 * resumen que cambia cuando pasas de pagina no es un resumen.
 */
export function resumir(
  items: ItemAuditoria[],
  /**
   * `Inventario.umbralMediaUnidadPaquete`, CONGELADO al abrir el inventario.
   *
   * OBLIGATORIO a proposito, aunque rompa a los llamadores que ya existian: de
   * este numero depende cuanta plata sale del descuento al personal. Un default
   * silencioso (0.5, digamos) haria que un llamador que no se entero del cambio
   * siguiera compilando y devolviera un resumen plausible calculado con un
   * umbral que nadie eligio. El error de compilacion es la unica forma de que
   * cada llamador decida.
   */
  umbral: number,
): ResumenAuditoria {
  const r: ResumenAuditoria = {
    items: items.length,
    cuadrados: 0,
    conFalta: 0,
    deEmpresa: 0,
    sinDatoErp: 0,
    sinContar: 0,
    contados: 0,
    contadosDeEmpresa: 0,
    auditables: 0,
    porcentajeCuadrado: 0,
    porcentajeAuditable: 0,
    unidadesFaltantes: 0,
    unidadesSobrantes: 0,
    valorFaltante: 0,
    valorSobrante: 0,
    valorFaltanteDescontable: 0,
    sinPrecio: 0,
    porClase: { unidad: cuadroVacio(), paquete: cuadroVacio(), empresa: cuadroVacio() },
  };

  for (const item of items) {
    // ARRIBA DE LOS `continue` A PROPOSITO: un item sin stock del ERP igual
    // pudo haberse contado, y si esto viviera despues de la guarda de
    // `sin_erp` ese conteo no se contaria nunca.
    if (conteoFinal(item) !== null) {
      r.contados += 1;
      // LA CLASE EFECTIVA, igual que `repartoDelItem` (y en el mismo orden:
      // primero el empaque, ver el comentario de `claseEfectiva`). Un item de
      // empresa que cuadro no aparece en ningun cuadro, asi que este es el
      // unico lugar donde se lo puede contar.
      const empaque = empaqueEfectivo(item.empaqueCompraCorregido, item.empaqueCompra);
      if (claseEfectiva(item.claseForzada ?? null, item.clase, empaque) === 'empresa') {
        r.contadosDeEmpresa += 1;
      }
    }

    const v = veredicto(item);
    if (v === 'sin_erp') {
      r.sinDatoErp += 1;
      continue;
    }
    if (v === 'sin_contar') {
      r.sinContar += 1;
      continue;
    }

    r.auditables += 1;
    if (v === 'cuadrado') r.cuadrados += 1;
    else if (v === 'empresa') r.deEmpresa += 1;
    else r.conFalta += 1;

    const unidades = diferenciaUnidades(item);
    if (unidades === null || unidades === 0) continue;

    if (item.precioVenta === null) r.sinPrecio += 1;
    const valor = unidades * (item.precioVenta ?? 0);

    // LOS TOTALES NO CAMBIAN: siguen siendo la diferencia entera del
    // inventario, sin importar a que cuadro va. Son los que alimentan
    // `ResultadoInventario.montoFaltanteBruto`, y moverlos cambiaria el neto.
    if (unidades < 0) {
      r.unidadesFaltantes += -unidades;
      r.valorFaltante += -valor;
    } else {
      r.unidadesSobrantes += unidades;
      r.valorSobrante += valor;
    }

    // EL REPARTO EN TRES: lo que cambia es a QUIEN se le carga cada parte.
    const reparto = repartoDelItem(item, umbral);
    acumularEnCuadro(r.porClase.unidad, reparto.alPersonal, item.precioVenta);
    acumularEnCuadro(r.porClase.paquete, reparto.aPaquetes, item.precioVenta);
    acumularEnCuadro(r.porClase.empresa, reparto.aEmpresa, item.precioVenta);
  }

  // LO QUE SE LE DESCUENTA AL PERSONAL ES EL FALTANTE DEL CUADRO `unidad`, y
  // nada mas. Antes era "todo lo que no es empresa"; ahora tambien sale lo que
  // se fue al cuadro de paquetes, que se audita aparte. Por eso este numero
  // BAJA con este cambio -- que baje esta bien, que no cierre no (ver el test
  // de la invariante de la planilla).
  r.valorFaltanteDescontable = r.porClase.unidad.valorFaltante;

  r.porcentajeCuadrado = r.auditables === 0 ? 0 : redondear((r.cuadrados / r.auditables) * 100, 1);
  r.porcentajeAuditable = items.length === 0 ? 0 : redondear((r.auditables / items.length) * 100, 1);
  r.valorFaltante = redondear(r.valorFaltante);
  r.valorSobrante = redondear(r.valorSobrante);
  // Se redondea CADA cuadro al final, una sola vez, y no en cada suma: es el
  // mismo cuidado de `historial.calculos.ts` (redondear al final de la
  // operacion, no de la cadena). Asi los tres cuadros siguen sumando los
  // totales al centavo.
  for (const cuadro of [r.porClase.unidad, r.porClase.paquete, r.porClase.empresa]) {
    cuadro.valorFaltante = redondear(cuadro.valorFaltante);
    cuadro.valorSobrante = redondear(cuadro.valorSobrante);
  }
  r.valorFaltanteDescontable = redondear(r.valorFaltanteDescontable);
  return r;
}

export interface EmbudoDeConteos {
  itemsTotales: number;
  /**
   * EL EMBUDO COMPLETO: cuantos items se contaron en cada ronda, indice 0 =
   * ronda 1. Es la unica forma que sobrevive a las rondas extra del Auditor
   * -- con 6 rondas, los dos campos de abajo solo cuentan la mitad.
   *
   * El largo es el de la ronda MAS ALTA que tenga algun conteo, no el de la
   * lista mas larga: una lista de 6 posiciones donde las ultimas 3 son null
   * describe un inventario de 3 rondas, no de 6.
   */
  itemsPorRonda: number[];
  /**
   * Los dos escalones que `ResultadoInventario` guarda como columnas
   * (`items_segundo_conteo`, `items_tercer_conteo`), congelados al cerrar.
   *
   * SIGUEN SIENDO EXACTAMENTE ESO -- "cuantos llegaron a la ronda 2" y "a la
   * 3" -- y no se reinterpretan con las rondas extra. En un inventario de 6
   * rondas son ciertos pero incompletos: el embudo entero esta en
   * `itemsPorRonda`, y ahi hay que mirar. Se dejan porque las dos columnas
   * existen, el historico las lee y el sello del lacrado las hashea: cambiar
   * su significado reescribiria el pasado.
   */
  itemsSegundoConteo: number;
  itemsTercerConteo: number;
  itemsConDiferencia: number;
}

/**
 * El embudo de la Pantalla 4, sacado de la matriz: cuantos items entraron a
 * cada ronda. Es la misma forma que consume ResultadoInventario, asi que
 * cerrar el conteo puede alimentarse de aca sin recalcular nada.
 */
export function embudoDeConteos(items: ItemAuditoria[]): EmbudoDeConteos {
  // La ronda mas alta que alguien conto. No `Math.max(...largos)`: una lista
  // acolchada con nulls al final diria que hubo rondas que nadie conto.
  const rondas = items.reduce((tope, i) => Math.max(tope, rondasNecesarias(i)), 0);

  const itemsPorRonda: number[] = [];
  for (let ronda = 0; ronda < rondas; ronda++) {
    itemsPorRonda.push(items.filter((i) => (i.conteos[ronda] ?? null) !== null).length);
  }

  return {
    itemsTotales: items.length,
    itemsPorRonda,
    // `?? 0` y no un acceso directo: un inventario que cerro en la ronda 1
    // no tiene segundo escalon, y la columna pide un numero. Cero items
    // llegaron a la ronda 2 -- eso es cierto, no un dato faltante.
    itemsSegundoConteo: itemsPorRonda[1] ?? 0,
    itemsTercerConteo: itemsPorRonda[2] ?? 0,
    // Solo los que tienen una diferencia REAL calculada: un null no cuenta
    // como "sin diferencia", cuenta como "no se sabe".
    itemsConDiferencia: items.filter((i) => {
      const d = diferenciaUnidades(i);
      return d !== null && d !== 0;
    }).length,
  };
}

// ---------------------------------------------------------------------------
// El detalle que se congela al cerrar el conteo
// ---------------------------------------------------------------------------

/**
 * Una fila de `DiferenciaItem`, ya lista para persistir. Espeja las columnas
 * del modelo y no incluye `inventarioId`: eso lo pone quien escribe.
 */
export interface FilaDiferencia {
  codigo: string;
  /**
   * La clase EFECTIVA con la que se liquido este item -- con la excepcion del
   * Auditor ya adentro (`aplicarClasificacionVigente`). Se congela para poder
   * auditar la planilla meses despues: sin ella, "por que este faltante no se
   * descuento" solo se puede responder recalculando con el catalogo de hoy.
   */
  clase: ClaseItem;
  descripcion: string;
  stockSistema: number;
  conteoFinal: number;
  diferencia: number;
  resueltoEnConteo: number;
  /**
   * El precio de VENTA con el que se valorizo, nunca un costo: el snapshot
   * de Dynamics no trae costo y el cliente definio valorizar a precio de
   * venta. Ver `DiferenciaItem.precioUnitario` en schema.prisma. `null` si
   * el snapshot no trajo precio.
   */
  precioUnitario: number | null;
  montoDiferencia: number | null;
}

/**
 * El detalle item por item que se congela al cerrar el conteo: la contracara
 * de `resumir`/`embudoDeConteos`, que dan los mismos hechos agregados.
 *
 * QUE ENTRA Y QUE NO. Solo los items con una diferencia REAL distinta de
 * cero. Los otros tres casos se saltean, y cada uno por su razon:
 *
 *   - `cuadrado` (diferencia 0): conto exactamente lo que decia el ERP. No
 *     hay nada que ajustar ni que descontarle a nadie, y son la enorme
 *     mayoria del inventario (~7.350 de 8.000). Guardarlos serian 7.350
 *     filas por mes que dicen "no paso nada", y el
 *     `@@index([inventarioId, diferencia])` existe para encontrar los peores
 *     faltantes, no para pasear por los que cuadraron.
 *   - `sin_erp` (el snapshot no trajo stock): no se puede afirmar NADA de
 *     ese item. Una fila con `stockSistema: 0` diria "el ERP esperaba cero y
 *     apareció mercaderia", que es una acusacion, no un dato faltante.
 *   - `sin_contar` (nadie lo conto): mismo problema del otro lado. Un
 *     `conteoFinal: 0` se lee como "no habia nada en la gondola" y termina
 *     descontandose del sueldo de alguien.
 *
 * Es la misma regla que hace que `diferenciaUnidades` devuelva `null` y no
 * `0`: no saber no es un valor, y la unica forma de que no se confunda con
 * uno es no escribir la fila.
 *
 * Un item sin precio SI genera fila, con `montoDiferencia: null`: la
 * diferencia en unidades es un hecho verificado aunque no se pueda
 * valorizar, y es justo la fila que
 * `liquidacion.service.ts#contarItemsSinPrecio` busca para advertirle a
 * quien firma que el monto esta subestimado. Saltearla seria esconder el
 * problema que la advertencia existe para mostrar.
 */
export function diferenciasParaPersistir(items: ItemAuditoria[]): FilaDiferencia[] {
  const filas: FilaDiferencia[] = [];

  for (const item of items) {
    const diferencia = diferenciaUnidades(item);
    // `null` = falta un lado (sin_erp o sin_contar); `0` = cuadro.
    if (diferencia === null || diferencia === 0) continue;

    // Los dos non-null estan garantizados por `diferencia !== null`, pero se
    // chequean igual: el compilador no puede seguir esa implicacion, y un
    // `!` seria una promesa que nadie vuelve a verificar.
    const final = conteoFinal(item);
    if (item.stockErp === null || final === null) continue;

    filas.push({
      codigo: item.codigo,
      // La del item ya viene con la excepcion del Auditor aplicada; la guarda
      // del empaque se resuelve acá, que es donde esta el denominador -- y
      // sobre el empaque EFECTIVO, no el del snapshot (mismo orden que
      // `repartoDelItem`).
      clase: claseEfectiva(
        item.claseForzada,
        item.clase,
        empaqueEfectivo(item.empaqueCompraCorregido, item.empaqueCompra),
      ),
      // Congelada, como el modelo pide: la descripcion de HOY puede cambiar
      // en Dynamics y el historico tiene que decir que se conto entonces.
      descripcion: item.descripcion,
      stockSistema: item.stockErp,
      conteoFinal: final,
      diferencia,
      resueltoEnConteo: rondasNecesarias(item),
      precioUnitario: item.precioVenta,
      montoDiferencia: diferenciaValor(item),
    });
  }

  return filas;
}

/**
 * LA ATRIBUCION DE UN ITEM: a que cuadro va y POR QUE, lista para mostrar.
 *
 * Existe para que la pantalla pueda escribir la fila entera -- *"Va a
 * paquetes -- empaque 6 (Emp.6), faltan 23: 3,8 cajas"* -- que es el "hay que
 * indicar" del cliente.
 *
 * ---------------------------------------------------------------------------
 * POR QUE LA CALCULA EL SERVIDOR Y NO LA PANTALLA
 * ---------------------------------------------------------------------------
 * La alternativa era mandarle el umbral al movil y que el reparta. Se
 * descarto, y el motivo es el mismo que sostiene todo este modulo: la suma de
 * las atribuciones por item tiene que dar EXACTAMENTE los totales del
 * encabezado, y la unica forma de garantizarlo es que salgan del MISMO
 * calculo. Un espejo de `repartirDiferencia` en el movil seria un segundo
 * lugar donde la regla puede diferir, y diferir acá significa una pantalla
 * que dice "a esta persona se le descuentan S/20" mientras el total de arriba
 * dice otra cosa.
 *
 * Por eso esta funcion NO recalcula nada: llama a `repartoDelItem`, que es
 * quien decide, y solo le pone nombre a lo que ya decidio.
 */
export interface AtribucionItem {
  /** A que cuadro va este item. */
  clase: ClaseItem;
  /**
   * EL EMPAQUE CON EL QUE SE MIDIO -- el EFECTIVO, no el del ERP. Si el
   * Auditor lo corrigio a 12, acá dice 12: la fila tiene que explicar la
   * decision que se tomo, no la que se habria tomado con el dato viejo.
   * `null` = no habia con que medir.
   */
  empaqueUsado: number | null;
  /** El simbolo del ERP ("Emp.6"), para poder discutir de donde salio. */
  empaqueSimbolo: string | null;
  /**
   * `true` = el empaque de arriba es el que CORRIGIO EL AUDITOR, no el que
   * trajo Dynamics. Deja escribir "empaque 12 (corregido por el auditor)", que
   * es lo que le explica a quien discute el descuento por que su producto
   * cambio de cuadro.
   */
  empaqueEsCorregido: boolean;
  /** `|diferencia| / empaqueUsado` -- el numero que DECIDIO. `null` si no se pudo. */
  razon: number | null;
  /** Unidades que se le descuentan al personal, con signo. */
  unidadesAlPersonal: number;
  /** Unidades que salen al cuadro de paquetes, con signo. */
  unidadesAPaquetes: number;
  /** Unidades que absorbe la empresa, con signo. */
  unidadesAEmpresa: number;
}

export function atribucionDelItem(item: ItemAuditoria, umbral: number): AtribucionItem {
  // NO SE RECALCULA NADA: sale de la misma funcion que decide los totales.
  const reparto = repartoDelItem(item, umbral);
  const empaqueUsado = empaqueEfectivo(item.empaqueCompraCorregido, item.empaqueCompra);

  return {
    // La clase EFECTIVA, con la excepcion del Auditor y la re-derivacion por
    // empaque ya adentro -- lo mismo que uso el reparto.
    clase: claseEfectiva(item.claseForzada, item.clase, empaqueUsado),
    empaqueUsado,
    empaqueSimbolo: item.empaqueCompraSimbolo,
    // `!=` contra el del snapshot y no "hay correccion": si el Auditor corrigio
    // a 6 un item que el ERP ya traia en 6, la fila no tiene por que decir que
    // cambio algo.
    empaqueEsCorregido: item.empaqueCompraCorregido !== null && item.empaqueCompraCorregido !== item.empaqueCompra,
    razon: reparto.razon,
    unidadesAlPersonal: reparto.alPersonal,
    unidadesAPaquetes: reparto.aPaquetes,
    unidadesAEmpresa: reparto.aEmpresa,
  };
}

// ---------------------------------------------------------------------------
// El detalle del CUADRO DE PAQUETES
// ---------------------------------------------------------------------------

/**
 * Una fila del cuadro de faltante/sobrante por paquete.
 *
 * LLEVA EL DESGLOSE ENTERO, no el monto solo, y eso es requisito del cliente,
 * no comodidad: *"exacto, 5 es el residuo de la division, entonces 5 es lo que
 * se va a descontar al trabajador, PERO HAY QUE INDICAR"*. Quien lee el reporte
 * tiene que poder reconstruir "faltan 23 = 3 paquetes + 5 unidades" sin rehacer
 * la cuenta, y ver cual de las dos partes se le descuenta a quien.
 */
export interface FilaPaquete {
  codigo: string;
  descripcion: string;
  /**
   * "Emp.12" tal cual lo dice el ERP. `null` = el snapshot no lo trajo.
   *
   * Viaja al lado del numero a proposito: si manana alguien discute un
   * descuento, la respuesta es "el ERP dice Emp.12", no "el sistema calculo 12"
   * (ver el comentario de la columna en schema.prisma).
   */
  empaqueCompraSimbolo: string | null;
  /** El del ERP, tal cual. Puede NO ser el que se uso para medir: ver abajo. */
  empaqueCompra: number | null;
  /** El que corrigio el Auditor. `null` = sin corregir. */
  empaqueCompraCorregido: number | null;
  /**
   * EL QUE SE USO PARA MEDIR: `empaqueCompraCorregido ?? empaqueCompra`. Es el
   * denominador de `razon`, y el numero que hay que mostrar al lado de ella --
   * mostrar el del ERP junto a una razon calculada con el corregido daria una
   * cuenta que no cierra a la vista.
   */
  empaqueCompraUsado: number | null;
  /** La diferencia TOTAL del item, con signo. Negativo = faltante. */
  diferencia: number;
  /**
   * Lo que se le descuenta al personal. Con la regla vigente el item NO se
   * parte, asi que en una fila de este cuadro esto es SIEMPRE 0 -- viaja igual
   * para que la pantalla no tenga que asumirlo.
   */
  unidadesAlPersonal: number;
  /** Lo que sale del descuento: la diferencia ENTERA del item, con signo. */
  unidadesAPaquetes: number;
  /**
   * `|diferencia| / empaqueCompra` -- EL NUMERO QUE DECIDIO el destino.
   * `null` si no se pudo calcular (sin empaque de compra).
   *
   * Es el "hay que indicar" del cliente: el reporte tiene que explicar por que
   * este item salio del descuento al personal, y la respuesta es "faltan 23 de
   * un empaque de 6, o sea 3.8 cajas".
   */
  razon: number | null;
  /** Cajas COMPLETAS que entran en la diferencia. INFORMATIVO, no es criterio. */
  paquetesEnteros: number;
  /** Valorizado a precio de venta. `null` = el snapshot no trajo precio. */
  montoAPaquetes: number | null;
}

/**
 * Las filas del cuadro de paquetes: los items que aportaron al menos una caja
 * entera.
 *
 * UN ITEM VA ENTERO A UN CUADRO: si esta acá, NO esta en el descuento al
 * personal. Verificado contra el archivo del cliente -- ninguno de sus 107
 * renglones aparece en dos cuadros.
 *
 * `item.clase` llega con la excepcion del Auditor ya aplicada
 * (`aplicarClasificacionVigente`), igual que en `resumir`.
 */
export function filasDePaquete(items: ItemAuditoria[], umbral: number): FilaPaquete[] {
  const filas: FilaPaquete[] = [];

  for (const item of items) {
    const diferencia = diferenciaUnidades(item);
    if (diferencia === null || diferencia === 0) continue;

    const reparto = repartoDelItem(item, umbral);
    // Sin nada en el cuadro de paquetes no hay fila que mostrar: el item se
    // descuenta entero al personal y ya figura en el otro cuadro.
    if (reparto.aPaquetes === 0) continue;

    filas.push({
      codigo: item.codigo,
      // Congelada, como el resto del historico: la descripcion de HOY puede
      // cambiar en Dynamics y el reporte tiene que decir que se conto entonces.
      descripcion: item.descripcion,
      empaqueCompraSimbolo: item.empaqueCompraSimbolo,
      empaqueCompra: item.empaqueCompra,
      empaqueCompraCorregido: item.empaqueCompraCorregido,
      empaqueCompraUsado: empaqueEfectivo(item.empaqueCompraCorregido, item.empaqueCompra),
      diferencia,
      unidadesAlPersonal: reparto.alPersonal,
      unidadesAPaquetes: reparto.aPaquetes,
      razon: reparto.razon,
      paquetesEnteros: reparto.paquetesEnteros,
      montoAPaquetes:
        item.precioVenta === null ? null : redondear(reparto.aPaquetes * item.precioVenta),
    });
  }

  return filas;
}

// ---------------------------------------------------------------------------
// LOS CUATRO CUADROS + EMPRESA, item por item -- para el export con el formato
// del cliente (historial.exportar-cuadros.ts)
// ---------------------------------------------------------------------------

/** Una fila de cualquiera de los cuadros. Espeja el `FilaCuadro` del export. */
export interface FilaDeCuadro {
  codigo: string;
  descripcion: string;
  /** Con signo: negativo = faltante, positivo = sobrante. */
  cantidad: number;
  precioUnitario: number | null;
  /** `cantidad x precioUnitario`. `null` = no se pudo valorizar. */
  total: number | null;
}

/**
 * Los seis grupos del archivo de Gilmer: los cuatro cuadros mas los dos de
 * empresa.
 */
export interface CuadrosDeItems {
  faltantesUnicos: FilaDeCuadro[];
  sobrantesUnicos: FilaDeCuadro[];
  faltantesPaquete: FilaDeCuadro[];
  sobrantesPaquete: FilaDeCuadro[];
  empresaFaltantes: FilaDeCuadro[];
  empresaSobrantes: FilaDeCuadro[];
}

/**
 * Reparte los items del inventario en los seis grupos del archivo del cliente.
 *
 * SALE DEL MISMO CALCULO QUE EL RESUMEN -- `repartoDelItem`, via
 * `atribucionDelItem` -- y eso no es comodidad: el Excel y el panel de
 * auditoria tienen que decir el MISMO numero. Si el archivo dice una cosa y la
 * app otra, la discusion con el cliente esta perdida antes de empezar. Un
 * segundo reparto "para el export" seria exactamente ese riesgo.
 *
 * CADA ITEM CAE EN UN SOLO GRUPO, porque la regla no parte: un faltante va
 * entero a unicos o entero a paquetes. Verificado contra los 107 renglones del
 * archivo real -- ningun codigo aparece dos veces.
 *
 * Los items que no se pueden auditar (`sin_erp`, `sin_contar`) y los que
 * cuadraron NO entran en ningun cuadro: no hay diferencia que reportar. Es la
 * misma regla que hace que `diferenciasParaPersistir` no escriba la fila.
 */
export function cuadrosParaExportar(items: ItemAuditoria[], umbral: number): CuadrosDeItems {
  const cuadros: CuadrosDeItems = {
    faltantesUnicos: [],
    sobrantesUnicos: [],
    faltantesPaquete: [],
    sobrantesPaquete: [],
    empresaFaltantes: [],
    empresaSobrantes: [],
  };

  for (const item of items) {
    const diferencia = diferenciaUnidades(item);
    if (diferencia === null || diferencia === 0) continue;

    const a = atribucionDelItem(item, umbral);
    const fila: FilaDeCuadro = {
      codigo: item.codigo,
      descripcion: item.descripcion,
      cantidad: diferencia,
      precioUnitario: item.precioVenta,
      total: diferenciaValor(item),
    };

    const esFaltante = diferencia < 0;

    // SE AGRUPA POR DONDE FUERON LAS UNIDADES, NO POR LA CLASE DEL ITEM. No es
    // lo mismo, y confundirlos fue un bug real que encontro la comparacion del
    // Excel contra la pantalla (2026-09-19):
    //
    //   un item de clase `paquete` cuya razon NO supera el umbral -- faltan 2
    //   de un empaque de 6, 0.33 -- tiene sus unidades en `alPersonal`, o sea
    //   que va al cuadro UNICO. Agruparlo por su clase lo mandaba al cuadro de
    //   paquetes, y entonces el Excel repartia distinto que el panel de
    //   auditoria sobre los mismos items.
    //
    // La clase dice CON QUE REGLA se midio; el reparto dice DONDE CAYO. El
    // cuadro es lo segundo.
    if (a.unidadesAEmpresa !== 0) {
      (esFaltante ? cuadros.empresaFaltantes : cuadros.empresaSobrantes).push(fila);
    } else if (a.unidadesAPaquetes !== 0) {
      (esFaltante ? cuadros.faltantesPaquete : cuadros.sobrantesPaquete).push(fila);
    } else {
      (esFaltante ? cuadros.faltantesUnicos : cuadros.sobrantesUnicos).push(fila);
    }
  }

  return cuadros;
}

// ---------------------------------------------------------------------------
// LA CADENA: las diez tiendas de un periodo, en una sola tabla
// ---------------------------------------------------------------------------

/**
 * Una tienda en la tabla de la cadena.
 *
 * Es un RECORTE de `ResumenAuditoria`, no un resumen nuevo: cada cifra sale de
 * la misma llamada a `resumir()` que alimenta `/resumen` de esa tienda. Por eso
 * no hay ninguna cuenta acá -- si esta tabla y el panel de una tienda dieran
 * distinto, la pantalla mostraria dos verdades y nadie sabria cual creer.
 *
 * `inventarioId: null` NO es un hueco a esconder: es la COBERTURA DEL PERIODO
 * -- esa tienda todavia no arranco el mes. Es justamente lo que el Auditor
 * quiere ver de un vistazo en una cadena de diez tiendas.
 */
export interface FilaCadena {
  sucursalId: number;
  sucursal: string;
  /** null = esta tienda no tiene inventario en este periodo. */
  inventarioId: number | null;
  /** null junto con `inventarioId`: sin inventario no hay estado que declarar. */
  estado: EstadoInventario | null;
  items: number;
  auditables: number;
  cuadrados: number;
  valorFaltante: number;
  valorSobrante: number;
  porClase: PorClase;
}

/** El pie de la tabla: la cadena entera. */
export interface TotalCadena {
  /** Cuantas tiendas activas hay. Es el denominador de la cobertura. */
  tiendas: number;
  /** De esas, cuantas arrancaron el periodo. */
  conInventario: number;
  items: number;
  cuadrados: number;
  auditables: number;
  valorFaltante: number;
  valorSobrante: number;
  porClase: PorClase;
}

/** Los tres cuadros en cero, para una tienda sin inventario y para arrancar a sumar. */
export function porClaseVacia(): PorClase {
  return { unidad: cuadroVacio(), paquete: cuadroVacio(), empresa: cuadroVacio() };
}

function sumarCuadro(acumulado: CuadroDeDiferencias, cuadro: CuadroDeDiferencias): void {
  acumulado.items += cuadro.items;
  acumulado.unidadesFaltantes += cuadro.unidadesFaltantes;
  acumulado.unidadesSobrantes += cuadro.unidadesSobrantes;
  acumulado.valorFaltante += cuadro.valorFaltante;
  acumulado.valorSobrante += cuadro.valorSobrante;
}

/**
 * EL TOTAL ES LA SUMA DE LAS FILAS, no un `resumir()` sobre los items de las
 * diez tiendas juntas.
 *
 * Las dos vias darian lo mismo en unidades, pero no necesariamente al centavo:
 * `resumir` redondea al final de cada tienda, asi que sumar los items crudos
 * puede diferir en un centavo de la suma de lo que muestra cada fila. Y lo que
 * tiene que cerrar es la TABLA: quien mira el pie va a sumar la columna con la
 * calculadora, y si no da, el numero que sobra o falta no esta en ninguna parte
 * que se pueda señalar.
 *
 * Se vuelve a redondear porque sumar decimales de punto flotante los desvia
 * (161.7 + 88 da 249.70000000000002): sin esto el JSON llevaria esa cola.
 */
export function totalizarCadena(filas: readonly FilaCadena[]): TotalCadena {
  const total: TotalCadena = {
    tiendas: filas.length,
    conInventario: filas.filter((f) => f.inventarioId !== null).length,
    items: 0,
    cuadrados: 0,
    auditables: 0,
    valorFaltante: 0,
    valorSobrante: 0,
    porClase: porClaseVacia(),
  };

  for (const fila of filas) {
    total.items += fila.items;
    total.cuadrados += fila.cuadrados;
    total.auditables += fila.auditables;
    total.valorFaltante += fila.valorFaltante;
    total.valorSobrante += fila.valorSobrante;
    sumarCuadro(total.porClase.unidad, fila.porClase.unidad);
    sumarCuadro(total.porClase.paquete, fila.porClase.paquete);
    sumarCuadro(total.porClase.empresa, fila.porClase.empresa);
  }

  total.valorFaltante = redondear(total.valorFaltante);
  total.valorSobrante = redondear(total.valorSobrante);
  for (const cuadro of [total.porClase.unidad, total.porClase.paquete, total.porClase.empresa]) {
    cuadro.valorFaltante = redondear(cuadro.valorFaltante);
    cuadro.valorSobrante = redondear(cuadro.valorSobrante);
  }
  return total;
}

/**
 * El recorte de `ResumenAuditoria` que viaja en la tabla de la cadena. Vive
 * acá y no en el service para que se pueda probar sin base: lo unico que hace
 * es elegir campos, y eso es exactamente lo que no puede equivocarse.
 */
export function filaDeCadena(
  tienda: { sucursalId: number; sucursal: string; inventarioId: number; estado: EstadoInventario },
  resumen: ResumenAuditoria,
): FilaCadena {
  return {
    ...tienda,
    items: resumen.items,
    auditables: resumen.auditables,
    cuadrados: resumen.cuadrados,
    valorFaltante: resumen.valorFaltante,
    valorSobrante: resumen.valorSobrante,
    porClase: resumen.porClase,
  };
}

/** Una tienda que no arranco el periodo: todo en cero y los dos ids en null. */
export function filaDeCadenaSinInventario(sucursalId: number, sucursal: string): FilaCadena {
  return {
    sucursalId,
    sucursal,
    inventarioId: null,
    estado: null,
    items: 0,
    auditables: 0,
    cuadrados: 0,
    valorFaltante: 0,
    valorSobrante: 0,
    porClase: porClaseVacia(),
  };
}
