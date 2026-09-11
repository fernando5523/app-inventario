/**
 * REGRESION reportada por min-4 (2026-09-14): la matriz de auditoria leia
 * `CatalogoItem.esEmpresa` (Dynamics) directo, sin la excepcion del Auditor
 * (`ClasificacionProducto`) -- un producto que Gilmer clasificaba como
 * empresa DESPUES del cierre del conteo seguia apareciendo en la matriz como
 * faltante del empleado, mientras la liquidacion (que si pasaba por
 * `liquidacion.reclasificacion.ts`) ya lo excluia. Dos pantallas de la misma
 * app diciendo cosas distintas -- misma familia de bug que el del neto, y
 * arreglado con la MISMA fuente (`aplicarClasificacionVigente`).
 *
 * Prisma mockeado, mismo estilo que el resto del proyecto: no hay Postgres
 * en `npm test`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  hojaConteo: { findMany: vi.fn() },
  diferenciaItem: { findMany: vi.fn() },
  clasificacionProducto: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { matriz } from './auditoria.service';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };

const CERVEZA = { codigo: 'CERVEZA', descripcion: 'Cerveza 620ml', stockErp: 20, precioVenta: { toNumber: () => 10 }, esEmpresa: false };

function mockInventario(estado: string): void {
  prismaMock.inventario.findUnique.mockResolvedValue({ id: 45, sucursalId: 1, estado });
}

const QUERY_DEFECTO = { filtro: 'todos' as const, desplazamiento: 0, limite: 50 };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.catalogoItem.findMany.mockResolvedValue([CERVEZA]);
  prismaMock.hojaConteo.findMany.mockResolvedValue([]); // nadie la conto: veredicto sin_contar, no afecta esEmpresa
});

describe('matriz: la clasificacion del Auditor se ve, no solo la de Dynamics', () => {
  it('ANTES de liquidar (conteo_cerrado), con la cerveza clasificada como empresa: aparece como empresa', async () => {
    mockInventario('conteo_cerrado');
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
  });

  it('ANTES de liquidar, sin clasificar: sigue como la trae Dynamics (empleado)', async () => {
    mockInventario('conteo_cerrado');
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(false);
  });

  it('DESPUES de liquidar (liquidado): lee lo CONGELADO en DiferenciaItem, no la clasificacion vigente', async () => {
    mockInventario('liquidado');
    prismaMock.diferenciaItem.findMany.mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
    expect(prismaMock.clasificacionProducto.findMany).not.toHaveBeenCalled();
  });

  it('lacrado: mismo regimen congelado', async () => {
    mockInventario('lacrado');
    prismaMock.diferenciaItem.findMany.mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
  });
});
