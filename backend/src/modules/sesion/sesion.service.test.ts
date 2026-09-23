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

describe('listarColaboradores: quien se elige DENTRO de una tienda', () => {
  /**
   * ESTE TEST PEDIA "solo coordinador y conteo" Y AHORA INCLUYE AL AUDITOR.
   * Decision del usuario (2026-09-22): a Gilmer le resultaba raro entrar por
   * el grupo de arriba, y elegirse en su tienda no le cambia ni un permiso --
   * `ingresar` emite la sesion con el rol del PADRON.
   *
   * El administrador NO entra: es del sistema y no cuelga de ninguna tienda.
   */
  it('coordinador, conteo Y el auditor de esa tienda -- el administrador no', async () => {
    await listarColaboradores(1);
    const where = prismaMock.colaborador.findMany.mock.calls[0]?.[0]?.where;
    expect(where.sucursalId).toBe(1);
    expect(where.activo).toBe(true);
    expect(where.rol.in).toEqual(expect.arrayContaining(['coordinador', 'conteo', 'auditor']));
    expect(where.rol.in).not.toContain('administrador');
  });

  /**
   * EL AUDITOR SALE EN SU TIENDA Y EN NINGUNA OTRA, y no hace falta una regla
   * aparte: el `where` pide `sucursalId`, asi que la base ya lo resuelve. Este
   * test fija que ese filtro no se pierda -- sin el, el auditor de Luzuriaga
   * aparecería en las diez tiendas.
   */
  it('filtra por la sucursal pedida: el auditor de Luzuriaga no sale en Bolívar', async () => {
    await listarColaboradores(7);
    expect(prismaMock.colaborador.findMany.mock.calls[0]?.[0]?.where.sucursalId).toBe(7);
  });

  /**
   * EL AUDITOR SIN SUCURSAL NO APARECE EN NINGUNA TIENDA. Sale del mismo
   * filtro: un `sucursalId` null no coincide con ninguna sucursal. Es lo
   * correcto -- no hay tienda donde mostrarlo, y ponerlo en las diez es justo
   * lo que evita la regla del 2026-09-10. Se elige en el grupo de arriba.
   */
  it('un auditor sin sucursal en su ficha no puede salir: el filtro es por sucursalId', async () => {
    await listarColaboradores(1);
    const where = prismaMock.colaborador.findMany.mock.calls[0]?.[0]?.where;
    expect(where.sucursalId).not.toBeNull();
    expect(where.sucursalId).not.toBeUndefined();
  });
});

/**
 * LO MISMO, PERO MIRANDO LAS FILAS QUE VUELVEN y no solo el `where`: que el
 * filtro sea el correcto no sirve de nada si la funcion despues descarta o
 * agrega a alguien.
 */
describe('listarColaboradores: las filas que devuelve', () => {
  const GILMER = { id: 103, nombre: 'Gilmer Quispe', dni: '3421', rol: 'auditor' };
  const JOSE = { id: 101, nombre: 'José Tarazona', dni: '1111', rol: 'coordinador' };
  const MARIA = { id: 102, nombre: 'María Rojas', dni: '2222', rol: 'conteo' };

  it('el auditor de esa tienda viaja en la lista, junto al coordinador y los contadores', async () => {
    prismaMock.colaborador.findMany.mockResolvedValue([JOSE, MARIA, GILMER]);

    const lista = await listarColaboradores(1);
    expect(lista.map((c) => c.id)).toEqual([101, 102, 103]);
    // Y con su ROL de verdad: quien lo elige tiene que ver que es el auditor,
    // no un contador mas.
    expect(lista.find((c) => c.id === 103)?.rol).toBe('auditor');
  });

  it('no inventa ni descarta filas: devuelve lo que trajo la consulta', async () => {
    prismaMock.colaborador.findMany.mockResolvedValue([JOSE]);
    expect(await listarColaboradores(1)).toHaveLength(1);
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

describe('listarSucursales: el conteo de la tarjeta dice lo que la lista va a mostrar', () => {
  /**
   * EL SUBTITULO Y LA LISTA NO PUEDEN DISCREPAR. Es la leccion de un bug real
   * (Tiendas decia 11 y el login 9): un subtitulo que promete 9 y abre una
   * lista de 10 es la misma mentira al reves. Desde que el auditor se elige en
   * su tienda, el conteo lo incluye igual que la lista.
   */
  it('cuenta lo mismo que `listarColaboradores`: coordinador, conteo y auditor activos', async () => {
    await listarSucursales();
    const args = prismaMock.sucursal.findMany.mock.calls[0]?.[0];
    const { where } = args.include._count.select.colaboradores;
    expect(where.activo).toBe(true);
    expect(where.rol.in).toEqual(expect.arrayContaining(['coordinador', 'conteo', 'auditor']));
  });

  it('es EXACTAMENTE el mismo filtro que la lista de la tienda', async () => {
    await listarSucursales();
    await listarColaboradores(1);

    const conteo = prismaMock.sucursal.findMany.mock.calls[0]?.[0].include._count.select.colaboradores.where;
    const lista = prismaMock.colaborador.findMany.mock.calls[0]?.[0].where;
    expect(conteo.rol).toEqual(lista.rol);
    expect(conteo.activo).toBe(lista.activo);
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
      where: { rol: { in: ['coordinador', 'conteo', 'auditor'] }, activo: true },
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
