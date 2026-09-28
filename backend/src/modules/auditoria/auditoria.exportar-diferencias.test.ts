/**
 * EL CONTRATO DEL .XLSX DE DIFERENCIAS DE LA CADENA, sin base de datos: el
 * detalle por producto que respalda la tabla de tiendas del panel de auditoria.
 *
 * Lo que se fija acá es lo que el Auditor va a creer cuando abra el archivo:
 *
 *   1. EL CUADRO DE CADA FILA ES EL DEL PANEL, y sale de la MISMA decision que
 *      la planilla de Gilmer. Se prueba cruzado: las filas del detalle contra los
 *      seis grupos de `cuadrosParaExportar` sobre la MISMA matriz. Si alguien
 *      escribe una segunda regla de reparto, esto falla.
 *   2. LA SUMA DE `Monto` POR CUADRO ES LA COLUMNA DE LA TABLA. Es el requisito
 *      del usuario -- *"asi puede sacar sus calculos"*: un archivo que no cierra
 *      contra la pantalla no respalda la tabla, la contradice.
 *   3. `Diferencia` Y `Monto` VAN CON SIGNO. Una tabla dinamica que suma una
 *      columna de magnitudes da un total que no existe.
 *   4. SIN PRECIO, CELDA VACIA -- NUNCA 0. Un item sin precio no vale 0, no se
 *      sabe cuanto vale.
 *   5. EL EMPAQUE DEL ERP VA VERBATIM, y un numero corregido dice que lo puso el
 *      Auditor.
 *
 * Todo esto es puro: `detalleDeDiferencias` recorre una matriz en memoria y
 * `armarLibroDiferenciasCadena` no toca Prisma. Lo que necesita base -- que las
 * diez tiendas entren en una sola hoja, que una sin inventario no aporte filas,
 * que un anulado quede afuera -- vive en auditoria.exportar-diferencias.service.test.ts.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { redondear } from '../historial/historial.calculos';
import {
  cuadrosParaExportar,
  detalleDeDiferencias,
  resumir,
  type ItemAuditoria,
} from './auditoria.calculos';
import {
  armarLibroDiferenciasCadena,
  ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA,
  nombreArchivoDiferenciasCadena,
  textoDeEmpaque,
  type FilaExportDiferenciaCadena,
} from './auditoria.exportar-diferencias';

/** El umbral congelado del inventario 8078 de la base de desarrollo. */
const UMBRAL = 0.5;

/**
 * Base minima, MISMA forma que el helper de auditoria.calculos.test.ts,
 * incluida la invariante `esEmpresa === (clase === 'empresa')`: asi ningun test
 * puede armar un item imposible -- uno que diga "lo absorbe la empresa" y a la
 * vez caiga en el cuadro del descuento al personal.
 */
const item = (parcial: Partial<ItemAuditoria> = {}): ItemAuditoria => ({
  productoId: 1,
  codigo: 'IT-0001',
  descripcion: 'Aceite Vegetal Primor 900ml',
  zona: 'ABARROTES',
  hoja: '003',
  precioVenta: 10,
  stockErp: 100,
  conteos: [100],
  esEmpresa: false,
  clase: 'unidad',
  claseForzada: null,
  empaqueCompra: null,
  empaqueCompraSimbolo: null,
  empaqueCompraCorregido: null,
  ...parcial,
  ...(parcial.esEmpresa === true && parcial.clase === undefined ? { clase: 'empresa' as const } : {}),
});

/** Las cuatro columnas que pone el service, para poder armar el libro sin base. */
function conTienda(
  filas: ReturnType<typeof detalleDeDiferencias>,
  sucursal = 'Market Luzuriaga',
): FilaExportDiferenciaCadena[] {
  return filas.map((f) => ({ ...f, sucursal, periodoAnio: 2026, periodoMes: 9, inventarioId: 8078 }));
}

async function leer(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const libro = new ExcelJS.Workbook();
  // `as any`: exceljs declara su PROPIO `Buffer` de respaldo dentro de su modulo
  // para poder compilar sin @types/node, y ese shim nunca matchea a un Buffer
  // real de Node. Es una incompatibilidad de TIPOS entre paquetes, no del dato
  // (ver el mismo comentario en historial.exportar.test.ts).
  await libro.xlsx.load(buffer as any);
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El libro no tiene ninguna hoja.');
  return hoja;
}

/** Una columna del archivo, por su nombre de encabezado. */
function columna(hoja: ExcelJS.Worksheet, encabezado: (typeof ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA)[number]): unknown[] {
  const indice = ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA.indexOf(encabezado) + 1;
  const valores: unknown[] = [];
  for (let n = 2; n <= hoja.rowCount; n++) valores.push(hoja.getRow(n).getCell(indice).value);
  return valores;
}

// ---------------------------------------------------------------------------
// EL CUADRO DE CADA FILA
// ---------------------------------------------------------------------------

describe('a que cuadro va cada fila', () => {
  /**
   * Los seis baldes, mas el caso que fue un bug real: un item de clase
   * `paquete` cuya razon NO supera el umbral cae en el cuadro DEL PERSONAL, no
   * en el de paquetes (ver `cuadroDeLaDiferencia`).
   */
  const matriz = [
    item({ codigo: 'A-UNI-F', stockErp: 10, conteos: [7] }), // -3 al personal
    item({ codigo: 'B-UNI-S', stockErp: 10, conteos: [14] }), // +4 al personal
    // Empaque 6 y faltan 5: razon 0.83 > 0.5 -> sale del descuento al personal.
    item({ codigo: 'C-PAQ-F', stockErp: 20, conteos: [15], clase: 'paquete', empaqueCompra: 6 }),
    item({ codigo: 'D-PAQ-S', stockErp: 20, conteos: [25], clase: 'paquete', empaqueCompra: 6 }),
    item({ codigo: 'E-EMP-F', stockErp: 30, conteos: [28], esEmpresa: true }),
    item({ codigo: 'F-EMP-S', stockErp: 30, conteos: [33], esEmpresa: true }),
    // Empaque 6 y faltan 2: razon 0.33 <= 0.5 -> se queda con el personal
    // AUNQUE su clase sea `paquete`. Es el bug de 2026-09-19.
    item({ codigo: 'G-PAQ-CHICO', stockErp: 20, conteos: [18], clase: 'paquete', empaqueCompra: 6 }),
  ];
  const filas = detalleDeDiferencias(matriz, UMBRAL);
  const cuadroDe = (codigo: string) => filas.find((f) => f.codigo === codigo);

  it('el faltante y el sobrante de un item de unidad van al cuadro del personal', () => {
    expect(cuadroDe('A-UNI-F')).toMatchObject({ cuadro: 'unidad', tipo: 'faltante' });
    expect(cuadroDe('B-UNI-S')).toMatchObject({ cuadro: 'unidad', tipo: 'sobrante' });
  });

  it('los que completan mas de media caja van al cuadro de paquete', () => {
    expect(cuadroDe('C-PAQ-F')).toMatchObject({ cuadro: 'paquete', tipo: 'faltante' });
    expect(cuadroDe('D-PAQ-S')).toMatchObject({ cuadro: 'paquete', tipo: 'sobrante' });
  });

  it('los de empresa van al cuadro de empresa, falten o sobren', () => {
    expect(cuadroDe('E-EMP-F')).toMatchObject({ cuadro: 'empresa', tipo: 'faltante' });
    expect(cuadroDe('F-EMP-S')).toMatchObject({ cuadro: 'empresa', tipo: 'sobrante' });
  });

  /**
   * LA CLASE NO ES EL CUADRO. Este item es de clase `paquete` y su fila dice
   * `unidad`, porque sus unidades cayeron en el descuento al personal. Agrupar
   * por la clase -- que es la implementacion "obvia" -- hacia que el Excel
   * repartiera distinto que el panel sobre los mismos items.
   */
  it('un item de clase paquete que no llega al umbral va al cuadro del personal', () => {
    expect(cuadroDe('G-PAQ-CHICO')).toMatchObject({ cuadro: 'unidad', tipo: 'faltante' });
  });

  /**
   * EL CRUCE QUE IMPIDE QUE LOS DOS EXPORTS DIVERJAN: el detalle de la cadena y
   * la planilla de Gilmer reparten los MISMOS items en los MISMOS grupos, porque
   * los dos preguntan a `cuadroDeLaDiferencia`. Si alguien escribiera una
   * segunda regla en cualquiera de los dos lados, este test falla.
   */
  it('reparte EXACTAMENTE igual que cuadrosParaExportar sobre la misma matriz', () => {
    const cuadros = cuadrosParaExportar(matriz, UMBRAL);
    const codigosDe = (cuadro: 'unidad' | 'paquete' | 'empresa', tipo: 'faltante' | 'sobrante') =>
      filas.filter((f) => f.cuadro === cuadro && f.tipo === tipo).map((f) => f.codigo);

    expect(codigosDe('unidad', 'faltante')).toEqual(cuadros.faltantesUnicos.map((f) => f.codigo));
    expect(codigosDe('unidad', 'sobrante')).toEqual(cuadros.sobrantesUnicos.map((f) => f.codigo));
    expect(codigosDe('paquete', 'faltante')).toEqual(cuadros.faltantesPaquete.map((f) => f.codigo));
    expect(codigosDe('paquete', 'sobrante')).toEqual(cuadros.sobrantesPaquete.map((f) => f.codigo));
    expect(codigosDe('empresa', 'faltante')).toEqual(cuadros.empresaFaltantes.map((f) => f.codigo));
    expect(codigosDe('empresa', 'sobrante')).toEqual(cuadros.empresaSobrantes.map((f) => f.codigo));
  });

  it('y ningun item aparece dos veces: un item, un cuadro', () => {
    expect(filas).toHaveLength(matriz.length);
    expect(new Set(filas.map((f) => f.codigo)).size).toBe(filas.length);
  });
});

// ---------------------------------------------------------------------------
// LA INVARIANTE QUE HACE UTIL AL ARCHIVO
// ---------------------------------------------------------------------------

/**
 * *"asi puede sacar sus calculos"*: el Auditor va a filtrar por cuadro y sumar
 * la columna `Monto`. Ese total tiene que ser el mismo que la tabla de tiendas
 * muestra en esa columna, que es `resumir(...).porClase.X.valorFaltante`.
 *
 * Los cuadros de `resumir` llevan la plata SIEMPRE EN POSITIVO (es lo que se
 * muestra); el archivo la lleva con signo. Por eso la comparacion invierte el
 * signo del faltante, y no porque un numero este mal.
 *
 * Se redondea la suma antes de comparar porque `resumir` redondea UNA vez al
 * final de cada cuadro y acá se suman montos ya redondeados por fila -- sumar
 * decimales de punto flotante desvia (161.7 + 88 da 249.70000000000002).
 */
describe('la suma de Monto por cuadro es la columna de la tabla de tiendas', () => {
  const matriz = [
    item({ codigo: 'A1', stockErp: 10, conteos: [7], precioVenta: 2.79 }),
    item({ codigo: 'A2', stockErp: 10, conteos: [14], precioVenta: 1.61 }),
    item({ codigo: 'B1', stockErp: 20, conteos: [15], clase: 'paquete', empaqueCompra: 6, precioVenta: 3.5 }),
    item({ codigo: 'B2', stockErp: 20, conteos: [26], clase: 'paquete', empaqueCompra: 6, precioVenta: 7.9 }),
    item({ codigo: 'C1', stockErp: 30, conteos: [28], esEmpresa: true, precioVenta: 12.4 }),
    item({ codigo: 'C2', stockErp: 30, conteos: [35], esEmpresa: true, precioVenta: 0.9 }),
    item({ codigo: 'D1', stockErp: 5, conteos: [5] }), // cuadra: no aporta fila
  ];
  const filas = detalleDeDiferencias(matriz, UMBRAL);
  const r = resumir(matriz, UMBRAL);

  const sumar = (cuadro: 'unidad' | 'paquete' | 'empresa', tipo: 'faltante' | 'sobrante') =>
    redondear(filas.filter((f) => f.cuadro === cuadro && f.tipo === tipo).reduce((t, f) => t + (f.monto ?? 0), 0));

  it('Al personal / Faltante == porClase.unidad.valorFaltante', () => {
    expect(-sumar('unidad', 'faltante')).toBe(r.porClase.unidad.valorFaltante);
  });

  it('Al personal / Sobrante == porClase.unidad.valorSobrante', () => {
    expect(sumar('unidad', 'sobrante')).toBe(r.porClase.unidad.valorSobrante);
  });

  it('Por paquete, los dos lados', () => {
    expect(-sumar('paquete', 'faltante')).toBe(r.porClase.paquete.valorFaltante);
    expect(sumar('paquete', 'sobrante')).toBe(r.porClase.paquete.valorSobrante);
  });

  it('Empresa, los dos lados', () => {
    expect(-sumar('empresa', 'faltante')).toBe(r.porClase.empresa.valorFaltante);
    expect(sumar('empresa', 'sobrante')).toBe(r.porClase.empresa.valorSobrante);
  });

  it('y los tres cuadros juntos dan el faltante y el sobrante totales de la tienda', () => {
    const faltante = -redondear(filas.filter((f) => f.tipo === 'faltante').reduce((t, f) => t + (f.monto ?? 0), 0));
    const sobrante = redondear(filas.filter((f) => f.tipo === 'sobrante').reduce((t, f) => t + (f.monto ?? 0), 0));
    expect(faltante).toBe(r.valorFaltante);
    expect(sobrante).toBe(r.valorSobrante);
  });
});

// ---------------------------------------------------------------------------
// QUE FILAS ENTRAN Y QUE FILAS NO
// ---------------------------------------------------------------------------

describe('que items aportan fila', () => {
  it('un item que cuadro NO aporta fila: no hay diferencia que reportar', () => {
    expect(detalleDeDiferencias([item({ stockErp: 10, conteos: [10] })], UMBRAL)).toEqual([]);
  });

  /**
   * EL ITEM SIN STOCK DEL ERP NO APORTA FILA, y no es lo mismo que aportar una
   * fila con diferencia 0: no se puede afirmar NADA de el. Es la regla de
   * cabecera de auditoria.calculos.ts -- la que impide que 11.835 productos sin
   * stock cargado se reporten como un inventario perfecto -- vista por esta via.
   */
  it('un item SIN stock del ERP no aporta fila, aunque lo hayan contado', () => {
    expect(detalleDeDiferencias([item({ stockErp: null, conteos: [42] })], UMBRAL)).toEqual([]);
  });

  it('un item que nadie conto tampoco: falta el otro lado', () => {
    expect(detalleDeDiferencias([item({ stockErp: 10, conteos: [] })], UMBRAL)).toEqual([]);
  });

  it('las filas salen ordenadas por codigo, venga la matriz como venga', () => {
    const filas = detalleDeDiferencias(
      [
        item({ codigo: 'Z-9', stockErp: 10, conteos: [8] }),
        item({ codigo: 'A-1', stockErp: 10, conteos: [8] }),
        item({ codigo: 'M-5', stockErp: 10, conteos: [8] }),
      ],
      UMBRAL,
    );
    expect(filas.map((f) => f.codigo)).toEqual(['A-1', 'M-5', 'Z-9']);
  });
});

// ---------------------------------------------------------------------------
// EL SIGNO, EL PRECIO Y LAS COLUMNAS DE CONTEXTO
// ---------------------------------------------------------------------------

describe('el signo y los numeros de cada fila', () => {
  it('un faltante lleva diferencia Y monto NEGATIVOS', () => {
    const [fila] = detalleDeDiferencias([item({ stockErp: 10, conteos: [7], precioVenta: 10 })], UMBRAL);
    expect(fila).toMatchObject({ tipo: 'faltante', diferencia: -3, monto: -30, stockErp: 10, conteoFinal: 7 });
  });

  it('un sobrante los lleva POSITIVOS', () => {
    const [fila] = detalleDeDiferencias([item({ stockErp: 10, conteos: [14], precioVenta: 10 })], UMBRAL);
    expect(fila).toMatchObject({ tipo: 'sobrante', diferencia: 4, monto: 40 });
  });

  it('el conteo que manda es el ULTIMO, no el primero', () => {
    const [fila] = detalleDeDiferencias([item({ stockErp: 10, conteos: [9, null, 6] })], UMBRAL);
    expect(fila).toMatchObject({ conteoFinal: 6, diferencia: -4 });
  });

  /**
   * SIN PRECIO, `null` -- NO 0. Un item sin precio no vale 0: no se sabe cuanto
   * vale. Es la regla que ya sostiene `diferenciaValor`, y acá decide si la
   * celda del .xlsx queda vacia o miente con un cero que se sumaria.
   */
  it('un item SIN precio aporta fila, con precio y monto en null', () => {
    const [fila] = detalleDeDiferencias([item({ stockErp: 10, conteos: [7], precioVenta: null })], UMBRAL);
    expect(fila).toMatchObject({ diferencia: -3, precioUnitario: null, monto: null });
    expect(fila?.monto).not.toBe(0);
  });

  it('la zona y la hoja viajan tal cual, y vacias cuando ninguna hoja finalizada lo incluye', () => {
    const [conHoja] = detalleDeDiferencias([item({ stockErp: 10, conteos: [7] })], UMBRAL);
    expect(conHoja).toMatchObject({ zona: 'ABARROTES', hoja: '003' });
    const [sinHoja] = detalleDeDiferencias([item({ stockErp: 10, conteos: [7], zona: '', hoja: '' })], UMBRAL);
    expect(sinHoja).toMatchObject({ zona: '', hoja: '' });
  });
});

// ---------------------------------------------------------------------------
// EL EMPAQUE: VERBATIM, Y LA CORRECCION DICE QUE ES DEL AUDITOR
// ---------------------------------------------------------------------------

describe('la columna Empaque', () => {
  const filaDe = (parcial: Partial<ItemAuditoria>) =>
    detalleDeDiferencias([item({ stockErp: 20, conteos: [15], ...parcial })], UMBRAL)[0]!;

  it('el simbolo del ERP va TAL CUAL, sin traducir a caja ni a display', () => {
    const fila = filaDe({ empaqueCompra: 6, empaqueCompraSimbolo: 'Emp.6', clase: 'paquete' });
    expect(textoDeEmpaque(fila)).toBe('Emp.6');
  });

  /**
   * LA CORRECCION DEL AUDITOR SE DISTINGUE DE LO QUE DIJO DYNAMICS. No se
   * escribe "Emp.12": ese simbolo no existe en el ERP y quien buscara el
   * producto por el no lo encontraria. Se escribe el del ERP y al lado, quien
   * cambio el numero (ver el comentario de `textoDeEmpaque`).
   */
  it('con el empaque corregido, la celda dice el del ERP Y que el auditor lo cambio', () => {
    const fila = filaDe({
      empaqueCompra: 1,
      empaqueCompraSimbolo: 'Emp.1',
      empaqueCompraCorregido: 12,
      clase: 'unidad',
    });
    expect(textoDeEmpaque(fila)).toBe('Emp.1 (corregido por el auditor a 12)');
    expect(fila.empaqueUsado).toBe(12);
    expect(fila.empaqueEsCorregido).toBe(true);
  });

  /**
   * Corregir a 6 un item que el ERP YA traia en 6 no cambio nada, asi que la
   * celda no tiene por que decir que cambio algo -- misma regla que
   * `atribucionDelItem.empaqueEsCorregido`, que compara contra el snapshot y no
   * contra "hay correccion".
   */
  it('una correccion que no cambia el numero no ensucia la celda', () => {
    const fila = filaDe({
      empaqueCompra: 6,
      empaqueCompraSimbolo: 'Emp.6',
      empaqueCompraCorregido: 6,
      clase: 'paquete',
    });
    expect(fila.empaqueEsCorregido).toBe(false);
    expect(textoDeEmpaque(fila)).toBe('Emp.6');
  });

  it('sin simbolo del ERP la celda queda vacia: no se inventa uno', () => {
    expect(textoDeEmpaque(filaDe({}))).toBeNull();
  });

  it('sin simbolo pero con correccion, dice lo unico que se sabe', () => {
    const fila = filaDe({ empaqueCompra: null, empaqueCompraSimbolo: null, empaqueCompraCorregido: 12 });
    expect(textoDeEmpaque(fila)).toBe('Corregido por el auditor a 12');
  });
});

// ---------------------------------------------------------------------------
// EL LIBRO: TABLA PLANA, UNA HOJA
// ---------------------------------------------------------------------------

describe('armarLibroDiferenciasCadena: tabla plana, una hoja llamada Diferencias', () => {
  const unaFila = detalleDeDiferencias([item({ stockErp: 10, conteos: [7], empaqueCompraSimbolo: 'Emp.6' })], UMBRAL);

  it('la hoja se llama Diferencias y es la unica', async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await armarLibroDiferenciasCadena(conTienda(unaFila))) as any);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Diferencias']);
  });

  it('la fila 1 es EXACTAMENTE el encabezado pedido, sin nada arriba', async () => {
    const hoja = await leer(await armarLibroDiferenciasCadena(conTienda(unaFila)));
    expect((hoja.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Sucursal',
      'Año',
      'Mes',
      'Inventario',
      'Código',
      'Descripción',
      'Zona',
      'Hoja',
      'Empaque',
      'Cuadro',
      'Tipo',
      'Stock ERP',
      'Conteo final',
      'Diferencia',
      'Precio unitario',
      'Monto',
    ]);
    // Y la constante que usa el codigo es esa misma lista: si un dia se agrega
    // una columna, este test dice que hay que tocar las dos cosas.
    expect((hoja.getRow(1).values as unknown[]).slice(1)).toEqual([...ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA]);
  });

  it('una fila por producto, ni una de mas: nada de titulos ni filas en blanco', async () => {
    const filas = detalleDeDiferencias(
      [
        item({ codigo: 'A1', stockErp: 10, conteos: [7] }),
        item({ codigo: 'A2', stockErp: 10, conteos: [14] }),
        item({ codigo: 'A3', stockErp: 10, conteos: [10] }), // cuadra: no aporta
      ],
      UMBRAL,
    );
    const hoja = await leer(await armarLibroDiferenciasCadena(conTienda(filas)));
    expect(hoja.rowCount).toBe(3); // encabezado + 2
  });

  it('cero filas NO es error: el archivo sale con solo el encabezado', async () => {
    const hoja = await leer(await armarLibroDiferenciasCadena([]));
    expect(hoja.rowCount).toBe(1);
  });

  /**
   * NUMERO COMO NUMERO. Un string en estas celdas queda alineado a la izquierda
   * y fuera de cualquier SUMA de una tabla dinamica -- que es lo unico que este
   * archivo existe para permitir.
   */
  it('año, mes, inventario, stock, conteo, diferencia, precio y monto entran como NUMERO', async () => {
    const hoja = await leer(await armarLibroDiferenciasCadena(conTienda(unaFila)));
    for (const encabezado of [
      'Año',
      'Mes',
      'Inventario',
      'Stock ERP',
      'Conteo final',
      'Diferencia',
      'Precio unitario',
      'Monto',
    ] as const) {
      expect(typeof columna(hoja, encabezado)[0]).toBe('number');
    }
  });

  it('las etiquetas de Cuadro y Tipo son las que el Auditor lee en el panel', async () => {
    const filas = detalleDeDiferencias(
      [
        item({ codigo: 'A1', stockErp: 10, conteos: [7] }),
        item({ codigo: 'B1', stockErp: 20, conteos: [26], clase: 'paquete', empaqueCompra: 6 }),
        item({ codigo: 'C1', stockErp: 30, conteos: [28], esEmpresa: true }),
      ],
      UMBRAL,
    );
    const hoja = await leer(await armarLibroDiferenciasCadena(conTienda(filas)));
    expect(columna(hoja, 'Cuadro')).toEqual(['Al personal', 'Por paquete', 'Empresa']);
    expect(columna(hoja, 'Tipo')).toEqual(['Faltante', 'Sobrante', 'Faltante']);
  });

  it('el faltante llega al .xlsx con el signo puesto', async () => {
    const hoja = await leer(await armarLibroDiferenciasCadena(conTienda(unaFila)));
    expect(columna(hoja, 'Diferencia')).toEqual([-3]);
    expect(columna(hoja, 'Monto')).toEqual([-30]);
  });

  it('sin precio, las dos celdas quedan VACIAS -- no en 0', async () => {
    const filas = detalleDeDiferencias([item({ stockErp: 10, conteos: [7], precioVenta: null })], UMBRAL);
    const hoja = await leer(await armarLibroDiferenciasCadena(conTienda(filas)));
    expect(columna(hoja, 'Precio unitario')).toEqual([null]);
    expect(columna(hoja, 'Monto')).toEqual([null]);
  });
});

describe('nombreArchivoDiferenciasCadena', () => {
  it('lleva el periodo con el mes en dos digitos, sin espacios ni acentos', () => {
    expect(nombreArchivoDiferenciasCadena(2026, 9)).toBe('diferencias-cadena-2026-09.xlsx');
    expect(nombreArchivoDiferenciasCadena(2026, 12)).toBe('diferencias-cadena-2026-12.xlsx');
  });

  it('sin nombre de tienda: el archivo mezcla la cadena, la columna Sucursal las distingue', () => {
    expect(nombreArchivoDiferenciasCadena(2026, 9)).not.toMatch(/market|luzuriaga/i);
  });
});
