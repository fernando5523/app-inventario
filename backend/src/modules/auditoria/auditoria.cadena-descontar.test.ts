/**
 * EL TOTAL A DESCONTAR POR TIENDA de la tabla de la cadena: `valorADescontar`.
 *
 * Pedido del usuario mirando esa tabla: *"falta el total a descontar del
 * calculo del sobrante y faltante por cada tienda"*. La columna "Al personal"
 * mostraba el faltante BRUTO del cuadro unico -- sin restarle el sobrante que
 * lo compensa -- asi que no era la plata que sale del sueldo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE APARTE DE auditoria.cadena.test.ts
 * ---------------------------------------------------------------------------
 * Lo que se fija aca no es el contrato de la tabla (eso esta en el otro
 * archivo): es que EL NUMERO DE LA TABLA ES EL MISMO QUE VA A SALIR EN LA
 * PLANILLA. La cuenta vive en `historial.calculos.ts#calcularFaltanteNeto`, la
 * que `calcularResumenLiquidacion` usa para sacar `cuotaBase`, y la ultima
 * prueba de este archivo la corre por las DOS vias sobre los MISMOS montos.
 * Si alguien copiara la formula al modulo de auditoria, el resto de los tests
 * seguiria pasando y solo esta se caeria.
 *
 * Los cinco casos de borde que se prueban son los que ya costaron plata en este
 * repo: el sobrante que supera al faltante (que NO se recorta a cero), la
 * tienda sin inventario, el inventario sin resultado, `montoNegativos` en NULL
 * y `montoNegativos` con valor.
 */

import { describe, expect, it } from 'vitest';
import { calcularFaltanteNeto, calcularResumenLiquidacion } from '../historial/historial.calculos';
import {
  filaDeCadena,
  filaDeCadenaSinInventario,
  resumir,
  totalizarCadena,
  type FilaCadena,
  type ItemAuditoria,
} from './auditoria.calculos';

/** El umbral de media caja, el mismo que el resto de los tests de la cadena. */
const UMBRAL = 0.5;

function item(parcial: Partial<ItemAuditoria> & { codigo: string }): ItemAuditoria {
  return {
    productoId: 1,
    descripcion: `Producto ${parcial.codigo}`,
    zona: 'A',
    hoja: '001',
    precioVenta: 10,
    stockErp: 10,
    clase: 'unidad',
    claseForzada: null,
    empaqueCompra: null,
    empaqueCompraSimbolo: null,
    empaqueCompraCorregido: null,
    conteos: [10],
    esEmpresa: false,
    ...parcial,
    // MISMA GUARDA QUE auditoria.calculos.test.ts: `esEmpresa: true` a secas no
    // manda un item al cuadro de empresa -- el reparto mira `clase`. Sin esto,
    // un test podria armar un item imposible (dice que lo absorbe gerencia y
    // cae en el descuento al personal) y afirmar un neto que no existe.
    ...(parcial.esEmpresa === true && parcial.clase === undefined ? { clase: 'empresa' as const } : {}),
  };
}

function fila(items: ItemAuditoria[], montoNegativos: number | null = null): FilaCadena {
  return filaDeCadena(
    { sucursalId: 1, sucursal: 'Market Luzuriaga', inventarioId: 8078, estado: 'ajuste_auditor' },
    resumir(items, UMBRAL),
    montoNegativos,
  );
}

describe('el neto normal: el faltante del cuadro unico menos su sobrante', () => {
  /**
   * LA MATRIZ REAL DE MARKET LUZURIAGA (inventario 8078, periodo 2026-09), la
   * misma que verifica el script por API: 4,50 de faltante y 0,40 de sobrante en
   * el cuadro unico -> 4,10 a descontar.
   */
  const luzuriaga = fila([
    item({ codigo: 'A1', stockErp: 10, conteos: [7], precioVenta: 1.5 }), // faltan 3 -> 4.50
    item({ codigo: 'A2', stockErp: 10, conteos: [11], precioVenta: 0.4 }), // sobra 1 -> 0.40
    item({ codigo: 'A3', stockErp: 5, conteos: [5] }), // cuadra
  ]);

  it('resta el sobrante del faltante: 4,50 - 0,40 = 4,10', () => {
    expect(luzuriaga.porClase.unidad.valorFaltante).toBe(4.5);
    expect(luzuriaga.porClase.unidad.valorSobrante).toBe(0.4);
    expect(luzuriaga.valorADescontar).toBe(4.1);
  });

  /**
   * LA RAZON DE SER DEL CAMPO: "Al personal" es el bruto, y es MAS que lo que
   * se descuenta. Si los dos numeros fueran iguales, el campo no haria falta.
   */
  it('NO es el bruto de "Al personal": ese no resta el sobrante', () => {
    expect(luzuriaga.valorADescontar).toBeLessThan(luzuriaga.porClase.unidad.valorFaltante);
  });

  /** Ni el faltante de empresa ni el de paquetes salen del sueldo. */
  it('no toca el faltante de empresa ni el de paquetes', () => {
    const conEmpresaYPaquete = fila([
      item({ codigo: 'B1', stockErp: 10, conteos: [8], precioVenta: 3 }), // unidad: faltan 2 -> 6
      item({ codigo: 'B2', stockErp: 10, conteos: [4], precioVenta: 2, esEmpresa: true }), // empresa -> 12
      // 6 faltantes con empaque 6: una caja entera se va al cuadro de paquetes.
      item({ codigo: 'B3', stockErp: 10, conteos: [4], precioVenta: 5, empaqueCompra: 6 }),
    ]);
    expect(conEmpresaYPaquete.porClase.empresa.valorFaltante).toBe(12);
    expect(conEmpresaYPaquete.porClase.paquete.valorFaltante).toBe(30);
    // Solo el cuadro unico: 6 de faltante, 0 de sobrante.
    expect(conEmpresaYPaquete.valorADescontar).toBe(6);
  });

  /**
   * RESTAR DECIMALES DESVIA igual que sumarlos (4.5 - 0.4 da 4.1000000000000005
   * en punto flotante). El JSON no puede llevar esa cola: la tabla mostraria
   * "S/ 4,1000000000000005" o, peor, la planilla no cerraria al centavo.
   */
  it('no arrastra la cola del punto flotante', () => {
    expect(String(luzuriaga.valorADescontar)).toBe('4.1');
    expect(luzuriaga.valorADescontar).toBe(Number(luzuriaga.valorADescontar.toFixed(2)));
  });
});

describe('el sobrante que supera al faltante: NEGATIVO, sin recortar', () => {
  /**
   * DECISION EXPLICITA DEL CLIENTE, ya documentada en
   * `ResumenLiquidacion.montoFaltanteNeto`: *"si los sobrantes y negativos
   * superan al faltante, el neto se muestra negativo tal cual da"* (Gilmer:
   * *"faltantes menos sobrantes y negativos"*, y *"si sobra, ira a su favor"*).
   *
   * Un `Math.max(0, ...)` puesto de buena fe aca romperia la planilla: la
   * compensacion a favor del personal desapareceria de la tabla, y el Auditor
   * veria 0 donde Liquidacion va a mostrar un numero negativo.
   */
  const sobroMas = fila([
    item({ codigo: 'C1', stockErp: 10, conteos: [9], precioVenta: 2 }), // falta 1 -> 2
    item({ codigo: 'C2', stockErp: 10, conteos: [15], precioVenta: 2 }), // sobran 5 -> 10
  ]);

  it('devuelve el neto negativo tal cual da', () => {
    expect(sobroMas.porClase.unidad.valorFaltante).toBe(2);
    expect(sobroMas.porClase.unidad.valorSobrante).toBe(10);
    expect(sobroMas.valorADescontar).toBe(-8);
  });

  it('y no un 0 ni el valor absoluto', () => {
    expect(sobroMas.valorADescontar).not.toBe(0);
    expect(sobroMas.valorADescontar).toBeLessThan(0);
  });

  /**
   * ES LO CONTRARIO DE `pagaLaEmpresa` (mobile/lib/dominio/auditoria.ts), que SI
   * recorta a cero -- nadie paga una cantidad negativa. Al personal si se le
   * puede descontar de menos, asi que aca el recorte seria una mentira.
   */
  it('el negativo sobrevive al total de la cadena', () => {
    const total = totalizarCadena([sobroMas]);
    expect(total.valorADescontar).toBe(-8);
  });
});

describe('las tiendas y los inventarios sin dato', () => {
  it('una tienda sin inventario del periodo va en 0, como el resto de los contadores', () => {
    const sinInventario = filaDeCadenaSinInventario(26, 'Market Carhuaz');
    expect(sinInventario.valorADescontar).toBe(0);
    // Y el 0 no se lee como cifra: la pantalla mira `inventarioId`.
    expect(sinInventario.inventarioId).toBeNull();
  });

  /**
   * UN INVENTARIO EN `ajuste_auditor` NO TIENE `ResultadoInventario` TODAVIA --
   * se crea al cerrar el conteo -- asi que este es el caso NORMAL de esta
   * tabla, no el raro. El neto es el de ANTES de los ajustes del mes, y va a
   * bajar cuando se importe el Excel de Dynamics.
   */
  it('un inventario sin resultado: el neto es el de antes de los ajustes del mes', () => {
    const sinResultado = fila([item({ codigo: 'D1', stockErp: 10, conteos: [6], precioVenta: 10 })], null);
    expect(sinResultado.estado).toBe('ajuste_auditor');
    expect(sinResultado.valorADescontar).toBe(40);
  });

  /**
   * `montoNegativos` EN NULL NO ES UN 0 EN ESTE REPO: NULL significa "nadie
   * importo el Excel" y bloquea la liquidacion con 409; un 0 explicito
   * significa "se importo y no habia ajustes" y la destraba (ver el encabezado
   * de liquidacion.ajustes.ts). La RESTA los trata igual, y eso es lo que se
   * fija aca -- la distincion la mantiene el tipo, no la aritmetica.
   */
  it('montoNegativos NULL da el mismo neto que un 0 explicito', () => {
    const items = [item({ codigo: 'E1', stockErp: 10, conteos: [6], precioVenta: 10 })];
    expect(fila(items, null).valorADescontar).toBe(fila(items, 0).valorADescontar);
    expect(fila(items, null).valorADescontar).toBe(40);
  });

  it('montoNegativos con valor SE RESTA: es plata que no sale del sueldo', () => {
    const items = [item({ codigo: 'F1', stockErp: 10, conteos: [6], precioVenta: 10 })];
    // 40 de faltante en el cuadro unico, 12,50 de mermas documentadas -> 27,50.
    expect(fila(items, 12.5).valorADescontar).toBe(27.5);
  });

  /**
   * Y PUEDE EMPUJAR EL NETO BAJO CERO por su cuenta, sin que haya sobrante: los
   * ajustes del mes son a favor del personal igual que el sobrante.
   */
  it('unos negativos mas grandes que el faltante dejan el neto negativo', () => {
    const items = [item({ codigo: 'G1', stockErp: 10, conteos: [9], precioVenta: 10 })];
    expect(fila(items, 30).valorADescontar).toBe(-20);
  });
});

describe('el total de la cadena es la suma de las filas', () => {
  const luzuriaga = filaDeCadena(
    { sucursalId: 1, sucursal: 'Market Luzuriaga', inventarioId: 8078, estado: 'ajuste_auditor' },
    resumir([item({ codigo: 'A1', stockErp: 10, conteos: [7], precioVenta: 1.5 })], UMBRAL),
    null,
  );
  const carhuaz = filaDeCadena(
    { sucursalId: 2, sucursal: 'Market Carhuaz', inventarioId: 8079, estado: 'liquidado' },
    resumir([item({ codigo: 'B1', stockErp: 20, conteos: [25], precioVenta: 2.5 })], UMBRAL),
    3.2, // esta tienda si cargo sus ajustes del mes
  );
  const sucre = filaDeCadenaSinInventario(3, 'Market Sucre');
  const total = totalizarCadena([luzuriaga, carhuaz, sucre]);

  it('suma los netos de cada tienda, negativos incluidos', () => {
    expect(luzuriaga.valorADescontar).toBe(4.5); // 3 x 1.50, sin sobrante ni ajustes
    expect(carhuaz.valorADescontar).toBe(-15.7); // 0 - 12.50 de sobrante - 3.20 de ajustes
    expect(total.valorADescontar).toBe(luzuriaga.valorADescontar + carhuaz.valorADescontar);
    expect(total.valorADescontar).toBe(-11.2);
  });

  /**
   * NO SE RECALCULA SOBRE LOS CUADROS DEL TOTAL, y esta tienda es la prueba de
   * por que: Carhuaz resta 3,20 de ajustes que no viven en ningun cuadro. Una
   * cuenta sobre `total.porClase.unidad` se los perderia y diria -8, no -11,20.
   */
  it('y no se recalcula sobre el cuadro unico del total: perderia los ajustes del mes', () => {
    const netoDelCuadroSumado = total.porClase.unidad.valorFaltante - total.porClase.unidad.valorSobrante;
    expect(netoDelCuadroSumado).toBe(-8);
    expect(total.valorADescontar).not.toBe(netoDelCuadroSumado);
  });

  it('una tienda sin inventario no lo mueve', () => {
    expect(totalizarCadena([luzuriaga, carhuaz]).valorADescontar).toBe(total.valorADescontar);
  });

  it('no arrastra la cola del punto flotante al sumar', () => {
    const a = filaDeCadena(
      { sucursalId: 1, sucursal: 'A', inventarioId: 1, estado: 'ajuste_auditor' },
      resumir([item({ codigo: 'X', stockErp: 100, conteos: [43], precioVenta: 2.79 })], UMBRAL),
      null,
    );
    const b = filaDeCadena(
      { sucursalId: 2, sucursal: 'B', inventarioId: 2, estado: 'ajuste_auditor' },
      resumir([item({ codigo: 'Y', stockErp: 100, conteos: [89], precioVenta: 1.61 })], UMBRAL),
      null,
    );
    const t = totalizarCadena([a, b]);
    expect(t.valorADescontar).toBe(Number(t.valorADescontar.toFixed(2)));
    expect(String(t.valorADescontar)).not.toMatch(/\d{5,}$/);
  });
});

/**
 * ---------------------------------------------------------------------------
 * LA INVARIANTE QUE JUSTIFICA TODO EL CAMBIO
 * ---------------------------------------------------------------------------
 * EL NUMERO DE LA TABLA ES EL QUE VA A SALIR EN LA PLANILLA. Se corre la cuenta
 * por las dos vias sobre los MISMOS montos de la misma matriz:
 *
 *   via tabla       -> `filaDeCadena(...).valorADescontar`
 *   via liquidacion -> `calcularResumenLiquidacion(...).montoFaltanteNeto`
 *
 * La equivalencia monto por monto, verificada contra `resumir` y
 * `liquidacion.reclasificacion.ts#reclasificarAlLiquidar`:
 *
 *   montoFaltanteBruto    = resumen.valorFaltante
 *   montoFaltanteEmpresa  = resumen.porClase.empresa.valorFaltante
 *   montoFaltantePaquete  = resumen.porClase.paquete.valorFaltante
 *   montoSobranteEmpleado = resumen.porClase.unidad.valorSobrante
 *
 * Esta prueba es la unica que se cae si alguien copia la formula del neto al
 * modulo de auditoria en vez de llamar a la de historial.
 */
describe('la equivalencia con la liquidacion, sobre la misma matriz', () => {
  /** Una matriz con las tres clases, faltante y sobrante en cada una. */
  const matriz = [
    // Cuadro unico: faltan 3 a 1,50 (4,50) y sobra 1 a 0,40.
    item({ codigo: 'A1', stockErp: 10, conteos: [7], precioVenta: 1.5 }),
    item({ codigo: 'A2', stockErp: 10, conteos: [11], precioVenta: 0.4 }),
    // Empresa: faltan 6 a 2 (12) y sobran 2 a 2 (4).
    item({ codigo: 'B1', stockErp: 10, conteos: [4], precioVenta: 2, esEmpresa: true }),
    item({ codigo: 'B2', stockErp: 10, conteos: [12], precioVenta: 2, esEmpresa: true }),
    // Paquetes: faltan 6 con empaque 6 -> una caja entera al cuadro de paquetes.
    item({ codigo: 'C1', stockErp: 10, conteos: [4], precioVenta: 5, empaqueCompra: 6 }),
    // Y uno que cuadra, para que la matriz no sea solo diferencias.
    item({ codigo: 'D1', stockErp: 8, conteos: [8] }),
  ];
  const resumen = resumir(matriz, UMBRAL);

  /** Los mismos montos, armados una sola vez, como los lee la liquidacion. */
  const montos = {
    montoFaltanteBruto: resumen.valorFaltante,
    montoFaltanteEmpresa: resumen.porClase.empresa.valorFaltante,
    montoFaltantePaquete: resumen.porClase.paquete.valorFaltante,
    montoSobranteEmpleado: resumen.porClase.unidad.valorSobrante,
  };

  it('sin ajustes del mes, las dos vias dan el mismo centavo', () => {
    const porLaTabla = filaDeCadena(
      { sucursalId: 1, sucursal: 'Market Luzuriaga', inventarioId: 8078, estado: 'ajuste_auditor' },
      resumen,
      null,
    );
    const porLaLiquidacion = calcularResumenLiquidacion({
      ...montos,
      montoNegativos: 0,
      colaboradoresAlcanzados: 11,
      colaboradoresAsistieron: 9,
      multaInasistencia: 20,
    });
    expect(porLaTabla.valorADescontar).toBe(porLaLiquidacion.montoFaltanteNeto);
  });

  it('con ajustes del mes tambien: los dos restan el mismo monto', () => {
    const negativos = 1.75;
    const porLaTabla = filaDeCadena(
      { sucursalId: 1, sucursal: 'Market Luzuriaga', inventarioId: 8078, estado: 'liquidado' },
      resumen,
      negativos,
    );
    const porLaLiquidacion = calcularResumenLiquidacion({
      ...montos,
      montoNegativos: negativos,
      colaboradoresAlcanzados: 11,
      colaboradoresAsistieron: 9,
      multaInasistencia: 20,
    });
    expect(porLaTabla.valorADescontar).toBe(porLaLiquidacion.montoFaltanteNeto);
  });

  /**
   * Y EL NETO SE REDUCE A `unidad.valorFaltante - unidad.valorSobrante` cuando
   * no hay negativos -- porque los tres cuadros suman el faltante total. Es la
   * forma corta que se puede verificar con la calculadora contra la tabla; que
   * coincida con la formula de cinco terminos es lo que hace auditable la cifra.
   */
  it('y equivale a la forma corta: faltante del cuadro unico menos su sobrante', () => {
    expect(resumen.porClase.unidad.valorFaltante + montos.montoFaltanteEmpresa + montos.montoFaltantePaquete).toBe(
      montos.montoFaltanteBruto,
    );
    expect(calcularFaltanteNeto({ ...montos, montoNegativos: 0 })).toBe(
      resumen.porClase.unidad.valorFaltante - resumen.porClase.unidad.valorSobrante,
    );
  });
});
