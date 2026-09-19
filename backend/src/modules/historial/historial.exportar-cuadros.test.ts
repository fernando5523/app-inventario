/**
 * El libro con el formato del cliente, probado leyendo el .xlsx que produce.
 *
 * Los números y los encabezados salen de su propio archivo
 * (`requerimiento/INVENTARIO MES DE JULIO 2026 ACTUAL MKT BOLIVAR.xlsx`): es
 * la especificación, no un diseño nuestro. Si algo de acá cambia, el cliente
 * va a poner los dos archivos lado a lado y ver la diferencia.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  armarLibroDeCuadros,
  nombreArchivoCuadros,
  type FilaCuadro,
  type LibroDeCuadros,
} from './historial.exportar-cuadros';

const fila = (codigo: string, descripcion: string, cantidad: number, precio: number): FilaCuadro => ({
  codigo,
  descripcion,
  cantidad,
  precioUnitario: precio,
  total: Number((cantidad * precio).toFixed(2)),
});

/** Los números reales de Bolívar julio 2026, recortados a lo que se testea. */
const DATOS: LibroDeCuadros = {
  sucursal: 'MKT BOLIVAR',
  faltantesUnicos: [
    fila('112012', 'SAN LUIS AGUA S/GAS TP ROSCA BOT 1L', -1, 1.9),
    fila('103470', 'NESTLE CHOCOLATE PRINCESA 28GR', -37, 2.5),
  ],
  sobrantesUnicos: [fila('100304', 'PRIMOR ACEITE VEG PREMIUM BOT 900ML', 2, 10)],
  faltantesPaquete: [fila('105621', 'DORITOS QUESO ATREVIDO 90G', -21, 3.8)],
  sobrantesPaquete: [fila('103340', 'CHOCO LISTO CHOCOLATE EN POLVO DOYPACK 180G', 10, 7.7)],
  empresaFaltantes: [fila('109370', 'CRISTAL CERVEZA LATA 473ML', -1, 5.2)],
  empresaSobrantes: [fila('109276', 'PILSEN CALLAO CERVEZA LATA 473ML', 4, 5.2)],
  descuento: {
    totalFaltantes: -862.5,
    totalSobrantes: 490.6,
    diferencia: -371.9,
    personas: 12,
    cuotaBase: -30.99,
    planilla: [
      { nombre: 'LEYDI RIVERA', dni: '75705134', cuotaBase: -30.99, asistencia: -5.71, total: -36.7 },
      { nombre: 'WILMER MELLISHO BAUTISTA', dni: '71040408', cuotaBase: -30.99, asistencia: 28.58, total: -2.41 },
    ],
  },
};

async function abrir(datos: LibroDeCuadros = DATOS): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  const buffer = await armarLibroDeCuadros(datos);
  // `as never`: exceljs tipa `load` con su propio `Buffer` y TS 5.9 distingue
  // `Buffer<ArrayBufferLike>` del `Buffer` global. Es ruido de tipos, no un
  // problema real -- el buffer es el mismo.
  await libro.xlsx.load(buffer as never);
  return libro;
}

/** `getWorksheet` devuelve `undefined` si no existe: acá siempre existe. */
function hojaDe(libro: ExcelJS.Workbook, nombre: string): ExcelJS.Worksheet {
  const h = libro.getWorksheet(nombre);
  if (h === undefined) throw new Error(`El libro no tiene la hoja ${nombre}`);
  return h;
}

const texto = (h: ExcelJS.Worksheet, celda: string): string => String(h.getCell(celda).value ?? '');
const numero = (h: ExcelJS.Worksheet, celda: string): unknown => h.getCell(celda).value;

describe('armarLibroDeCuadros — las cuatro hojas de su archivo', () => {
  it('tiene FALTANTES, SOBRANTES, EMPRESA y DESCUENTO, con esos nombres', async () => {
    const libro = await abrir();
    expect(libro.worksheets.map((h) => h.name)).toEqual(['FALTANTES', 'SOBRANTES', 'EMPRESA', 'DESCUENTO']);
  });

  it('respeta "DISCRIPCION" con su falta de ortografía', async () => {
    // A propósito: quien recibe el archivo lo compara columna por columna
    // contra el suyo, y una columna renombrada es una pregunta que no
    // queremos que haga.
    const h = hojaDe(await abrir(), 'FALTANTES');
    // `values` es `CellValue[] | { [k: string]: CellValue }` segun exceljs; acá
    // siempre es el array 1-based, por eso el cast y el `slice(1)`.
    const encabezados = (h.getRow(4).values as ExcelJS.CellValue[]).slice(1);
    expect(encabezados).toEqual(['CODIGO', 'DISCRIPCION', 'CANTIDAD', 'P/U', 'TOTAL']);
  });

  it('la hoja FALTANTES lleva los TRES bloques, en su orden', async () => {
    const h = hojaDe(await abrir(), 'FALTANTES');
    const titulos: string[] = [];
    h.eachRow((f) => {
      const b = String(f.getCell(2).value ?? '');
      if (b.includes('FALTANTES UNICOS') || b.includes('POR PAQUETE')) titulos.push(b);
    });
    expect(titulos).toEqual(['PRODUCTOS FALTANTES UNICOS', 'FALTANTE POR PAQUETE', 'SOBRANTE POR PAQUETE']);
  });

  it('los números entran como NUMERO, no como texto', async () => {
    // Un string queda fuera de cualquier SUMA y se alinea distinto. Misma
    // regla que historial.exportar.ts.
    const h = hojaDe(await abrir(), 'FALTANTES');
    expect(typeof numero(h, 'C5')).toBe('number');
    expect(typeof numero(h, 'E5')).toBe('number');
  });

  it('cada bloque cierra con su propio total', async () => {
    const h = hojaDe(await abrir(), 'FALTANTES');
    // -1.90 + -92.50 = -94.40
    expect(texto(h, 'B7')).toBe('TOTAL');
    expect(numero(h, 'E7')).toBeCloseTo(-94.4);
  });

  it('un ítem SIN precio no vale 0: entra al cuadro con el monto vacío', async () => {
    // No se sabe cuánto vale -- no es que valga cero. Misma regla que
    // `diferenciaValor`.
    const conSinPrecio: LibroDeCuadros = {
      ...DATOS,
      faltantesUnicos: [{ codigo: 'X', descripcion: 'SIN PRECIO', cantidad: -3, precioUnitario: null, total: null }],
    };
    const h = hojaDe(await abrir(conSinPrecio), 'FALTANTES');
    expect(numero(h, 'C5')).toBe(-3);
    expect(numero(h, 'E5')).toBeNull();
    expect(numero(h, 'E6')).toBe(0); // el total suma lo que se puede
  });
});

describe('armarLibroDeCuadros — la hoja DESCUENTO', () => {
  it('muestra la cuenta entera: FALTANTES + SOBRANTES = DIFERENCIA', async () => {
    // Verificado contra su hoja: -862.50 + 490.60 = -371.90.
    const h = hojaDe(await abrir(), 'DESCUENTO');
    expect(texto(h, 'B4')).toBe('TOTAL FALTANTES');
    expect(numero(h, 'E4')).toBe(-862.5);
    expect(texto(h, 'B5')).toBe('TOTAL SOBRANTES');
    expect(numero(h, 'E5')).toBe(490.6);
    expect(numero(h, 'E6')).toBe(-371.9);
  });

  it('LOS CUADROS POR PAQUETE NO APARECEN acá: si aparecieran, alguien los sumaría', async () => {
    const h = hojaDe(await abrir(), 'DESCUENTO');
    const todo: string[] = [];
    h.eachRow((f) => f.eachCell((c) => todo.push(String(c.value ?? ''))));
    expect(todo.join(' ')).not.toContain('PAQUETE');
    // Y el -79.80 de DORITOS tampoco está en ningún lado de esta hoja.
    expect(todo).not.toContain('-79.8');
  });

  it('reparte entre la cantidad de personas y lista a cada una', async () => {
    const h = hojaDe(await abrir(), 'DESCUENTO');
    expect(numero(h, 'C11')).toBe(12);
    expect(numero(h, 'E11')).toBe(-30.99);
    expect(texto(h, 'C15')).toBe('LEYDI RIVERA');
    expect(numero(h, 'I15')).toBe(-36.7);
  });

  it('la asistencia viaja por persona: la misma cuota da totales distintos', async () => {
    // LEYDI faltó a un conteo (-5.71) y WILMER fue a todos (+28.58): misma
    // cuota base, distinto total. Es lo que explica por qué la columna existe.
    const h = hojaDe(await abrir(), 'DESCUENTO');
    expect(numero(h, 'E15')).toBe(numero(h, 'E16'));
    expect(numero(h, 'G15')).toBe(-5.71);
    expect(numero(h, 'G16')).toBe(28.58);
    expect(numero(h, 'I15')).not.toBe(numero(h, 'I16'));
  });
});

describe('armarLibroDeCuadros — la hoja EMPRESA', () => {
  it('va aparte, con su propia diferencia', async () => {
    const h = hojaDe(await abrir(), 'EMPRESA');
    expect(texto(h, 'A1')).toContain('CERVEZA');
    const todo: string[] = [];
    h.eachRow((f) => f.eachCell((c) => todo.push(String(c.value ?? ''))));
    expect(todo).toContain('DIFERENCIA');
  });
});

describe('nombreArchivoCuadros', () => {
  it('arma un nombre sin acentos ni espacios, con periodo e inventario', () => {
    expect(nombreArchivoCuadros('Market Bolívar', 2026, 7, 45)).toBe(
      'inventario-cuadros-market-bolivar-2026-07-inv45.xlsx',
    );
  });

  it('rellena el mes con cero para que ordene bien por nombre', () => {
    expect(nombreArchivoCuadros('Market Sucre', 2026, 9, 3)).toContain('2026-09');
  });
});

describe('armarLibroDeCuadros — un cuadro sin ítems', () => {
  /**
   * Un bloque QUE FALTA se lee como "el sistema falló"; uno presente y vacío
   * afirma "se miró y no hubo". Es la misma distinción entre `null` y `0` que
   * el backend sostiene en todos lados.
   */
  it('va igual, con sus encabezados y una línea que lo dice', async () => {
    const h = hojaDe(await abrir({ ...DATOS, faltantesPaquete: [], sobrantesPaquete: [] }), 'FALTANTES');
    const todo: string[] = [];
    h.eachRow((f) => f.eachCell((c) => todo.push(String(c.value ?? ''))));

    // El bloque sigue estando, con su título y sus encabezados.
    expect(todo).toContain('FALTANTE POR PAQUETE');
    expect(todo).toContain('SOBRANTE POR PAQUETE');
    expect(todo.filter((t) => t === 'Sin ítems en este cuadro.')).toHaveLength(2);
  });

  it('su total va en 0, no vacío: se miró y no hubo', async () => {
    const libro = await abrir({ ...DATOS, sobrantesUnicos: [] });
    const h = hojaDe(libro, 'SOBRANTES');
    const numeros: unknown[] = [];
    h.eachRow((f) => f.eachCell((c) => numeros.push(c.value)));
    expect(numeros).toContain(0);
  });
});
