/**
 * El AGRUPAMIENTO del login: quién aparece bajo una tienda y quién en el grupo
 * "administradores". Regla del cliente (2026-09-10): "el auditor no tiene
 * tienda, por ende no debería loguearse a una tienda, sino en administradores".
 *
 * Se prueba a nivel service porque el filtro vive en el `where` de Prisma (lo
 * hace la base, el service no post-filtra), así que lo que hay que fijar es la
 * FORMA del `where` — mismo criterio que inventarios.service.test.ts.
 *
 * Prisma mockeado: `npm test` no levanta Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  colaborador: { findMany: vi.fn() },
  sucursal: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { listarAdministradores, listarColaboradores, listarSucursales } from './sesion.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.colaborador.findMany.mockResolvedValue([]);
  prismaMock.sucursal.findMany.mockResolvedValue([]);
});

describe('listarColaboradores: la lista de una tienda NO cuelga a los sin-tienda', () => {
  it('solo coordinador y conteo -- el auditor y el administrador no aparecen bajo una sucursal', async () => {
    await listarColaboradores(1);
    const where = prismaMock.colaborador.findMany.mock.calls[0]?.[0]?.where;
    expect(where.sucursalId).toBe(1);
    expect(where.activo).toBe(true);
    expect(where.rol).toEqual({ in: ['coordinador', 'conteo'] });
  });
});

describe('listarAdministradores: el grupo "administradores" son los usuarios SIN tienda', () => {
  it('agrupa por ROL (administrador y auditor), NO por sucursalId null: el auditor entra aunque tenga sucursal asignada (Gilmer)', async () => {
    await listarAdministradores();
    const where = prismaMock.colaborador.findMany.mock.calls[0]?.[0]?.where;
    expect(where.rol).toEqual({ in: ['administrador', 'auditor'] });
    expect(where.activo).toBe(true);
    // Ya NO filtra por sucursalId: un auditor con sucursal (dato viejo) igual
    // aparece acá y deja de colgar de una tienda.
    expect(where.sucursalId).toBeUndefined();
  });

  it('el rol viaja TAL CUAL del padrón: un auditor listado acá sigue siendo auditor, no administrador', async () => {
    prismaMock.colaborador.findMany.mockResolvedValue([
      { id: 9, nombre: 'Gilmer', dni: '44444444', rol: 'auditor', pinHash: 'x', sucursalId: 1 },
    ]);
    const r = await listarAdministradores();
    expect(r).toEqual([{ id: 9, nombre: 'Gilmer', dni: '44444444', rol: 'auditor' }]);
  });
});

describe('listarSucursales: el conteo de la tarjeta no cuenta a los sin-tienda', () => {
  it('cuenta solo coordinador y conteo activos (no infla la tienda con el auditor)', async () => {
    await listarSucursales();
    const args = prismaMock.sucursal.findMany.mock.calls[0]?.[0];
    expect(args.include._count.select.colaboradores).toEqual({
      where: { rol: { in: ['coordinador', 'conteo'] }, activo: true },
    });
  });
});
