/**
 * EL STOCK DEL ERP POR RONDA: cada conteo se mide contra la vara de SU ronda.
 *
 * Decision del cliente (Gilmer, 2026-09-29): cada reconteo trae el stock NUEVO
 * del ERP, y solo de los faltantes y sobrantes que arrastra esa ronda. Hasta
 * entonces habia UNA vara congelada al abrir el mes y las tres rondas se
 * comparaban contra ella -- pero el primer conteo es el dia 22 y los reconteos
 * son los dias siguientes, con ventas, transferencias y los ajustes que el
 * cliente parcha a mano con su hoja NEGATIVO.
 *
 * LO QUE ESTOS TESTS FIJAN, Y QUE ES LO QUE MAS FACIL SE "ARREGLA" POR ERROR:
 * con stock nuevo por ronda EL RECONTEO YA NO VERIFICA AL CONTEO ANTERIOR, es
 * una medicion independiente. Un item con "falta 1" el lunes puede salir
 * cuadrado el martes SIN QUE NADIE TOQUE EL ESTANTE, solo porque se vendio una
 * unidad (`cuadra contra el stock nuevo aunque faltara contra el viejo`). Quien
 * lea eso en seis meses y lo tome por un bug de conciliacion va a querer
 * comparar las dos rondas entre si: no hay que hacerlo, es lo que el cliente
 * hace hoy en su Excel y es lo que se pidio replicar.
 *
 * Los tests que ya existian (auditoria.calculos.test.ts) cubren el inventario
 * SIN stock por ronda -- todos los de la base antes de este cambio -- y siguen
 * pasando sin tocar una sola expectativa: ahi `stockPorRonda` es `[]` y todo
 * cae a la ronda 1.
 */
import { describe, expect, it } from 'vitest';
import {
  diferenciasParaPersistir,
  diferenciaUnidades,
  diferenciaValor,
  esAuditable,
  resumir,
  stockDeLaMedicion,
  veredicto,
  type ItemAuditoria,
} from './auditoria.calculos';

/** El umbral congelado del inventario, igual que en auditoria.calculos.test.ts. */
const UMBRAL = 0.5;

const item = (parcial: Partial<ItemAuditoria> = {}): ItemAuditoria => ({
  productoId: 1,
  codigo: 'IT-0001',
  descripcion: 'Aceite Vegetal Primor 900ml',
  zona: 'A',
  hoja: '001',
  precioVenta: 10,
  // El stock de la RONDA 1, que es el que manda para esa ronda y el de la caida.
  stockErp: 100,
  conteos: [null],
  stockPorRonda: [],
  esEmpresa: false,
  clase: 'unidad',
  claseForzada: null,
  empaqueCompra: null,
  empaqueCompraSimbolo: null,
  empaqueCompraCorregido: null,
  ...parcial,
});

// ---------------------------------------------------------------------------
// LA RONDA 2 CON STOCK PROPIO: la diferencia sale contra ESE stock
// ---------------------------------------------------------------------------

describe('la ronda 2 tiene su propio stock', () => {
  // El caso del dia 22 contra el dia 23: el ERP decia 100 y ahora dice 97
  // porque se vendieron tres. En la ronda 2 se contaron 97.
  const recontado = item({ stockErp: 100, conteos: [98, 97], stockPorRonda: [100, 97] });

  it('la diferencia se mide contra el stock de la ronda 2, NO contra el de la 1', () => {
    // Contra la vara vieja serian -3; contra la de su propia ronda, 0.
    expect(diferenciaUnidades(recontado)).toBe(0);
    expect(veredicto(recontado)).toBe('cuadrado');
  });

  it('`stockDeLaMedicion` dice de que ronda salio, y que NO hubo caida', () => {
    expect(stockDeLaMedicion(recontado)).toEqual({
      stockErp: 97,
      rondaDelConteo: 2,
      rondaDelStock: 2,
      cayoALaRonda1: false,
    });
  });

  it('el valorizado usa la diferencia nueva: sin diferencia no hay monto', () => {
    expect(diferenciaValor(recontado)).toBe(0);
  });

  it('el resumen del inventario lo cuenta como cuadrado, no como faltante de S/30', () => {
    const r = resumir([recontado], UMBRAL);
    expect(r.cuadrados).toBe(1);
    expect(r.conFalta).toBe(0);
    expect(r.valorFaltante).toBe(0);
    expect(r.porClase.unidad.valorFaltante).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EL CASO QUE EL CLIENTE DESCRIBIO: faltaba el lunes y cuadra el martes
// ---------------------------------------------------------------------------

describe('cuadra contra el stock nuevo aunque faltara contra el viejo', () => {
  it('sin que nadie toque el estante: se vendio una unidad entre las dos rondas', () => {
    // Lunes: el ERP dice 50, se contaron 49 -> falta 1, va a reconteo.
    // Martes: el ERP dice 49 (se vendio una) y se vuelven a contar 49.
    const item22 = item({ stockErp: 50, conteos: [49], stockPorRonda: [50] });
    expect(diferenciaUnidades(item22)).toBe(-1);

    const item23 = item({ stockErp: 50, conteos: [49, 49], stockPorRonda: [50, 49] });
    expect(diferenciaUnidades(item23)).toBe(0);
    expect(veredicto(item23)).toBe('cuadrado');
  });

  it('al reves tambien: cuadraba contra el viejo y el stock nuevo lo pone en falta', () => {
    // No es un caso raro: el ERP tambien puede SUBIR entre rondas (una
    // transferencia que entro), y entonces lo contado ya no alcanza.
    const conStockNuevo = item({ stockErp: 40, conteos: [40, 40], stockPorRonda: [40, 44] });
    expect(diferenciaUnidades(conStockNuevo)).toBe(-4);
    expect(veredicto(conStockNuevo)).toBe('falta');
  });
});

// ---------------------------------------------------------------------------
// LA RONDA 2 SIN STOCK PROPIO: cae a la ronda 1, y SE DICE
// ---------------------------------------------------------------------------

describe('la ronda 2 no tiene stock propio', () => {
  // Un inventario viejo (lista vacia) y una ronda que se abrio sin poder
  // descargar (null en su posicion) llegan al calculo iguales.
  const sinStockDeRonda = item({ stockErp: 100, conteos: [98, 97], stockPorRonda: [] });
  const conHueco = item({ stockErp: 100, conteos: [98, 97], stockPorRonda: [100, null] });

  it('la diferencia cae al stock de la ronda 1 -- el inventario viejo no cambia', () => {
    expect(diferenciaUnidades(sinStockDeRonda)).toBe(-3);
    expect(diferenciaUnidades(conHueco)).toBe(-3);
  });

  it('la caida NO es silenciosa: `cayoALaRonda1` la marca para la matriz', () => {
    // Es lo que la pantalla necesita para avisar que "faltan 3" salio de la vara
    // del dia 22 y no de la del dia de ese reconteo. Las dos afirmaciones no son
    // la misma y quien discuta el descuento tiene derecho a saber cual le toco.
    expect(stockDeLaMedicion(sinStockDeRonda)).toEqual({
      stockErp: 100,
      rondaDelConteo: 2,
      rondaDelStock: 1,
      cayoALaRonda1: true,
    });
    expect(stockDeLaMedicion(conHueco).cayoALaRonda1).toBe(true);
  });

  it('una lista mas corta que la ronda del conteo se lee como hueco, no como error', () => {
    // La ronda 3 conto y solo hay stock de las dos primeras: cae a la ronda 1.
    const tresRondas = item({ stockErp: 100, conteos: [98, 97, 96], stockPorRonda: [100, 97] });
    expect(diferenciaUnidades(tresRondas)).toBe(-4);
    expect(stockDeLaMedicion(tresRondas).cayoALaRonda1).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EL ITEM QUE CUADRO EN LA RONDA 1 Y NUNCA SE RECONTO
// ---------------------------------------------------------------------------

describe('el item que cuadro en la ronda 1 y nunca fue recontado', () => {
  // Son ~7.350 de 8.000: la enorme mayoria del inventario. Que este caso no se
  // mueva es la mitad del valor de este cambio.
  const cuadroEnLa1 = item({ stockErp: 100, conteos: [100], stockPorRonda: [100] });

  it('se mide contra la ronda 1 y cuadra, sin caida que marcar', () => {
    expect(diferenciaUnidades(cuadroEnLa1)).toBe(0);
    expect(veredicto(cuadroEnLa1)).toBe('cuadrado');
    expect(stockDeLaMedicion(cuadroEnLa1)).toEqual({
      stockErp: 100,
      rondaDelConteo: 1,
      rondaDelStock: 1,
      cayoALaRonda1: false,
    });
  });

  it('NO lo afecta que OTRA ronda exista con otro stock: su conteo es de la 1', () => {
    // La ronda 2 existe en el inventario y este item ni entro. Su vara sigue
    // siendo la de la ronda 1 -- mirar la ultima posicion de la lista lo mediria
    // contra un stock que nadie uso para el.
    const conRonda2Ajena = item({ stockErp: 100, conteos: [100, null], stockPorRonda: [100, 80] });
    expect(diferenciaUnidades(conRonda2Ajena)).toBe(0);
    expect(stockDeLaMedicion(conRonda2Ajena).rondaDelStock).toBe(1);
  });

  it('MANDA `stockErp` sobre `stockPorRonda[0]` cuando difieren', () => {
    // No pueden diferir -- se escriben juntas -- pero si alguna vez pasara, la
    // que manda es la que leen el sello del lacrado y los inventarios
    // historicos. Un inventario lacrado no puede recalcularse con un numero que
    // su propio sello no hasheo.
    const desalineado = item({ stockErp: 100, conteos: [100], stockPorRonda: [80] });
    expect(diferenciaUnidades(desalineado)).toBe(0);
    expect(stockDeLaMedicion(desalineado).stockErp).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// "NO SE" NO ES "CERO", tambien en las capas nuevas
// ---------------------------------------------------------------------------

describe('el stock `null` en una ronda', () => {
  it('la ronda 2 en null cae a la 1, que SI tiene stock: se audita igual', () => {
    const conHueco = item({ stockErp: 60, conteos: [55, 55], stockPorRonda: [60, null] });
    expect(diferenciaUnidades(conHueco)).toBe(-5);
    expect(esAuditable(conHueco)).toBe(true);
  });

  it('null en las DOS rondas: `sin_erp`, y la diferencia es null, NO 0', () => {
    const sinNada = item({ stockErp: null, conteos: [55, 55], stockPorRonda: [null, null] });
    expect(veredicto(sinNada)).toBe('sin_erp');
    expect(diferenciaUnidades(sinNada)).toBeNull();
    expect(diferenciaValor(sinNada)).toBeNull();
    expect(esAuditable(sinNada)).toBe(false);
    expect(stockDeLaMedicion(sinNada).rondaDelStock).toBeNull();
  });

  it('un stock de ronda en 0 NO es un hueco: cuadra en cero', () => {
    // La distincion que sostiene todo el archivo: 0 afirma "no deberia haber
    // ninguno" y es una comparacion valida; null dice "no se".
    const ceroDeVerdad = item({ stockErp: 12, conteos: [12, 0], stockPorRonda: [12, 0] });
    expect(diferenciaUnidades(ceroDeVerdad)).toBe(0);
    expect(veredicto(ceroDeVerdad)).toBe('cuadrado');
  });

  it('la ronda 1 sin stock pero el reconteo CON stock: deja de ser sin_erp', () => {
    // Caso nuevo que este cambio habilita -- ya hay con que comparar. Es raro en
    // la practica porque los `sin_dato_erp` no se arrastran a la ronda siguiente
    // (ciclo-conteos.ts#destinoTrasRonda), pero el calculo tiene que ser honesto
    // si el item llego ahi por otra via.
    const apareceEnLa2 = item({ stockErp: null, conteos: [30, 30], stockPorRonda: [null, 30] });
    expect(veredicto(apareceEnLa2)).toBe('cuadrado');
    expect(stockDeLaMedicion(apareceEnLa2).rondaDelStock).toBe(2);
  });

  it('sin ningun conteo la resolucion cae a la ronda 1: el orden de `veredicto` no se mueve', () => {
    // `sin_erp` tiene que seguir ganandole a `sin_contar` cuando no hay stock, y
    // `sin_contar` tiene que seguir apareciendo cuando si hay.
    expect(veredicto(item({ stockErp: null, conteos: [null], stockPorRonda: [null, 5] }))).toBe('sin_erp');
    expect(veredicto(item({ stockErp: 10, conteos: [null], stockPorRonda: [10, 5] }))).toBe('sin_contar');
    expect(stockDeLaMedicion(item({ stockErp: 10, conteos: [null], stockPorRonda: [] })).rondaDelConteo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LO QUE SE CONGELA AL CERRAR: el stock de la ronda QUE RESOLVIO el item
// ---------------------------------------------------------------------------

describe('diferenciasParaPersistir congela el stock de la ronda que resolvio', () => {
  it('guarda el stock de la ronda 2, no el de la 1', () => {
    const recontado = item({ codigo: 'IT-7', stockErp: 100, conteos: [98, 97], stockPorRonda: [100, 99] });
    const [fila] = diferenciasParaPersistir([recontado]);

    expect(fila).toMatchObject({
      codigo: 'IT-7',
      stockSistema: 99,
      conteoFinal: 97,
      diferencia: -2,
      resueltoEnConteo: 2,
    });
  });

  it('LA FILA CIERRA CONSIGO MISMA: conteoFinal - stockSistema === diferencia', () => {
    // Es la invariante que hace auditable la planilla seis meses despues, cuando
    // nadie pueda recalcular nada. Congelar el stock de la ronda 1 con la
    // diferencia de la ronda 2 la rompe en silencio.
    const casos = [
      item({ codigo: 'A', stockErp: 100, conteos: [98, 97], stockPorRonda: [100, 99] }),
      item({ codigo: 'B', stockErp: 100, conteos: [98, 97], stockPorRonda: [] }),
      item({ codigo: 'C', stockErp: 50, conteos: [60], stockPorRonda: [50] }),
      item({ codigo: 'D', stockErp: 80, conteos: [70, 70, 75], stockPorRonda: [80, 78, 77] }),
    ];

    const filas = diferenciasParaPersistir(casos);
    expect(filas).toHaveLength(4);
    for (const fila of filas) {
      expect(fila.conteoFinal - fila.stockSistema).toBe(fila.diferencia);
    }
  });

  it('el monto congelado sale de la misma diferencia', () => {
    const recontado = item({ stockErp: 100, precioVenta: 2.5, conteos: [98, 97], stockPorRonda: [100, 99] });
    const [fila] = diferenciasParaPersistir([recontado]);
    expect(fila?.montoDiferencia).toBe(-5);
  });

  it('el item que cuadra contra el stock NUEVO no genera fila', () => {
    // Antes generaba una de S/-30: la vara vieja decia que faltaban 3. Que
    // desaparezca es el cambio, no una perdida de dato.
    const recontado = item({ stockErp: 100, conteos: [98, 97], stockPorRonda: [100, 97] });
    expect(diferenciasParaPersistir([recontado])).toHaveLength(0);
  });
});
