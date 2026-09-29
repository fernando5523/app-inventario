/**
 * Comparación de un ítem contra Dynamics tras el ciclo de conteos.
 *
 * ESPEJA backend/src/modules/auditoria/auditoria.calculos.ts, función por
 * función y con las MISMAS reglas. La cuenta que decide si el inventario
 * cuadra tiene que dar igual en el teléfono y en el servidor: si difieren, el
 * Auditor ve un número en la pantalla y otro en el cierre, y no hay forma de
 * saber cuál era el bueno. Cualquier cambio acá va también allá, y al revés.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA MÁS IMPORTANTE DE ESTE ARCHIVO: "NO SÉ" NO ES "CERO".
 *
 * Un ítem sin stock en el snapshot del ERP y un ítem cuyo ERP dice 0 son cosas
 * distintas; y un ítem que NADIE contó no es un ítem que cuadró. La versión
 * anterior de este archivo hacía `diferenciaUnidades = final === null ? 0 :
 * ...` y `veredicto = diferencia 0 ? 'cuadrado'`: para un inventario recién
 * abierto (catálogo cargado, cero conteos) eso reportaba "100% cuadrado" —
 * un vacío leído como éxito en la única pantalla donde se decide si el
 * inventario cierra. Por eso ahora `stockErp`/las diferencias son nullables y
 * hay dos veredictos (`sin_erp`, `sin_contar`) para lo que NO se puede afirmar.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * LA VARA YA NO ES UNA SOLA (decisión del cliente, Gilmer, 2026-09-29)
 * ---------------------------------------------------------------------------
 * Cada reconteo baja el stock NUEVO del ERP, y solo de los faltantes y
 * sobrantes que arrastra esa ronda. El primer conteo es el día 22 y los
 * reconteos los días siguientes: entre uno y otro hubo ventas y movimientos,
 * así que comparar la ronda 2 contra el stock del 22 mide contra una vara que
 * ya no existe. Quién resuelve contra qué stock se midió un ítem es
 * `stockDeLaMedicion`, y NINGUNA otra función de este archivo repite la regla.
 *
 * POR QUÉ ESTA COPIA EXISTE, que es lo que obliga a espejar el cambio: las
 * pantallas del teléfono calculan SIN RED (la matriz, el ajuste final, la
 * corrección). Mientras esta copia restara contra un único `stockErp`, el
 * teléfono y el servidor daban diferencias DISTINTAS sobre el mismo ítem en
 * cuanto una ronda tenía stock propio — y no hay forma de que el Auditor sepa
 * cuál de los dos números es el bueno.
 * ---------------------------------------------------------------------------
 */

import type { AtribucionItem, ItemAuditoria, VeredictoAuditoria } from './tipos';
import { ordinal } from './texto-cierre-ronda';

/**
 * El conteo que queda fijo para liquidar: el ÚLTIMO NO NULO de la lista. Si un
 * ítem cuadró en el 1er conteo no hay 2do ni 3ro, así que se toma el más
 * avanzado que exista — `null` si nadie lo contó.
 *
 * Recorre DE ATRÁS PARA ADELANTE y no con una cadena de `??` de tres
 * posiciones: así vale igual para un inventario de 3 rondas, uno de 5, o uno
 * donde el auditor agregó su ajuste final al final de la lista. Era
 * `conteo3 ?? conteo2 ?? conteo1`, y esa cadena es la que impedía el 4to
 * conteo que pidió el cliente.
 */
export function conteoFinal(item: Pick<ItemAuditoria, 'conteos'>): number | null {
  for (let i = item.conteos.length - 1; i >= 0; i--) {
    const valor = item.conteos[i];
    if (valor !== null && valor !== undefined) return valor;
  }
  return null;
}

/**
 * Lo mínimo para resolver contra qué stock se midió un ítem. Se declara aparte
 * de `ItemAuditoria` —igual que en el backend— porque lo piden también los
 * llamadores que arman un ítem sintético para previsualizar una diferencia (el
 * modal del ajuste final), que no tienen precio ni atribución que dar.
 */
export type ItemMedible = Pick<ItemAuditoria, 'conteos' | 'stockErp' | 'stockPorRonda'>;

/**
 * DE QUÉ RONDA SALIÓ EL STOCK CON EL QUE SE MIDIÓ ESTE ÍTEM.
 *
 * No es un dato de diagnóstico: es lo que la fila necesita para MARCAR que se
 * midió con una vara que no es la de su propia ronda. Sin esto la caída a la
 * ronda 1 sería silenciosa, y un ítem medido contra el stock de hace tres días
 * se vería igual que uno medido contra el de hoy.
 */
export interface StockDeLaMedicion {
  /**
   * EL STOCK QUE SE USÓ. `null` = no había ninguno con qué comparar (ni el de la
   * ronda del conteo ni el de la ronda 1): el ítem queda `sin_erp`.
   */
  stockErp: number | null;
  /**
   * La ronda del conteo QUE MANDA (1-based), la misma que `rondasNecesarias`.
   * `null` = nadie contó este ítem en ninguna ronda.
   */
  rondaDelConteo: number | null;
  /**
   * La ronda de la que salió `stockErp` (1-based). `null` = no había stock.
   * Distinta de `rondaDelConteo` SOLO cuando hubo que caer a la ronda 1.
   */
  rondaDelStock: number | null;
  /**
   * `true` = la ronda del conteo NO trajo stock propio y se midió con el de la
   * ronda 1. Pasa en dos casos, y los dos son legítimos: un inventario viejo
   * (sin stock por ronda en absoluto) y una ronda que se abrió sin poder bajar
   * el stock del día.
   *
   * ES EL BIT QUE LA FILA MUESTRA. La caída no se esconde porque cambia lo que
   * significa el número: "faltan 3" contra el stock del día y "faltan 3" contra
   * el stock de hace tres días no son la misma afirmación, y quien discute un
   * descuento tiene derecho a saber cuál de las dos le tocó.
   */
  cayoALaRonda1: boolean;
}

/**
 * LA REGLA NUEVA, Y EL ÚNICO LUGAR DONDE VIVE: cada conteo se compara contra el
 * stock DE SU PROPIA RONDA. ESPEJA `auditoria.calculos.ts#stockDeLaMedicion`.
 *
 * ---------------------------------------------------------------------------
 * SE RESUELVE POR LA RONDA DEL CONTEO QUE MANDA, NO POR LA ÚLTIMA QUE EXISTA
 * ---------------------------------------------------------------------------
 * Un ítem cuya hoja de la ronda 2 se finalizó sin que nadie lo tocara tiene
 * `conteos: [10, null]`: el conteo que manda es el de la ronda 1, así que se
 * mide con el stock de la ronda 1 — aunque la ronda 2 exista y haya traído el
 * suyo. Mirar la última ronda EXISTENTE compararía un conteo del día 22 contra
 * el stock de tres días después, y eso inventa una diferencia que nadie contó.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA RONDA 1 SE RESUELVE POR `stockErp` Y NO POR `stockPorRonda[0]`
 * ---------------------------------------------------------------------------
 * Son la misma cifra —se escriben juntas— pero una de las dos tiene que mandar o
 * el día que difieran nadie va a saber cuál creer. Manda `stockErp`, que es la
 * que ya leen el sello del lacrado y los inventarios históricos.
 *
 * ---------------------------------------------------------------------------
 * LA CAÍDA A LA RONDA 1 ES EXPLÍCITA, NO UN `??` ESCONDIDO
 * ---------------------------------------------------------------------------
 * Una ronda sin stock propio se mide con el de la ronda 1 — es lo único que hace
 * que los inventarios que ya estaban en la base sigan dando exactamente lo mismo
 * que antes. Pero queda DICHO en `cayoALaRonda1`, porque un inventario viejo y
 * una descarga que falló llegan al cálculo iguales y la pantalla tiene que poder
 * distinguir "se midió con la vara del día" de "se midió con la del día 22".
 *
 * SIN NINGÚN CONTEO no hay ronda que resolver, así que se usa el de la ronda 1:
 * es lo que mantiene el orden de `veredicto` (primero `sin_erp`, después
 * `sin_contar`) tal cual estaba.
 */
export function stockDeLaMedicion(item: ItemMedible): StockDeLaMedicion {
  // `|| null`: `rondasNecesarias` devuelve 0 cuando nadie lo contó, y un 0 en un
  // campo 1-based se leería como "la ronda cero".
  const rondaDelConteo = rondasNecesarias(item) || null;

  /** El de la ronda 1, que es el que manda para esa ronda y el de la caída. */
  const deLaRonda1: StockDeLaMedicion = {
    stockErp: item.stockErp,
    rondaDelConteo,
    rondaDelStock: item.stockErp === null ? null : 1,
    cayoALaRonda1: false,
  };

  if (rondaDelConteo === null || rondaDelConteo === 1) return deLaRonda1;

  // `?? null` y no un acceso pelado: la lista puede ser más corta que la ronda
  // (un inventario viejo trae `[]`), y `undefined` y `null` dicen lo mismo acá
  // — esta ronda no trajo stock para este ítem.
  const propio = item.stockPorRonda[rondaDelConteo - 1] ?? null;
  if (propio !== null) {
    return { stockErp: propio, rondaDelConteo, rondaDelStock: rondaDelConteo, cayoALaRonda1: false };
  }

  return { ...deLaRonda1, cayoALaRonda1: true };
}

/**
 * true si hay con qué comparar: stock del ERP Y algún conteo.
 *
 * EL STOCK ES EL DE LA RONDA QUE RESOLVIÓ EL ÍTEM, no el de la ronda 1 — misma
 * vara que `diferenciaUnidades`, o un ítem se declararía auditable y la
 * diferencia saldría null (o al revés).
 */
export function esAuditable(item: ItemMedible): boolean {
  return stockDeLaMedicion(item).stockErp !== null && conteoFinal(item) !== null;
}

/**
 * conteoFinal - el stock DE LA RONDA DE ESE CONTEO. Negativo = faltante,
 * positivo = sobrante.
 *
 * NO REPITE LA REGLA: la vara la resuelve `stockDeLaMedicion`. Si se escribiera
 * dos veces, la matriz y el ajuste final podrían medir el mismo ítem con varas
 * distintas — y este archivo ya existe para que eso no pase entre el teléfono y
 * el servidor.
 *
 * Devuelve `null` — NO 0 — cuando falta cualquiera de los dos lados. Un 0
 * significa "conté exactamente lo que decía el ERP", una afirmación fuerte;
 * no puede ser también el valor de "no tengo idea". Esta distinción es lo
 * único que impide que un catálogo sin contar se reporte como perfecto.
 */
export function diferenciaUnidades(item: ItemMedible): number | null {
  const final = conteoFinal(item);
  const { stockErp } = stockDeLaMedicion(item);
  if (stockErp === null || final === null) return null;
  return final - stockErp;
}

/**
 * diferenciaUnidades * precioVenta — nunca precio de compra.
 * `null` si no se puede calcular la diferencia o si no hay precio.
 */
export function diferenciaValor(item: ItemAuditoria): number | null {
  const unidades = diferenciaUnidades(item);
  if (unidades === null || item.precioVenta === null) return null;
  return unidades * item.precioVenta;
}

/**
 * El orden de los chequeos es la regla, no un detalle de implementación
 * (espeja `veredicto` del backend):
 *   1. Sin stock del ERP  -> `sin_erp`.  No se puede afirmar NADA del ítem.
 *   2. Sin ningún conteo   -> `sin_contar`. Hay ERP, pero nadie lo contó.
 *   3. Diferencia 0        -> `cuadrado`.
 *   4. Diferencia y la asume gerencia -> `empresa`.
 *   5. El resto            -> `falta` (faltante O sobrante).
 *
 * "SIN STOCK DEL ERP" ES EL DE LA RONDA QUE RESOLVIÓ EL ÍTEM, no el de la ronda
 * 1: la misma vara que `diferenciaUnidades`, o un ítem podría salir `cuadrado`
 * con la diferencia en null. Sin ningún conteo la resolución cae a la ronda 1,
 * así que el ORDEN de los dos primeros chequeos sigue dando lo que daba.
 *
 * TIENE UN CASO NUEVO, y es el que este cambio habilita: un ítem cuya ronda 1 no
 * trajo stock pero cuyo reconteo SÍ lo trajo deja de ser `sin_erp` y se audita
 * contra el stock del reconteo. Es correcto — ya hay con qué comparar.
 */
export function veredicto(item: ItemAuditoria): VeredictoAuditoria {
  if (stockDeLaMedicion(item).stockErp === null) return 'sin_erp';
  if (conteoFinal(item) === null) return 'sin_contar';
  if (diferenciaUnidades(item) === 0) return 'cuadrado';
  if (item.esEmpresa) return 'empresa';
  return 'falta';
}

/**
 * La POSICIÓN (1-based) del último conteo no nulo — o `0` si nadie lo contó.
 * Ya no tiene techo en 3: con un 4to o 5to conteo devuelve 4 o 5.
 *
 * El badge "Cuadró en Ner" sale de acá: NUNCA de un default a la última ronda
 * (ese era el bug — un ítem sin contar mostraba "Cuadró en 3er", nombrando
 * una ronda que no ocurrió).
 */
export function rondasNecesarias(item: Pick<ItemAuditoria, 'conteos'>): number {
  for (let i = item.conteos.length - 1; i >= 0; i--) {
    const valor = item.conteos[i];
    if (valor !== null && valor !== undefined) return i + 1;
  }
  return 0;
}

/**
 * LA LISTA DE CONTEOS CON EL AJUSTE DEL AUDITOR YA PUESTO, para previsualizar
 * qué diferencia dejaría un valor antes de guardarlo.
 *
 * EL AJUSTE REEMPLAZA EL ÚLTIMO VALOR CONTADO -- es textual del cliente
 * ("cambiar los valores contados del último conteo") -- así que se pisa la
 * última posición con dato y NO se agrega una columna: una columna extra haría
 * que la fila muestre una ronda que nadie contó.
 *
 * Y ESO ES LO QUE HACE QUE LA PREVISUALIZACIÓN MIDA BIEN. El modal del ajuste
 * armaba un ítem sintético con `conteos: [valor]`, o sea un conteo de la RONDA 1,
 * y contra un ítem que se resolvió en la ronda 3 eso lo comparaba con el stock
 * del día 22: el modal prometía "con este valor el ítem cuadra" y al guardar la
 * fila seguía en falta. Conservando la posición, la vara la resuelve
 * `stockDeLaMedicion` igual que en la fila.
 *
 * SIN NINGÚN CONTEO el ajuste entra en la primera posición: el Auditor puso un
 * valor donde no había ninguno, que es un caso real (un ítem que nadie llegó a
 * contar). COPIA, nunca la lista original: los ítems de la matriz se comparten
 * por referencia con la pantalla, y mutarlos cambiaría la fila de atrás mientras
 * el modal está abierto.
 */
export function conteosConAjuste(conteos: ReadonlyArray<number | null>, ajuste: number): Array<number | null> {
  const copia = [...conteos];
  const ronda = rondasNecesarias({ conteos });
  copia[ronda === 0 ? 0 : ronda - 1] = ajuste;
  return copia;
}

/**
 * El resumen HONESTO del encabezado, sobre TODOS los ítems del inventario.
 * Distingue contados de sin contar, y `cuadrados` NUNCA incluye a los que
 * nadie contó: `auditables` (con ERP y con conteo) es el denominador real del
 * "cuadrado X de Y". Incluye `veredictoPorId` para que la pantalla filtre en
 * O(1) sin re-recorrer el catálogo — una sola pasada, una sola fuente.
 */
export interface ResumenAuditoria {
  total: number;
  /** Tienen al menos un conteo (`conteoFinal !== null`). */
  contados: number;
  /** Tienen stock del ERP pero nadie los contó todavía. */
  sinContar: number;
  /** El snapshot no trajo stock del ERP: no se pueden auditar. */
  sinDatoErp: number;
  /** total - sinContar - sinDatoErp: sobre estos se puede afirmar algo. */
  auditables: number;
  cuadrados: number;
  conFalta: number;
  deEmpresa: number;
  /** Ítems con una diferencia REAL != 0 (falta + empresa). */
  conDiferencia: number;
  /** Suma de las diferencias en valor: faltante <= 0, sobrante >= 0. */
  faltanteNeto: number;
  sobranteNeto: number;
  /** Lo que absorbe la empresa (no se descuenta a nómina). */
  asumidoEmpresa: number;
  /** Ítems con diferencia que no se pudieron valorizar por falta de precio. */
  sinPrecio: number;
  veredictoPorId: Map<number, VeredictoAuditoria>;
}

export function resumirAuditoria(items: readonly ItemAuditoria[]): ResumenAuditoria {
  const r: ResumenAuditoria = {
    total: items.length,
    contados: 0,
    sinContar: 0,
    sinDatoErp: 0,
    auditables: 0,
    cuadrados: 0,
    conFalta: 0,
    deEmpresa: 0,
    conDiferencia: 0,
    faltanteNeto: 0,
    sobranteNeto: 0,
    asumidoEmpresa: 0,
    sinPrecio: 0,
    veredictoPorId: new Map<number, VeredictoAuditoria>(),
  };

  for (const item of items) {
    const v = veredicto(item);
    r.veredictoPorId.set(item.productoId, v);
    if (conteoFinal(item) !== null) r.contados += 1;

    if (v === 'sin_erp') {
      r.sinDatoErp += 1;
      continue;
    }
    if (v === 'sin_contar') {
      r.sinContar += 1;
      continue;
    }

    r.auditables += 1;
    if (v === 'cuadrado') {
      r.cuadrados += 1;
      continue;
    }

    // falta o empresa: hay una diferencia real.
    r.conDiferencia += 1;
    if (v === 'empresa') r.deEmpresa += 1;
    else r.conFalta += 1;

    const valor = diferenciaValor(item);
    if (valor === null) {
      r.sinPrecio += 1;
      continue;
    }
    if (v === 'empresa') {
      r.asumidoEmpresa += valor;
    } else if (valor < 0) {
      r.faltanteNeto += valor;
    } else {
      r.sobranteNeto += valor;
    }
  }

  return r;
}

// ---------------------------------------------------------------------------
// A qué cuadro fue cada ítem, y por qué
// ---------------------------------------------------------------------------

/**
 * Los cuatro destinos que el Auditor puede leer en una fila. `null` = la
 * diferencia no se pudo repartir (sin stock del ERP, sin contar, o cuadró):
 * NO es un cuadro más, y por eso no se inventa uno.
 */
export type CuadroDelItem = 'personal' | 'paquetes' | 'empresa' | null;

/**
 * A QUÉ CUADRO FUE ESTE ÍTEM, leído del reparto que ya resolvió el servidor.
 *
 * Se mira cuál de las tres `unidadesA*` es distinta de cero, y NO la `clase`:
 * son cosas distintas y confundirlas es un error caro. Medido contra el
 * escenario real (inventario 8059): los tres ítems con diferencia tienen
 * `clase: 'paquete'`, pero uno de ellos —diferencia de 2 sobre un empaque de
 * 6— se le descuenta AL PERSONAL, porque no llega a medio empaque. Con la clase
 * sola, la fila habría dicho "va a paquetes" sobre plata que sí se descuenta.
 */
export function cuadroDelItem(a: AtribucionItem): CuadroDelItem {
  if (a.unidadesAPaquetes !== 0) return 'paquetes';
  if (a.unidadesAEmpresa !== 0) return 'empresa';
  if (a.unidadesAlPersonal !== 0) return 'personal';
  return null;
}

/** El nombre del cuadro, con las palabras del cliente. */
export function textoCuadro(cuadro: Exclude<CuadroDelItem, null>): string {
  if (cuadro === 'paquetes') return 'Va a paquetes';
  if (cuadro === 'empresa') return 'Lo asume la empresa';
  return 'Se le descuenta al personal';
}

/**
 * EL EMPAQUE CON EL QUE SE MIDIÓ, listo para leer.
 *
 * EL SÍMBOLO DEL ERP VA TAL CUAL Y SOLO: "Emp.6", no "empaque 6 (Emp.6)".
 * Regla del usuario para toda la app — los empaques de Dynamics se muestran
 * como vinieron, sin anteponerles una palabra nuestra ni traducirlos a chico,
 * grande o display. El porqué ya está escrito en el schema, al lado de la
 * columna: si mañana alguien discute un descuento, la respuesta es "el ERP
 * dice Emp.12", no "el sistema calculó 12". Anteponerle "empaque" repetía el
 * dato (el símbolo ya lo dice) y le ponía nuestra voz a un nombre ajeno.
 *
 * EL CASO CORREGIDO NO TIENE SÍMBOLO, y por eso ahí sí va el número: el
 * Auditor lo tecleó a mano y `empaqueSimbolo` sigue describiendo el empaque
 * DEL SNAPSHOT. Pegarlos diría algo falso — el caso real del escenario es
 * `empaqueUsado: 12` con `empaqueSimbolo: "U"`, y "12 (U)" se lee como "doce
 * unidades sueltas", justo lo contrario de lo que pasó. Se dice de quién es
 * el número ("corregido por el auditor") para que nadie lo lea como un dato
 * de Dynamics.
 *
 * `null` cuando no hubo empaque con el cual medir.
 */
export function textoEmpaqueUsado(a: AtribucionItem): string | null {
  if (a.empaqueUsado === null) return null;
  if (a.empaqueEsCorregido) return `${a.empaqueUsado}, corregido por el auditor`;
  // Sin símbolo queda el número pelado, que es lo único honesto que se puede
  // decir. No es un caso esperado: el snapshot saca los dos campos del MISMO
  // objeto (`d365-catalogo.service.ts#empaqueDeCompra`), así que vienen juntos
  // o vienen los dos en null. Es una red, no una rama de negocio.
  return a.empaqueSimbolo ?? String(a.empaqueUsado);
}

// ---------------------------------------------------------------------------
// Contra qué stock se midió, dicho en la fila
// ---------------------------------------------------------------------------

/**
 * EL RÓTULO DEL STOCK, CON LA RONDA DE LA QUE SALIÓ.
 *
 * Sigue el criterio que ya usa la app para un dato que viene de otro lado que el
 * esperado: el número se muestra tal cual y al lado se dice DE QUIÉN es (igual
 * que `textoEmpaqueUsado`, que escribe "12, corregido por el auditor" en vez de
 * pasar un 12 pelado como si lo hubiera dicho Dynamics).
 *
 * `base` viene inyectado —"ERP" en la matriz, "Stock ERP" en el ajuste, "Stock"
 * en la corrección— porque cada pantalla ya tiene su palabra y son las palabras
 * con las que el Auditor las pide. Lo que NO se reparte es la regla de cuándo
 * hace falta nombrar la ronda, que es esta función.
 *
 * SOLO NOMBRA LA RONDA CUANDO HAY DOS QUE PUEDEN CONFUNDIRSE. Con un inventario
 * de una sola ronda —o sin conteo— el rótulo queda tal cual estaba: agregarle un
 * "1°" a la única ronda que existe sería ruido en las 160 hojas del caso normal.
 *
 * EL CASO QUE IMPORTA es el desalineado: con la caída a la ronda 1, la celda del
 * conteo dice "2°" y la del stock dice "ERP 1°". Ahí la resta se explica sola
 * sin leer una palabra, que es lo que hace falta en una lista de cientos de
 * filas; el porqué completo lo da `textoStockDeLaMedicion`.
 */
export function rotuloStockDeLaMedicion(m: StockDeLaMedicion, base: string): string {
  if (m.rondaDelStock === null) return base;
  if (m.rondaDelConteo === null || m.rondaDelConteo === 1) return base;
  // `N°` y no `ordinal(N)`: es el MISMO formato que rotula las celdas de cada
  // ronda al lado ("1°", "2°"). "ERP 1er" junto a una celda que dice "2°" haría
  // que los dos números de la misma fila se nombren de dos maneras distintas.
  return `${base} ${m.rondaDelStock}°`;
}

/**
 * POR QUÉ ESTA FILA SE MIDIÓ CONTRA ESE STOCK. `null` cuando no hay nada que
 * explicar: sin stock, con una sola ronda, o cuando el stock es justamente el de
 * la ronda del conteo (el caso normal desde el cambio).
 *
 * LA CAÍDA SE DICE CON PALABRAS y no solo con el rótulo, porque no es un detalle
 * de presentación: "faltan 3" contra el stock del día y "faltan 3" contra el del
 * día 22 no son la misma afirmación, y de eso sale un descuento a nómina. Quien
 * lo discuta tiene derecho a saber cuál de las dos le tocó.
 */
export function textoStockDeLaMedicion(m: StockDeLaMedicion): string | null {
  if (m.stockErp === null || m.rondaDelConteo === null || m.rondaDelStock === null) return null;
  if (m.cayoALaRonda1) {
    return `El ${ordinal(m.rondaDelConteo)} conteo no trajo stock propio del ERP: se comparó contra el stock del ${ordinal(1)} conteo.`;
  }
  if (m.rondaDelStock > 1) {
    return `Se comparó contra el stock que el ERP dio para el ${ordinal(m.rondaDelStock)} conteo.`;
  }
  return null;
}

/**
 * POR QUÉ FUE A ESE CUADRO — el "hay que indicar" que pidió el cliente: la
 * cantidad, el empaque con el que se midió y la razón entre los dos.
 *
 * Sin esto el Auditor solo puede creerle a la pantalla; con esto puede
 * discutirlo. `null` cuando no hay nada que explicar (sin empaque, o sin razón
 * calculable): antes que una explicación a medias, ninguna.
 *
 * `formatoRazon` viene inyectado, como en `comparativo-ronda.ts`: el dominio
 * no formatea números (los datos ICU de es-PE no están garantizados en Hermes).
 */
export function textoPorQueCuadro(
  a: AtribucionItem,
  diferenciaUnidades: number,
  formatoRazon: (n: number) => string,
): string | null {
  const empaque = textoEmpaqueUsado(a);
  if (empaque === null || a.razon === null) return null;
  const magnitud = Math.abs(diferenciaUnidades);
  const verbo = diferenciaUnidades < 0 ? 'faltan' : 'sobran';
  // "empaques" y NO "cajas": el ERP dice Emp.6, no dice caja. Un Emp.6 puede
  // ser un six pack, una plancha o un display; llamarlo caja es afirmar una
  // presentación que no sabemos. "Empaque" es la palabra del propio símbolo
  // ("Emp." la abrevia), así que nombra la unidad sin inventar nada.
  //
  // Y separa con "·", no con coma: el caso corregido ya trae una coma adentro
  // ("12, corregido por el auditor") y encadenarle otra daba
  // "...el auditor, faltan 21", que se lee como si al auditor le faltaran 21.
  return `${empaque} · ${verbo} ${magnitud}: ${formatoRazon(a.razon)} empaques`;
}

/**
 * LO QUE LA EMPRESA TERMINA PAGANDO de su propio cuadro: el faltante menos el
 * sobrante.
 *
 * NUNCA NEGATIVO, y no es una precaución cosmética. Los dos montos llegan del
 * servidor SIEMPRE en positivo (ver `CuadroDeDiferencias` en el puerto), así
 * que restar puede dar bajo cero cuando sobró más de lo que faltó. Mostrar
 * "Paga la empresa -S/ 36,00" con el signo al revés no significa nada para
 * quien lo lee: nadie paga una cantidad negativa, y no es que la empresa cobre
 * — el sobrante no se le devuelve a nadie. Lo verdadero ahí es que no hay nada
 * que pagar, y eso se dice con un 0.
 *
 * Devuelve el monto en POSITIVO; el signo lo pone la pantalla, igual que con
 * el resto de los faltantes.
 */
export function pagaLaEmpresa(cuadro: { valorFaltante: number; valorSobrante: number }): number {
  return Math.max(0, cuadro.valorFaltante - cuadro.valorSobrante);
}
