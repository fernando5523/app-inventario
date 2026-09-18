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
  colaborador: { findMany: vi.fn(), findUnique: vi.fn() },
  sucursal: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { ingresar, listarAdministradores, listarColaboradores, listarSucursales } from './sesion.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.colaborador.findMany.mockResolvedValue([]);
  prismaMock.colaborador.findUnique.mockResolvedValue(null);
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

/**
 * `SucursalDto.colaboradores` viaja en DOS respuestas (la lista del login y la
 * sesion que se emite al ingresar) y significa lo mismo en las dos. Si solo una
 * filtra, la misma tienda muestra dos numeros distintos segun la pantalla --
 * que es exactamente lo que pasaba con Tiendas (11) contra el login (9).
 */
describe('ingresar: la sucursal de la SESION cuenta lo mismo que el login', () => {
  it('filtra por rol de tienda y activo, no cuenta todas las filas de la sucursal', async () => {
    await expect(ingresar(101, '123456')).rejects.toThrow();

    const args = prismaMock.colaborador.findUnique.mock.calls[0]?.[0];
    expect(args.include.sucursal.include._count.select.colaboradores).toEqual({
      where: { rol: { in: ['coordinador', 'conteo'] }, activo: true },
    });
  });

  it('es EXACTAMENTE el mismo filtro que usa la tarjeta del login', async () => {
    await listarSucursales();
    await ingresar(101, '123456').catch(() => undefined);

    const login = prismaMock.sucursal.findMany.mock.calls[0]?.[0].include._count.select.colaboradores;
    const sesion = prismaMock.colaborador.findUnique.mock.calls[0]?.[0].include.sucursal.include._count.select.colaboradores;
    expect(sesion).toEqual(login);
  });
});
