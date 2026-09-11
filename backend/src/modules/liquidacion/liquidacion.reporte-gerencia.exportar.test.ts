/**
 * El EXCEL del reporte a gerencia: los productos de EMPRESA con sus sobrantes y
 * faltantes detallados. Mismo patrón que el export de diferencias
 * (historial.exportar.ts) y, a propósito, LAS MISMAS COLUMNAS: gerencia puede
 * pegar las dos tablas una debajo de la otra y la columna Responsable las
 * separa (Empleado / Empresa).
 *
 * Reglas del cliente para todo export: tabla plana (encabezado en la fila 1,
 * una fila por producto, cero celdas combinadas), números como números, y
 * sobrantes/faltantes distinguidos por una COLUMNA, no por hojas separadas.
 */

import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  diferenciaItem: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { ENCABEZADOS_EXPORT_DIFERENCIAS } from '../historial/historial.exportar';
import { obtenerReporteGerencia, type ReporteGerenciaDto } from './liquidacion.reporte-gerencia';
import {
  armarLibroReporteGerencia,
  exportarReporteGerencia,
  filasDeReporteGerencia,
  nombreArchivoReporteGerencia,
  type DetalleItemReporte,
} from './liquidacion.reporte-gerencia.exportar';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'coordinador' };

const CONTEXTO = { sucursal: 'Market Bolívar', periodoAnio: 2026, periodoMes: 8 };

const decimal = (n: number) => ({ toNumber: () => n });

/** 1-based, como las celdas de exceljs. */
const columna = (nombre: (typeof ENCABEZADOS_EXPORT_DIFERENCIAS)[number]): number =>
  ENCABEZADOS_EXPORT_DIFERENCIAS.indexOf(nombre) + 1;

/** Como lo devuelve obtenerReporteGerencia: una cerveza que falta y un vino que sobra. */
function reporte(parcial: Partial<ReporteGerenciaDto> = {}): ReporteGerenciaDto {
  return {
    inventarioId: 45,
    estado: 'liquidado',
    faltantes: [{ codigo: 'CERV620', descripcion: 'Cerveza 620ml', unidades: 10, monto: 100 }],
    sobrantes: [{ codigo: 'VINO750', descripcion: 'Vino tinto 750ml', unidades: 3, monto: 45 }],
    totalFaltante: 100,
    totalSobrante: 45,
    ...parcial,
  };
}

function detalles(parcial: Record<string, Partial<DetalleItemReporte>> = {}): Map<string, DetalleItemReporte> {
  const base: Record<string, DetalleItemReporte> = {
    CERV620: { codigoBarras: '7750000000620', categoria: 'Cervezas', stockSistema: 50, conteoFinal: 40, resueltoEnConteo: 3, precioUnitario: 10 },
    VINO750: { codigoBarras: '7750000000750', categoria: 'Vinos', stockSistema: 12, conteoFinal: 15, resueltoEnConteo: 2, precioUnitario: 15 },
  };
  return new Map(Object.entries(base).map(([codigo, d]) => [codigo, { ...d, ...parcial[codigo] }]));
}

async function leer(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  // `as any`: mismo motivo que historial.exportar.test.ts -- el `Buffer` que
  // declara exceljs no es el de Node para tsc, aunque en runtime lo sea.
  await libro.xlsx.load(buffer as any);
  return libro;
}

async function primeraHoja(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const hoja = (await leer(buffer)).worksheets[0];
  if (!hoja) throw new Error('El libro no tiene ninguna hoja.');
  return hoja;
}

const libroDe = (r: ReporteGerenciaDto = reporte()) => armarLibroReporteGerencia(filasDeReporteGerencia(r, CONTEXTO, detalles()));

describe('armarLibroReporteGerencia: tabla plana con las MISMAS columnas que el export de diferencias', () => {
  it('la fila 1 es EXACTAMENTE el encabezado del export de diferencias: gerencia puede pegar las dos tablas', async () => {
    const hoja = await primeraHoja(await libroDe());
    expect((hoja.getRow(1).values as unknown[]).slice(1)).toEqual([...ENCABEZADOS_EXPORT_DIFERENCIAS]);
  });

  it('una fila por producto y sobrantes y faltantes en la MISMA hoja: sin filas de título ni en blanco', async () => {
    const libro = await leer(await libroDe());
    expect(libro.worksheets).toHaveLength(1);
    expect(libro.worksheets[0]!.rowCount).toBe(1 + 2);
  });

  it('CERO celdas combinadas', async () => {
    const hoja = await primeraHoja(await libroDe());
    expect(hoja.model.merges).toEqual([]);
  });

  it('sobrante y faltante se distinguen por la columna Tipo', async () => {
    const hoja = await primeraHoja(await libroDe());
    expect([2, 3].map((n) => hoja.getRow(n).getCell(columna('Tipo')).value)).toEqual(['faltante', 'sobrante']);
  });

  it('Responsable dice Empresa en todas las filas: es lo que las separa de las del empleado', async () => {
    const hoja = await primeraHoja(await libroDe());
    expect([2, 3].map((n) => hoja.getRow(n).getCell(columna('Responsable')).value)).toEqual(['Empresa', 'Empresa']);
  });

  it('los números llegan como NUMERO, no como texto', async () => {
    const hoja = await primeraHoja(await libroDe());
    const numericas = ['Año', 'Mes', 'Inventario', 'Stock ERP', 'Conteo final', 'Diferencia', 'Ronda resuelta', 'Precio unitario', 'Monto diferencia'] as const;
    for (const nombre of numericas) {
      expect(typeof hoja.getRow(2).getCell(columna(nombre)).value, nombre).toBe('number');
    }
  });

  it('diferencia y monto CON SIGNO, igual que el export de diferencias: el faltante resta, el sobrante suma', async () => {
    const hoja = await primeraHoja(await libroDe());
    expect(hoja.getRow(2).getCell(columna('Diferencia')).value).toBe(-10);
    expect(hoja.getRow(2).getCell(columna('Monto diferencia')).value).toBe(-100);
    expect(hoja.getRow(3).getCell(columna('Diferencia')).value).toBe(3);
    expect(hoja.getRow(3).getCell(columna('Monto diferencia')).value).toBe(45);
  });

  it('sin precio en Dynamics: precio y monto quedan como celda VACÍA, nunca 0', async () => {
    const r = reporte({ faltantes: [{ codigo: 'CERV620', descripcion: 'Cerveza 620ml', unidades: 10, monto: null }], sobrantes: [] });
    const filas = filasDeReporteGerencia(r, CONTEXTO, detalles({ CERV620: { precioUnitario: null, categoria: null } }));
    const hoja = await primeraHoja(await armarLibroReporteGerencia(filas));
    expect(hoja.getRow(2).getCell(columna('Precio unitario')).value).toBeNull();
    expect(hoja.getRow(2).getCell(columna('Monto diferencia')).value).toBeNull();
    expect(hoja.getRow(2).getCell(columna('Categoría')).value).toBeNull();
  });

  it('sin productos de la empresa con diferencias: solo el encabezado', async () => {
    const hoja = await primeraHoja(await libroDe(reporte({ faltantes: [], sobrantes: [] })));
    expect(hoja.rowCount).toBe(1);
  });

  it('vuelca cada fila en el orden de las columnas', async () => {
    const hoja = await primeraHoja(await libroDe());
    expect((hoja.getRow(2).values as unknown[]).slice(1)).toEqual([
      'Market Bolívar',
      2026,
      8,
      45,
      'CERV620',
      '7750000000620',
      'Cerveza 620ml',
      'Cervezas',
      'Empresa',
      50,
      40,
      -10,
      'faltante',
      3,
      10,
      -100,
    ]);
  });
});

describe('filasDeReporteGerencia', () => {
  it('primero los faltantes y después los sobrantes, en el mismo orden que la pantalla', () => {
    const r = reporte({
      faltantes: [
        { codigo: 'CERV620', descripcion: 'Cerveza 620ml', unidades: 10, monto: 100 },
        { codigo: 'VINO750', descripcion: 'Vino tinto 750ml', unidades: 1, monto: 15 },
      ],
      sobrantes: [],
    });
    expect(filasDeReporteGerencia(r, CONTEXTO, detalles()).map((f) => [f.codigo, f.tipo])).toEqual([
      ['CERV620', 'faltante'],
      ['VINO750', 'faltante'],
    ]);
  });

  it('el monto es el MISMO que muestra la pantalla, con el signo del tipo: no se recalcula', () => {
    const r = reporte({ faltantes: [{ codigo: 'CERV620', descripcion: 'Cerveza 620ml', unidades: 10, monto: 99.9 }] });
    // precio 10 x 10 unidades daría 100: si el export recalculara, se notaría acá.
    expect(filasDeReporteGerencia(r, CONTEXTO, detalles())[0]!.montoDiferencia).toBe(-99.9);
  });

  it('si falta el detalle de un producto, falla: no inventa stock ni conteo', () => {
    expect(() => filasDeReporteGerencia(reporte(), CONTEXTO, new Map())).toThrow(/CERV620/);
  });
});

describe('nombreArchivoReporteGerencia: tienda + período + inventario, sin espacios ni tildes', () => {
  it('caso normal', () => {
    expect(nombreArchivoReporteGerencia('Market Bolívar', 2026, 8, 45)).toBe('reporte-gerencia-market-bolivar-2026-08-inv45.xlsx');
  });

  it('sucursal vacía o solo símbolos no deja un nombre roto', () => {
    expect(nombreArchivoReporteGerencia('---', 2026, 12, 3)).toBe('reporte-gerencia-sucursal-2026-12-inv3.xlsx');
  });
});

describe('exportarReporteGerencia: los mismos guardas que el reporte en pantalla', () => {
  function mockLiquidado(): void {
    // Un superconjunto: obtenerReporteGerencia lee `id`/`estado` y el export
    // lee período y tienda.
    prismaMock.inventario.findUnique.mockResolvedValue({
      id: 45,
      estado: 'liquidado',
      periodoAnio: 2026,
      periodoMes: 8,
      sucursal: { nombre: 'Market Bolívar' },
    });
    prismaMock.diferenciaItem.findMany.mockResolvedValue([
      { codigo: 'CERV620', descripcion: 'Cerveza 620ml', diferencia: -10, montoDiferencia: decimal(-100), stockSistema: 50, conteoFinal: 40, resueltoEnConteo: 3, precioUnitario: decimal(10) },
      { codigo: 'VINO750', descripcion: 'Vino tinto 750ml', diferencia: 3, montoDiferencia: decimal(45), stockSistema: 12, conteoFinal: 15, resueltoEnConteo: 2, precioUnitario: decimal(15) },
    ]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([
      { codigo: 'CERV620', codigoBarras: '7750000000620', categoria: 'Cervezas' },
      { codigo: 'VINO750', codigoBarras: '7750000000750', categoria: 'Vinos' },
    ]);
  }

  beforeEach(() => vi.clearAllMocks());

  it('el coordinador recibe 403 antes de tocar la base', async () => {
    await expect(exportarReporteGerencia(COORDINADOR, 45)).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.inventario.findUnique).not.toHaveBeenCalled();
  });

  it('sin liquidar: 409, y no se arma ningún archivo', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 45, estado: 'conteo_cerrado' });
    await expect(exportarReporteGerencia(AUDITOR, 45)).rejects.toMatchObject({ status: 409 });
    expect(prismaMock.catalogoItem.findMany).not.toHaveBeenCalled();
  });

  it('liquidado: una fila por producto de la empresa, con los MISMOS montos que el reporte en pantalla', async () => {
    mockLiquidado();
    const enPantalla = await obtenerReporteGerencia(AUDITOR, 45);

    const { buffer } = await exportarReporteGerencia(AUDITOR, 45);
    const hoja = await primeraHoja(buffer);

    expect(hoja.rowCount).toBe(1 + enPantalla.faltantes.length + enPantalla.sobrantes.length);
    expect([2, 3].map((n) => hoja.getRow(n).getCell(columna('Monto diferencia')).value)).toEqual([
      -enPantalla.faltantes[0]!.monto!,
      enPantalla.sobrantes[0]!.monto,
    ]);
    expect(hoja.getRow(2).getCell(columna('Categoría')).value).toBe('Cervezas');
  });

  it('el nombre del archivo identifica tienda, período e inventario', async () => {
    mockLiquidado();
    const { nombreArchivo } = await exportarReporteGerencia(AUDITOR, 45);
    expect(nombreArchivo).toBe('reporte-gerencia-market-bolivar-2026-08-inv45.xlsx');
  });
});
