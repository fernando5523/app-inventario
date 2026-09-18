/**
 * El conteo de colaboradores de Tiendas es EL MISMO que el del login.
 *
 * Bug real (visto en la app): Tiendas mostraba "Market Central Luzuriaga · 11
 * colaboradores" y el login "9 colaboradores" para esa misma tienda. La
 * diferencia eran los 2 auditores (Gilmer y Rosa), que por decision del
 * cliente NO pertenecen a ninguna tienda (233f4b7), mas las cuentas
 * deshabilitadas, que el login tampoco cuenta.
 *
 * Se prueba a nivel service porque el filtro vive en el `_count` de Prisma (lo
 * hace la base, el service no post-filtra): lo que hay que fijar es la FORMA
 * del include -- mismo criterio que sesion.service.test.ts.
 *
 * Prisma mockeado, sin base (igual que el resto de la suite).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  sucursal: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  colaborador: { findMany: vi.fn(), findUnique: vi.fn() },
  configuracion: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

const listarAlmacenesMock = vi.hoisted(() => vi.fn());
vi.mock('../d365/d365-catalogo.service', () => ({ listarAlmacenes: listarAlmacenesMock }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { listarSucursales } from '../sesion/sesion.service';
import { actualizar, crear, listar } from './tiendas.service';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };

/** El universo que cuenta el login: personal de tienda y habilitado. */
const PERSONAL_DE_TIENDA = { where: { rol: { in: ['coordinador', 'conteo'] }, activo: true } };

function fila(colaboradores: number, almacenId: string | null = 'MD01_LUZ') {
  return {
    id: 1,
    nombre: 'Market Central Luzuriaga',
    direccion: null,
    telefono: null,
    activa: true,
    almacenId,
    almacenNombre: almacenId,
    // 9, no 11: los 2 auditores de la tienda ya no entran a este conteo.
    _count: { colaboradores },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.sucursal.findMany.mockResolvedValue([fila(9)]);
  prismaMock.sucursal.findUnique.mockResolvedValue(fila(9));
  prismaMock.sucursal.create.mockResolvedValue(fila(0, null));
  prismaMock.sucursal.update.mockResolvedValue(fila(9));
  prismaMock.colaborador.findUnique.mockResolvedValue(null);
  prismaMock.configuracion.findUnique.mockResolvedValue(null);
  listarAlmacenesMock.mockResolvedValue([{ codigo: 'MD01_LUZ', nombre: 'ALMACEN DISPONIBLE MARKET LUZURIAGA' }]);
});

describe('listar: el conteo no incluye auditores ni cuentas deshabilitadas', () => {
  it('cuenta solo roles de tienda (coordinador/conteo) y activos', async () => {
    await listar();

    const args = prismaMock.sucursal.findMany.mock.calls[0]?.[0];
    expect(args.include._count.select.colaboradores).toEqual(PERSONAL_DE_TIENDA);
  });

  it('es EXACTAMENTE el mismo filtro que el login: la misma tienda no puede dar 11 acá y 9 allá', async () => {
    await listar();
    await listarSucursales();

    const tiendas = prismaMock.sucursal.findMany.mock.calls[0]?.[0].include._count.select.colaboradores;
    const login = prismaMock.sucursal.findMany.mock.calls[1]?.[0].include._count.select.colaboradores;
    expect(tiendas).toEqual(login);
  });

  it('el DTO expone el conteo ya filtrado, tal cual lo devolvió la base', async () => {
    const [tienda] = await listar();
    expect(tienda?.colaboradores).toBe(9);
  });
});

/**
 * Las tres consultas del modulo devuelven el MISMO DTO: si una se quedara con
 * el conteo sin filtrar, la pantalla mostraria un numero distinto justo
 * despues de crear o editar una tienda que al recargar la lista.
 */
describe('crear y actualizar devuelven el mismo conteo filtrado', () => {
  it('crear', async () => {
    await crear(ADMIN, { nombre: 'Tienda nueva' });

    const args = prismaMock.sucursal.create.mock.calls[0]?.[0];
    expect(args.include._count.select.colaboradores).toEqual(PERSONAL_DE_TIENDA);
  });

  it('actualizar', async () => {
    await actualizar(ADMIN, 1, { nombre: 'Nombre nuevo' });

    const args = prismaMock.sucursal.update.mock.calls[0]?.[0];
    expect(args.include._count.select.colaboradores).toEqual(PERSONAL_DE_TIENDA);
  });
});
