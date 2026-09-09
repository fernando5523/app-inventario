/**
 * El armado del archivo, sin Prisma: que la fila 1 sean los encabezados
 * exactos, una fila por producto (nunca una fila de más ni de menos, nunca
 * una celda fusionada), y que cada columna numérica llegue como NUMERO de
 * verdad -- no como texto -- porque eso es lo que decide si sirve para una
 * tabla dinámica.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  armarLibroDiferencias,
  ENCABEZADOS_EXPORT_DIFERENCIAS,
  nombreArchivoExportConsolidado,
  nombreArchivoExportDiferencias,
  type FilaDiferenciaExport,
} from './historial.exportar';

function fila(overrides: Partial<FilaDiferenciaExport> = {}): FilaDiferenciaExport {
  return {
    sucursal: 'Market Bolívar',
    periodoAnio: 2026,
    periodoMes: 9,
    inventarioId: 30,
    codigo: '000123',
    codigoBarras: '7750001230001',
    descripcion: 'Yogur Frutilla 1L',
    categoria: 'Lácteos',
    stockSistema: 42,
    conteoFinal: 38,
    diferencia: -4,
    tipo: 'faltante',
    resueltoEnConteo: 2,
    precioUnitario: 5.9,
    montoDiferencia: -23.6,
    ...overrides,
  };
}

async function leer(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const libro = new ExcelJS.Workbook();
  // `as any`: exceljs declara su PROPIO `Buffer` de respaldo dentro de su
  // modulo (`declare interface Buffer extends ArrayBuffer {}`, para poder
  // compilar sin @types/node) -- con @types/node instalado, ese shim local
  // NUNCA matchea a un Buffer real de Node (uno extiende Uint8Array, el otro
  // ArrayBuffer). Es una incompatibilidad de TIPOS entre paquetes, no del
  // dato: en runtime `buffer` es un Buffer de Node de verdad.
  await libro.xlsx.load(buffer as any);
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El libro no tiene ninguna hoja.');
  return hoja;
}

describe('armarLibroDiferencias: tabla plana -- fila 1 encabezados, una fila por producto', () => {
  it('la fila 1 es EXACTAMENTE ENCABEZADOS_EXPORT_DIFERENCIAS, sin nada arriba', async () => {
    const hoja = await leer(await armarLibroDiferencias([fila()]));
    const encabezados = (hoja.getRow(1).values as unknown[]).slice(1);
    expect(encabezados).toEqual([...ENCABEZADOS_EXPORT_DIFERENCIAS]);
  });

  it('una fila por producto -- ni una fila en blanco ni una de título de más', async () => {
    const filas = [fila({ codigo: '000123' }), fila({ codigo: '000456' }), fila({ codigo: '000789' })];
    const hoja = await leer(await armarLibroDiferencias(filas));
    // +1 por el encabezado. Si hubiera una fila de título arriba o una en
    // blanco entre header y datos, este número no cerraría.
    expect(hoja.rowCount).toBe(filas.length + 1);
  });

  it('sin filas: solo el encabezado, nunca "sin datos" ni una fila vacía', async () => {
    const hoja = await leer(await armarLibroDiferencias([]));
    expect(hoja.rowCount).toBe(1);
  });

  it('CERO celdas combinadas -- rompen el agrupamiento de una tabla dinámica', async () => {
    const hoja = await leer(await armarLibroDiferencias([fila(), fila({ codigo: '000456' })]));
    expect(hoja.model.merges).toEqual([]);
  });

  it('los números llegan como NUMERO, no como texto', async () => {
    const hoja = await leer(await armarLibroDiferencias([fila()]));
    const datos = hoja.getRow(2);
    const columnasNumero = [2, 3, 4, 9, 10, 11, 13, 14, 15]; // año, mes, inventario, stock, conteo, diferencia, ronda, precio, monto (1-based)
    for (const col of columnasNumero) {
      expect(typeof datos.getCell(col).value).toBe('number');
    }
  });

  it('las columnas de texto llegan como texto', async () => {
    const hoja = await leer(await armarLibroDiferencias([fila()]));
    const datos = hoja.getRow(2);
    const columnasTexto = [1, 5, 6, 7, 8, 12]; // sucursal, código, código de barras, descripción, categoría, tipo
    for (const col of columnasTexto) {
      expect(typeof datos.getCell(col).value).toBe('string');
    }
  });

  it('categoría y precio en null quedan como celda VACIA, nunca la palabra "null"', async () => {
    const hoja = await leer(await armarLibroDiferencias([fila({ categoria: null, precioUnitario: null, montoDiferencia: null })]));
    const datos = hoja.getRow(2);
    expect(datos.getCell(8).value).toBeNull();
    expect(datos.getCell(14).value).toBeNull();
    expect(datos.getCell(15).value).toBeNull();
  });

  it('vuelca los valores de cada fila en el orden de ENCABEZADOS_EXPORT_DIFERENCIAS', async () => {
    const hoja = await leer(await armarLibroDiferencias([fila()]));
    const valores = (hoja.getRow(2).values as unknown[]).slice(1);
    expect(valores).toEqual([
      'Market Bolívar',
      2026,
      9,
      30,
      '000123',
      '7750001230001',
      'Yogur Frutilla 1L',
      'Lácteos',
      42,
      38,
      -4,
      'faltante',
      2,
      5.9,
      -23.6,
    ]);
  });
});

describe('nombreArchivoExportDiferencias: identifica tienda + período + inventario, sin espacios ni acentos', () => {
  it('caso normal', () => {
    expect(nombreArchivoExportDiferencias('Market Bolívar', 2026, 9, 30)).toBe('diferencias-market-bolivar-2026-09-inv30.xlsx');
  });

  it('mes de un dígito queda con cero adelante -- ordena bien alfabéticamente', () => {
    expect(nombreArchivoExportDiferencias('Market Carhuaz', 2026, 3, 12)).toBe('diferencias-market-carhuaz-2026-03-inv12.xlsx');
  });

  it('sin tildes ni eñes en el resultado, aunque el nombre las tenga', () => {
    const nombre = nombreArchivoExportDiferencias('Cañón Ñuñoa Álamos', 2026, 12, 1);
    expect(nombre).not.toMatch(/[áéíóúñÁÉÍÓÚÑ]/);
  });

  it('sin espacios en el resultado', () => {
    expect(nombreArchivoExportDiferencias('Market Bolívar', 2026, 9, 30)).not.toContain(' ');
  });

  it('sucursal vacía o solo símbolos no deja un nombre roto', () => {
    expect(nombreArchivoExportDiferencias('---', 2026, 9, 30)).toBe('diferencias-sucursal-2026-09-inv30.xlsx');
  });
});

describe('nombreArchivoExportConsolidado: identifica el período, sin atarse a una sola tienda', () => {
  it('caso normal', () => {
    expect(nombreArchivoExportConsolidado(2026, 9)).toBe('diferencias-consolidado-2026-09.xlsx');
  });

  it('mes de un dígito con cero adelante', () => {
    expect(nombreArchivoExportConsolidado(2026, 3)).toBe('diferencias-consolidado-2026-03.xlsx');
  });
});
