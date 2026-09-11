import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({
  prisma: {
    inventario: { findUnique: vi.fn() },
    diferenciaItem: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../config/database';
import { obtenerReporteGerencia } from './liquidacion.reporte-gerencia';
import type { ColaboradorAutenticado } from '../../shared/tipos';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 1, rol: 'auditor', sucursalId: null } as ColaboradorAutenticado;
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 2, rol: 'coordinador', sucursalId: 1 } as ColaboradorAutenticado;

describe('obtenerReporteGerencia', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SOLO el auditor: cualquier otro rol es Prohibido, antes de tocar la base', async () => {
    await expect(obtenerReporteGerencia(COORDINADOR, 45)).rejects.toMatchObject({ status: 403 });
    expect(prisma.inventario.findUnique).not.toHaveBeenCalled();
  });

  it('inventario inexistente: 404', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(null as never);
    await expect(obtenerReporteGerencia(AUDITOR, 999)).rejects.toMatchObject({ status: 404 });
  });

  it('inventario todavia sin liquidar: 409 -- la clasificacion no esta congelada', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ id: 45, estado: 'conteo_cerrado' } as never);
    await expect(obtenerReporteGerencia(AUDITOR, 45)).rejects.toMatchObject({ status: 409 });
    expect(prisma.diferenciaItem.findMany).not.toHaveBeenCalled();
  });

  it('liquidado: separa sobrantes de faltantes de productos de EMPRESA, con totales', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ id: 45, estado: 'liquidado' } as never);
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([
      { codigo: 'CERVEZA', descripcion: 'Cerveza 620ml', diferencia: -10, montoDiferencia: { toNumber: () => -100 } },
      { codigo: 'VINO', descripcion: 'Vino tinto', diferencia: 3, montoDiferencia: { toNumber: () => 45 } },
    ] as never);

    const r = await obtenerReporteGerencia(AUDITOR, 45);

    expect(r.faltantes).toEqual([{ codigo: 'CERVEZA', descripcion: 'Cerveza 620ml', unidades: 10, monto: 100 }]);
    expect(r.sobrantes).toEqual([{ codigo: 'VINO', descripcion: 'Vino tinto', unidades: 3, monto: 45 }]);
    expect(r.totalFaltante).toBe(100);
    expect(r.totalSobrante).toBe(45);

    // Filtra por esEmpresa=true en la query -- nunca trae productos de empleado.
    expect(prisma.diferenciaItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inventarioId: 45, esEmpresa: true } }),
    );
  });

  it('lacrado tambien habilita el reporte, igual que liquidado', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ id: 45, estado: 'lacrado' } as never);
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([] as never);
    await expect(obtenerReporteGerencia(AUDITOR, 45)).resolves.toMatchObject({ faltantes: [], sobrantes: [] });
  });

  it('items sin precio (montoDiferencia null) aparecen con monto null y no rompen el total', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ id: 45, estado: 'liquidado' } as never);
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([
      { codigo: 'SIN-PRECIO', descripcion: 'Item sin precio', diferencia: -1, montoDiferencia: null },
    ] as never);

    const r = await obtenerReporteGerencia(AUDITOR, 45);
    expect(r.faltantes).toEqual([{ codigo: 'SIN-PRECIO', descripcion: 'Item sin precio', unidades: 1, monto: null }]);
    expect(r.totalFaltante).toBe(0);
  });
});
