/**
 * Tests del alta automatica de almacen: cuando se da de alta una tienda con
 * un almacen que todavia no estaba habilitado para inventario, queda
 * habilitado.
 *
 * POR QUE SE PRUEBA LA INTEGRACION Y NO SOLO `agregar()`: la funcion pura ya
 * tiene sus tests (d365.almacenes-inventario.test.ts). Lo que puede fallar
 * en silencio es la CONEXION -- que `crear()` no la llame, o la llame antes
 * de persistir, o la llame tambien cuando el almacen se desasocia. Ninguna
 * de esas tres cosas la ve un test de la funcion sola.
 *
 * Es el mismo tipo de agujero que dejo a `d365-auth.service.ts` leyendo el
 * `.env` mientras `credencialesEfectivas()` pasaba sus tests: la pieza
 * andaba, no estaba enchufada.
 *
 * Prisma mockeado, sin base (igual que el resto de la suite).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  sucursal: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  configuracion: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

const auditoriaMock = vi.hoisted(() => vi.fn());
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: auditoriaMock }));

/** La lista real de Dynamics, para que `verificarAlmacen` resuelva. */
const listarAlmacenesMock = vi.hoisted(() => vi.fn());
vi.mock('../d365/d365-catalogo.service', () => ({ listarAlmacenes: listarAlmacenesMock }));

import { CLAVE_ALMACENES } from '../d365/d365.almacenes-inventario';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { actualizar, crear } from './tiendas.service';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };

/** Los diez habilitados hoy. MD07_CEN NO esta: es el que se usa para probar. */
const HABILITADOS = 'MD01_LUZ,MD02_JRC,MD03_CRH,MD04_SUC,MD05_CRZ,MD06_BOL,MD08_RAY,MD09_R351,MD10,MD11_CENT';

function sucursalCreada(almacenId: string | null) {
  return {
    id: 7,
    nombre: 'Tienda nueva',
    direccion: null,
    telefono: null,
    activa: true,
    almacenId,
    almacenNombre: almacenId,
    _count: { colaboradores: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listarAlmacenesMock.mockResolvedValue([
    { codigo: 'MD01_LUZ', nombre: 'ALMACÉN DISPONIBLE MARKET LUZURIAGA' },
    { codigo: 'MD07_CEN', nombre: 'ALMACÉN DISPONIBLE MARKET CENTER' },
    { codigo: 'MD12_NUEVA', nombre: 'ALMACÉN DISPONIBLE MARKET NUEVA' },
  ]);
  prismaMock.configuracion.findUnique.mockResolvedValue({ id: 4, clave: CLAVE_ALMACENES, valor: HABILITADOS });
  prismaMock.configuracion.update.mockResolvedValue({});
});

describe('crear: alta automatica del almacen', () => {
  it('un almacen que NO estaba habilitado queda habilitado', async () => {
    prismaMock.sucursal.create.mockResolvedValue(sucursalCreada('MD12_NUEVA'));

    await crear(ADMIN, { nombre: 'Tienda nueva', almacenId: 'MD12_NUEVA' });

    expect(prismaMock.configuracion.update).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.configuracion.update.mock.calls[0]![0] as { data: { valor: string } };
    expect(data.valor.split(',')).toContain('MD12_NUEVA');
    // Y no se pierde ninguno de los diez que ya estaban.
    for (const previo of HABILITADOS.split(',')) expect(data.valor.split(',')).toContain(previo);
  });

  /**
   * Sin esto, cada alta de tienda escribiria la misma lista en la base y
   * ensuciaria la auditoria con cambios que no cambian nada.
   */
  it('un almacen que YA estaba habilitado no reescribe la configuracion', async () => {
    prismaMock.sucursal.create.mockResolvedValue(sucursalCreada('MD01_LUZ'));

    await crear(ADMIN, { nombre: 'Otra', almacenId: 'MD01_LUZ' });

    expect(prismaMock.configuracion.update).not.toHaveBeenCalled();
  });

  it('una tienda SIN almacen no toca la lista', async () => {
    prismaMock.sucursal.create.mockResolvedValue(sucursalCreada(null));

    await crear(ADMIN, { nombre: 'Sin almacen' });

    expect(prismaMock.configuracion.update).not.toHaveBeenCalled();
  });

  /**
   * `verificarAlmacen` tiene que mirar los 70, no los 10: una tienda que abre
   * hoy tiene un almacen real que todavia no esta en la lista, y validarla
   * contra la lista filtrada la rechazaria diciendo que su almacen "no
   * existe" — que es mentira y no habria forma de rodearlo.
   */
  it('verifica el codigo contra TODOS los almacenes del ERP, no contra los habilitados', async () => {
    prismaMock.sucursal.create.mockResolvedValue(sucursalCreada('MD07_CEN'));

    await crear(ADMIN, { nombre: 'Center', almacenId: 'MD07_CEN' });

    expect(listarAlmacenesMock).toHaveBeenCalledWith({ todos: true });
  });
});

describe('actualizar: alta automatica del almacen', () => {
  beforeEach(() => {
    prismaMock.sucursal.findUnique.mockResolvedValue(sucursalCreada('MD01_LUZ'));
  });

  it('cambiar el almacen a uno nuevo lo habilita', async () => {
    prismaMock.sucursal.update.mockResolvedValue(sucursalCreada('MD12_NUEVA'));

    await actualizar(ADMIN, 7, { almacenId: 'MD12_NUEVA' });

    expect(prismaMock.configuracion.update).toHaveBeenCalledTimes(1);
  });

  /**
   * Desasociar NO saca el almacen de la lista: otra tienda puede estar
   * usandolo, y sacarlo la dejaria invisible en el selector sin que nadie
   * hubiera tocado esa otra tienda.
   */
  it('DESASOCIAR el almacen no lo saca de la lista', async () => {
    prismaMock.sucursal.update.mockResolvedValue(sucursalCreada(null));

    await actualizar(ADMIN, 7, { almacenId: null });

    expect(prismaMock.configuracion.update).not.toHaveBeenCalled();
  });

  it('editar solo el nombre no toca la lista', async () => {
    prismaMock.sucursal.update.mockResolvedValue(sucursalCreada('MD01_LUZ'));

    await actualizar(ADMIN, 7, { nombre: 'Nombre nuevo' });

    expect(prismaMock.configuracion.update).not.toHaveBeenCalled();
  });
});
