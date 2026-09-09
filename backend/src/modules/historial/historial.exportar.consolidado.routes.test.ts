/**
 * El .xlsx CONSOLIDADO (varias tiendas o todas, mismo período) -- pedido del
 * cliente (2026-09-09). Mismo patrón que historial.exportar.routes.test.ts:
 * el controller NO se mockea, Prisma sí. Lo que este archivo prueba es que
 * la ruta arma el WHERE correcto a partir de `resolverSucursalConsultable`
 * (ya testeado sin Prisma en historial.permisos.test.ts) -- el auditor
 * siempre termina limitado a su sucursal, pida lo que pida.
 */

import ExcelJS from 'exceljs';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDePrueba, autorizacion, levantar } from '../../test-utils/http-test';

vi.mock('../sesion/sesion.service', () => ({
  verificarToken: async (token: string) => {
    try {
      return JSON.parse(token) as ColaboradorAutenticado;
    } catch {
      return null;
    }
  },
}));

vi.mock('../../config/database', () => ({
  prisma: {
    inventario: { findUnique: vi.fn(), findMany: vi.fn() },
    diferenciaItem: { findMany: vi.fn() },
    catalogoItem: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../config/database';
import { historialRouter } from './historial.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR_SUCURSAL_1: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

function inventario(id: number, sucursalId: number, sucursalNombre: string) {
  return { id, sucursalId, periodoAnio: 2026, periodoMes: 9, sucursal: { nombre: sucursalNombre } };
}

async function leerPrimeraHoja(r: Response): Promise<ExcelJS.Worksheet> {
  const bytes = await r.arrayBuffer();
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(bytes) as any);
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El libro no tiene ninguna hoja.');
  return hoja;
}

let cerrar: () => Promise<void>;
let baseUrl: string;

beforeEach(async () => {
  vi.mocked(prisma.inventario.findMany).mockReset();
  vi.mocked(prisma.diferenciaItem.findMany).mockReset();
  vi.mocked(prisma.catalogoItem.findMany).mockReset();
  // Sin diferencias/catálogo por defecto -- cada test que necesite filas las pone.
  vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([] as never);

  const app = appDePrueba('/api/historial', historialRouter);
  ({ baseUrl, cerrar } = await levantar(app));
});

afterEach(async () => {
  await cerrar();
});

async function exportarConsolidado(actor: ColaboradorAutenticado, query = ''): Promise<Response> {
  return fetch(`${baseUrl}/api/historial/diferencias/exportar${query}`, { headers: autorizacion(actor) });
}

describe('GET /api/historial/diferencias/exportar: quién puede bajar el consolidado', () => {
  it('coordinador, 403', async () => {
    const r = await exportarConsolidado(COORDINADOR, '?periodoAnio=2026&periodoMes=9');
    expect(r.status).toBe(403);
  });

  it('conteo, 403', async () => {
    const r = await exportarConsolidado(CONTEO, '?periodoAnio=2026&periodoMes=9');
    expect(r.status).toBe(403);
  });

  it('sin periodoAnio/periodoMes, 400 -- un consolidado no puede barrer todo el historico', async () => {
    const r = await exportarConsolidado(ADMIN);
    expect(r.status).toBe(400);
  });

  it('auditor SIN pedir sucursal: el WHERE queda limitado a la suya, nunca "todas"', async () => {
    vi.mocked(prisma.inventario.findMany).mockResolvedValue([inventario(30, 1, 'Market Bolívar')] as never);

    const r = await exportarConsolidado(AUDITOR_SUCURSAL_1, '?periodoAnio=2026&periodoMes=9');

    expect(r.status).toBe(200);
    const where = vi.mocked(prisma.inventario.findMany).mock.calls[0]![0]!.where as { sucursalId?: { in: number[] } };
    expect(where.sucursalId).toEqual({ in: [1] });
  });

  it('auditor pidiendo OTRA sucursal explícita: igual queda limitado a la suya, no a un 403 ni a la ajena', async () => {
    vi.mocked(prisma.inventario.findMany).mockResolvedValue([inventario(30, 1, 'Market Bolívar')] as never);

    const r = await exportarConsolidado(AUDITOR_SUCURSAL_1, '?periodoAnio=2026&periodoMes=9&sucursalId=2');

    expect(r.status).toBe(200);
    const where = vi.mocked(prisma.inventario.findMany).mock.calls[0]![0]!.where as { sucursalId?: { in: number[] } };
    expect(where.sucursalId).toEqual({ in: [1] });
  });

  it('administrador SIN pedir sucursal: sin filtro de sucursal (todas)', async () => {
    vi.mocked(prisma.inventario.findMany).mockResolvedValue([] as never);

    const r = await exportarConsolidado(ADMIN, '?periodoAnio=2026&periodoMes=9');

    expect(r.status).toBe(200);
    const where = vi.mocked(prisma.inventario.findMany).mock.calls[0]![0]!.where as { sucursalId?: unknown };
    expect(where.sucursalId).toBeUndefined();
  });

  it('administrador con varias sucursales pedidas: el WHERE trae justo esas', async () => {
    vi.mocked(prisma.inventario.findMany).mockResolvedValue([] as never);

    const r = await exportarConsolidado(ADMIN, '?periodoAnio=2026&periodoMes=9&sucursalId=1&sucursalId=2');

    expect(r.status).toBe(200);
    const where = vi.mocked(prisma.inventario.findMany).mock.calls[0]![0]!.where as { sucursalId?: { in: number[] } };
    expect(where.sucursalId).toEqual({ in: [1, 2] });
  });

  it('dos tiendas: el .xlsx trae las filas de LAS DOS en una sola hoja, con la columna Sucursal distinta por fila', async () => {
    vi.mocked(prisma.inventario.findMany).mockResolvedValue([
      inventario(10, 1, 'Market Bolívar'),
      inventario(20, 2, 'Market Carhuaz'),
    ] as never);
    const implementacion = async ({ where }: { where: { inventarioId: number } }) => {
      if (where.inventarioId === 10) {
        return [
          {
            codigo: '000123',
            descripcion: 'Yogur Frutilla 1L',
            stockSistema: 42,
            conteoFinal: 38,
            diferencia: -4,
            resueltoEnConteo: 2,
            precioUnitario: { toNumber: () => 5.9 },
            montoDiferencia: { toNumber: () => -23.6 },
          },
        ];
      }
      return [
        {
          codigo: '000456',
          descripcion: 'Aceite Vegetal 1L',
          stockSistema: 10,
          conteoFinal: 12,
          diferencia: 2,
          resueltoEnConteo: 1,
          precioUnitario: { toNumber: () => 8 },
          montoDiferencia: { toNumber: () => 16 },
        },
      ];
    };
    vi.mocked(prisma.diferenciaItem.findMany).mockImplementation(implementacion as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([] as never);

    const r = await exportarConsolidado(ADMIN, '?periodoAnio=2026&periodoMes=9&sucursalId=1&sucursalId=2');
    const hoja = await leerPrimeraHoja(r);

    expect(hoja.rowCount).toBe(3); // encabezado + 2 filas
    expect(hoja.getRow(2).getCell(1).value).toBe('Market Bolívar');
    expect(hoja.getRow(3).getCell(1).value).toBe('Market Carhuaz');
  });

  it('ninguna coincidencia: archivo válido con solo el encabezado, no un error', async () => {
    vi.mocked(prisma.inventario.findMany).mockResolvedValue([] as never);

    const r = await exportarConsolidado(ADMIN, '?periodoAnio=2020&periodoMes=1');
    const hoja = await leerPrimeraHoja(r);

    expect(r.status).toBe(200);
    expect(hoja.rowCount).toBe(1);
  });

  it('sin sesión, 401', async () => {
    const r = await fetch(`${baseUrl}/api/historial/diferencias/exportar?periodoAnio=2026&periodoMes=9`);
    expect(r.status).toBe(401);
  });
});
