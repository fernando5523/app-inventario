/**
 * El .xlsx de faltantes/sobrantes: mismo guard de sucursal que
 * `/diferencias` (historial.permisos.ts#validarAccesoAInventario, ya
 * testeado sin Prisma en historial.permisos.test.ts) -- esto prueba que la
 * ruta HTTP real lo aplica de punta a punta. Mismo patrón que
 * historial.aprobaciones.routes.test.ts: el controller NO se mockea, Prisma
 * sí, con lo mínimo que el camino recorrido necesita.
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
    inventario: { findUnique: vi.fn() },
    diferenciaItem: { findMany: vi.fn() },
    catalogoItem: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../config/database';
import { historialRouter } from './historial.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR_SUCURSAL_1: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const AUDITOR_SUCURSAL_2: ColaboradorAutenticado = { colaboradorId: 106, sucursalId: 2, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

/** Inventario 30, sucursal 1, período 2026-09. */
function inventarioDeSucursal1() {
  return {
    id: 30,
    sucursalId: 1,
    periodoAnio: 2026,
    periodoMes: 9,
    sucursal: { nombre: 'Market Bolívar' },
  };
}

let cerrar: () => Promise<void>;
let baseUrl: string;

beforeEach(async () => {
  vi.mocked(prisma.inventario.findUnique).mockReset();
  vi.mocked(prisma.diferenciaItem.findMany).mockReset();
  vi.mocked(prisma.catalogoItem.findMany).mockReset();

  const app = appDePrueba('/api/historial', historialRouter);
  ({ baseUrl, cerrar } = await levantar(app));
});

afterEach(async () => {
  await cerrar();
});

async function exportar(actor: ColaboradorAutenticado, inventarioId = 30): Promise<Response> {
  return fetch(`${baseUrl}/api/historial/inventarios/${inventarioId}/diferencias/exportar`, {
    headers: autorizacion(actor),
  });
}

async function leerPrimeraHoja(r: Response): Promise<ExcelJS.Worksheet> {
  const bytes = await r.arrayBuffer();
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(bytes) as any);
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El libro no tiene ninguna hoja.');
  return hoja;
}

describe('GET /api/historial/inventarios/:id/diferencias/exportar: quién puede bajar el .xlsx', () => {
  it('coordinador, 403 -- el conteo ciego no le permite ver el histórico', async () => {
    const r = await exportar(COORDINADOR);
    expect(r.status).toBe(403);
  });

  it('conteo, 403 -- mismo motivo que coordinador', async () => {
    const r = await exportar(CONTEO);
    expect(r.status).toBe(403);
  });

  it('auditor de OTRA sucursal, 403 -- el archivo es de la tienda, no de quien lo pide', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(inventarioDeSucursal1() as never);

    const r = await exportar(AUDITOR_SUCURSAL_2);

    expect(r.status).toBe(403);
  });

  it('auditor de SU sucursal: 200, xlsx real con nombre de archivo correcto', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(inventarioDeSucursal1() as never);
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([
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
    ] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([
      { codigo: '000123', codigoBarras: '7750001230001', categoria: 'Lácteos' },
    ] as never);

    const r = await exportar(AUDITOR_SUCURSAL_1);

    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="diferencias-market-bolivar-2026-09-inv30.xlsx"');
    const bytes = await r.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('administrador: 200 sin recorte de sucursal', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(inventarioDeSucursal1() as never);
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([] as never);

    const r = await exportar(ADMIN);

    expect(r.status).toBe(200);
  });

  it('sin sesión, 401', async () => {
    const r = await fetch(`${baseUrl}/api/historial/inventarios/30/diferencias/exportar`);
    expect(r.status).toBe(401);
  });
});

describe('columna Responsable: SOLO entra el Empleado, empresa y desconocido quedan afuera', () => {
  it('empleado entra, empresa y sin dato NO -- decisión del cliente, replica su informe actual', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(inventarioDeSucursal1() as never);
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([
      { codigo: 'EMP', descripcion: 'Del empleado', stockSistema: 10, conteoFinal: 8, diferencia: -2, resueltoEnConteo: 1, precioUnitario: null, montoDiferencia: null },
      { codigo: 'CIA', descripcion: 'De la empresa', stockSistema: 10, conteoFinal: 8, diferencia: -2, resueltoEnConteo: 1, precioUnitario: null, montoDiferencia: null },
      { codigo: 'NONE', descripcion: 'Responsable None', stockSistema: 10, conteoFinal: 8, diferencia: -2, resueltoEnConteo: 1, precioUnitario: null, montoDiferencia: null },
      { codigo: 'SIN_SYNC', descripcion: 'Nunca sincronizó la entidad', stockSistema: 10, conteoFinal: 8, diferencia: -2, resueltoEnConteo: 1, precioUnitario: null, montoDiferencia: null },
    ] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([
      { codigo: 'EMP', codigoBarras: '1', categoria: null, responsable: 'empleado' },
      { codigo: 'CIA', codigoBarras: '2', categoria: null, responsable: 'empresa' },
      { codigo: 'NONE', codigoBarras: '3', categoria: null, responsable: null },
      // 'SIN_SYNC' a propósito no tiene fila de catálogo: nunca sincronizó TRU_InventoryManagerPEEntities.
    ] as never);

    const r = await exportar(AUDITOR_SUCURSAL_1);
    const hoja = await leerPrimeraHoja(r);

    expect(hoja.rowCount).toBe(2); // encabezado + 1 sola fila (EMP)
    const fila = hoja.getRow(2);
    expect(fila.getCell(5).value).toBe('EMP'); // Código
    expect(fila.getCell(9).value).toBe('Empleado'); // Responsable
  });
});
