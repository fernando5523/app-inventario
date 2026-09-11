/**
 * Las dos rutas del reporte a gerencia (liquidacion.reporte-gerencia.routes.ts):
 * el JSON que muestra la pantalla y el .xlsx para compartir. SOLO el auditor.
 *
 * Mismo patrón que historial.exportar.routes.test.ts: el controller NO se
 * mockea, Prisma sí -- así se prueban también los headers del archivo, que
 * los pone el controller.
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

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  diferenciaItem: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { reporteGerenciaRouter } from './liquidacion.reporte-gerencia.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

const decimal = (n: number) => ({ toNumber: () => n });

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const RUTA_JSON = '/api/liquidacion/inventarios/45/reporte-gerencia';
const RUTA_EXCEL = '/api/liquidacion/inventarios/45/reporte-gerencia/exportar';

let cerrar: () => Promise<void>;
let baseUrl: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const app = appDePrueba('/api/liquidacion', reporteGerenciaRouter);
  ({ baseUrl, cerrar } = await levantar(app));
});

afterEach(async () => {
  await cerrar();
});

function pedir(ruta: string, actor?: ColaboradorAutenticado): Promise<Response> {
  return fetch(`${baseUrl}${ruta}`, { headers: actor ? autorizacion(actor) : {} });
}

function mockLiquidado(): void {
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

describe.each([
  { nombre: 'GET /inventarios/:id/reporte-gerencia', ruta: RUTA_JSON },
  { nombre: 'GET /inventarios/:id/reporte-gerencia/exportar', ruta: RUTA_EXCEL },
])('$nombre: solo el auditor', ({ ruta }) => {
  it('sin sesión, 401', async () => {
    expect((await pedir(ruta)).status).toBe(401);
  });

  it.each([
    ['coordinador', COORDINADOR],
    ['administrador', ADMIN],
    ['conteo', CONTEO],
  ])('%s, 403', async (_rol, actor) => {
    expect((await pedir(ruta, actor)).status).toBe(403);
  });

  it('auditor, 200', async () => {
    mockLiquidado();
    expect((await pedir(ruta, AUDITOR)).status).toBe(200);
  });
});

describe('GET /inventarios/:id/reporte-gerencia/exportar: el archivo', () => {
  it('xlsx real, con el nombre de tienda + período + inventario', async () => {
    mockLiquidado();
    const r = await pedir(RUTA_EXCEL, AUDITOR);

    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe(XLSX);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="reporte-gerencia-market-bolivar-2026-08-inv45.xlsx"');

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
    const hoja = libro.worksheets[0]!;
    expect(hoja.rowCount).toBe(3);
  });

  it('sin liquidar: 409 con el motivo en JSON, no un archivo vacío', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 45, estado: 'conteo_cerrado' });
    const r = await pedir(RUTA_EXCEL, AUDITOR);

    expect(r.status).toBe(409);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(JSON.stringify(await r.json())).toMatch(/liquid/i);
  });
});
