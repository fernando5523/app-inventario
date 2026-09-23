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
 */

import type { AtribucionItem, ItemAuditoria, VeredictoAuditoria } from './tipos';

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

/** true si hay con qué comparar: stock del ERP Y algún conteo. */
export function esAuditable(item: Pick<ItemAuditoria, 'stockErp' | 'conteos'>): boolean {
  return item.stockErp !== null && conteoFinal(item) !== null;
}

/**
 * conteoFinal - stockErp. Negativo = faltante, positivo = sobrante.
 *
 * Devuelve `null` — NO 0 — cuando falta cualquiera de los dos lados. Un 0
 * significa "conté exactamente lo que decía el ERP", una afirmación fuerte;
 * no puede ser también el valor de "no tengo idea". Esta distinción es lo
 * único que impide que un catálogo sin contar se reporte como perfecto.
 */
export function diferenciaUnidades(item: Pick<ItemAuditoria, 'conteos' | 'stockErp'>): number | null {
  const final = conteoFinal(item);
  if (item.stockErp === null || final === null) return null;
  return final - item.stockErp;
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
 */
export function veredicto(item: ItemAuditoria): VeredictoAuditoria {
  if (item.stockErp === null) return 'sin_erp';
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
