/**
 * Tests de los pasos 2 y 3 del wizard del Coordinador.
 *
 * Las reglas de particion, orden y reparto se prueban aparte, sin base
 * (src/dominio/lote.test.ts). Lo que se prueba ACA es lo que solo puede
 * fallar contra Prisma: que se pida la operacion correcta, que las guardas
 * de negocio corten antes de escribir, y que el ORDEN de las personas se
 * respete -- ese ultimo es un contrato declarado en el adaptador del movil
 * que un `orderBy: id` rompe en silencio.
 *
 * Prisma mockeado: `npm test` no levanta Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  hojaConteo: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
  producto: { deleteMany: vi.fn() },
  empaque: { deleteMany: vi.fn() },
  conteo: { count: vi.fn() },
  colaborador: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { Conflicto, NoEncontrado, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { activo, asignarHojas, crearHojas } from './inventarios.service';

const COORD: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };

const item = (codigo: string, categoria: string | null) => ({
  id: Number(codigo),
  codigo,
  codigoBarras: `BC${codigo}`,
  descripcion: `Producto ${codigo}`,
  categoria,
  empaques: [{ nombre: 'U', factor: 1, orden: 0, codigoBarras: null }],
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'en_curso' });
  prismaMock.conteo.count.mockResolvedValue(0);
  prismaMock.hojaConteo.findMany.mockResolvedValue([]);
  // La transaccion corre la callback con el mismo mock: lo que importa es
  // QUE operaciones se piden, no que Postgres las aplique.
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prismaMock) : arg,
  );
});

describe('crearHojas', () => {
  it('parte los items en hojas del tamaño pedido', async () => {
    prismaMock.catalogoItem.findMany.mockResolvedValue([
      item('300', 'GALLETAS'),
      item('100', 'ABARROTES'),
      item('200', 'ABARROTES'),
    ]);

    await crearHojas(COORD, 9, 20);

    expect(prismaMock.hojaConteo.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.hojaConteo.create.mock.calls[0]![0] as {
      data: { numero: string; zona: string; tamano: number; productos: { create: Array<{ codigo: string }> } };
    };
    expect(data.numero).toBe('001');
    // `tamano` es CUANTOS ITEMS TIENE la hoja (3), no el 20 que se pidio.
    // Ver el test de la hoja parcial, mas abajo: ahi esta el caso que
    // importa, y este `expect` documenta la misma regla en el caso simple.
    expect(data.tamano).toBe(3);
    // 2 de ABARROTES contra 1 de GALLETAS: la dominante rotula la hoja.
    expect(data.zona).toBe('ABARROTES');
    // Y el ORDEN dentro de la hoja es por categoria, no por codigo.
    expect(data.productos.create.map((p) => p.codigo)).toEqual(['100', '200', '300']);
  });

  /**
   * EL CONTEO CIEGO, verificado y no asumido. Si algun dia alguien copia
   * `stockErp` o `precioVenta` de CatalogoItem a Producto "para tenerlo a
   * mano", este test se pone rojo. Un Contador que ve el stock antes de
   * contar deja de estar contando: esta confirmando.
   */
  it('NO copia stock ni precio del catalogo al producto', async () => {
    prismaMock.catalogoItem.findMany.mockResolvedValue([
      { ...item('100', 'ABARROTES'), stockErp: 42, precioVenta: 9.9, esEmpresa: true },
    ]);

    await crearHojas(COORD, 9, 50);

    const { data } = prismaMock.hojaConteo.create.mock.calls[0]![0] as {
      data: { productos: { create: Array<Record<string, unknown>> } };
    };
    const producto = data.productos.create[0]!;
    expect(producto).not.toHaveProperty('stockErp');
    expect(producto).not.toHaveProperty('precioVenta');
    expect(producto).not.toHaveProperty('esEmpresa');
  });

  /**
   * EL CASO QUE CAUSABA EL BUG EN LA GONDOLA.
   *
   * `tamano` guardaba el 20/30/50 pedido en TODAS las hojas, incluida la
   * ultima, que casi siempre queda parcial. El movil confiaba en ese campo
   * y le mostraba a la persona "36 / 50 Productos" con todo contado, y al
   * cerrar "quedan 14 items sin contar" cuando no quedaba ninguno.
   *
   * Con 5 items en hojas de 2: la ultima tiene 1, y tiene que decir 1.
   */
  it('la ultima hoja guarda SU tamaño real, no el pedido', async () => {
    prismaMock.catalogoItem.findMany.mockResolvedValue([
      item('100', 'A'),
      item('200', 'A'),
      item('300', 'B'),
      item('400', 'B'),
      item('500', 'C'),
    ]);

    await crearHojas(COORD, 9, 2);

    const tamanos = prismaMock.hojaConteo.create.mock.calls.map(
      ([a]) => (a as { data: { tamano: number; productos: { create: unknown[] } } }).data,
    );
    expect(tamanos.map((d) => d.tamano)).toEqual([2, 2, 1]);
    // Y coincide con los productos que de verdad se crearon en cada una.
    for (const d of tamanos) expect(d.tamano).toBe(d.productos.create.length);
  });

  it('borra las hojas anteriores antes de rehacer', async () => {
    prismaMock.catalogoItem.findMany.mockResolvedValue([item('100', 'A')]);

    await crearHojas(COORD, 9, 50);

    expect(prismaMock.hojaConteo.deleteMany).toHaveBeenCalledWith({ where: { inventarioId: 9 } });
    expect(prismaMock.producto.deleteMany).toHaveBeenCalled();
  });

  /** El limite entre "todavia estoy armando" y "ya arrancamos". */
  it('NO rehace si ya hay conteos cargados: 409 en vez de borrar trabajo', async () => {
    prismaMock.conteo.count.mockResolvedValue(12);

    await expect(crearHojas(COORD, 9, 50)).rejects.toThrow(Conflicto);
    expect(prismaMock.hojaConteo.deleteMany).not.toHaveBeenCalled();
  });

  it('sin items pide traer el catalogo primero', async () => {
    prismaMock.catalogoItem.findMany.mockResolvedValue([]);
    await expect(crearHojas(COORD, 9, 50)).rejects.toThrow(SolicitudInvalida);
  });

  it('un inventario cerrado no acepta hojas nuevas', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'cerrado' });
    await expect(crearHojas(COORD, 9, 50)).rejects.toThrow(Conflicto);
  });

  /** Un Coordinador no arma el lote de OTRA tienda. */
  it('el inventario de otra sucursal es 404, no 403', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 77, estado: 'en_curso' });
    await expect(crearHojas(COORD, 9, 50)).rejects.toThrow(NoEncontrado);
  });

  it('el administrador SI entra a cualquier sucursal', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 77, estado: 'en_curso' });
    prismaMock.catalogoItem.findMany.mockResolvedValue([item('100', 'A')]);
    const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };

    await expect(crearHojas(admin, 9, 50)).resolves.toBeDefined();
  });

  /** El historico tiene que decir con cuantos items por hoja se conto ese mes. */
  it('guarda el tamaño en el inventario, no solo en cada hoja', async () => {
    prismaMock.catalogoItem.findMany.mockResolvedValue([item('100', 'A')]);

    await crearHojas(COORD, 9, 30);

    expect(prismaMock.inventario.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { tamanoHoja: 30 } });
  });
});

describe('asignarHojas', () => {
  /**
   * `hojaConteo.findMany` se llama DOS veces con propositos distintos: para
   * buscar las hojas sin asignar (`select: {id}`) y para devolver el listado
   * completo al final (`include: INCLUIR_TODO`). Un solo `mockResolvedValue`
   * servia a las dos y rompia la segunda, que espera hojas con productos.
   */
  function hojasLibres(ids: number[]): void {
    prismaMock.hojaConteo.findMany.mockImplementation(async (args: unknown) => {
      const a = args as { where?: { asignadoAId?: null } };
      return a.where?.asignadoAId === null ? ids.map((id) => ({ id })) : [];
    });
  }

  beforeEach(() => {
    hojasLibres([1, 2, 3, 4]);
    // Prisma devuelve las filas en el orden que quiere, NO en el del `in`:
    // el mock lo refleja a proposito para que el test del orden valga algo.
    prismaMock.colaborador.findMany.mockResolvedValue([
      { id: 20, nombre: 'Beto' },
      { id: 10, nombre: 'Ana' },
    ]);
  });

  /**
   * EL CONTRATO QUE UN `orderBy: id` ROMPE EN SILENCIO. El adaptador del
   * movil declara que el primero del array se lleva el primer bloque; con
   * las hojas ordenadas por categoria, ese bloque es el primer tramo del
   * recorrido. Si el service reordenara por id, el reparto seria valido pero
   * no el que el Coordinador pidio, y nadie se enteraria.
   */
  it('respeta el ORDEN del array, no el id', async () => {
    // Se pide Beto (20) primero, Ana (10) segunda -- al reves del id.
    await asignarHojas(COORD, 9, [20, 10]);

    const updates = prismaMock.hojaConteo.update.mock.calls.map(([a]) => a as { where: { id: number }; data: { asignadoAId: number } });
    // Beto se lleva las dos primeras hojas, Ana las dos ultimas.
    expect(updates.find((u) => u.where.id === 1)!.data.asignadoAId).toBe(20);
    expect(updates.find((u) => u.where.id === 2)!.data.asignadoAId).toBe(20);
    expect(updates.find((u) => u.where.id === 3)!.data.asignadoAId).toBe(10);
    expect(updates.find((u) => u.where.id === 4)!.data.asignadoAId).toBe(10);
  });

  /** Solo las SIN asignar: quien ya empezo a contar no pierde sus hojas. */
  it('solo reparte las hojas sin asignar', async () => {
    await asignarHojas(COORD, 9, [10, 20]);

    expect(prismaMock.hojaConteo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inventarioId: 9, asignadoAId: null } }),
    );
  });

  /** Una hoja asignada a alguien de otra tienda es una gondola que nadie cuenta. */
  it('rechaza personas que no son de esta tienda', async () => {
    prismaMock.colaborador.findMany.mockResolvedValue([{ id: 10, nombre: 'Ana' }]);
    await expect(asignarHojas(COORD, 9, [10, 999])).rejects.toThrow(SolicitudInvalida);
  });

  it('sin personas no reparte', async () => {
    await expect(asignarHojas(COORD, 9, [])).rejects.toThrow(SolicitudInvalida);
  });

  it('sin hojas libres avisa en vez de no hacer nada en silencio', async () => {
    hojasLibres([]);
    prismaMock.colaborador.findMany.mockResolvedValue([{ id: 10, nombre: 'Ana' }]);
    await expect(asignarHojas(COORD, 9, [10])).rejects.toThrow(Conflicto);
  });
});

describe('activo', () => {
  it('sin inventario en curso devuelve null, no error', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(null);
    expect(await activo(1)).toBeNull();
  });

  /**
   * `tamanoHoja` tiene default 50 en la base: sin hojas, devolverlo diria
   * "hojas de 50" cuando no hay ninguna. `rondaActiva` sigue el mismo
   * criterio -- sin hojas no hay ninguna fila de la que sacar un maximo.
   */
  it('sin hojas creadas, tamanoHoja y rondaActiva son null, no el default de la base', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue({
      id: 9,
      snapshotItems: 1548,
      snapshotTomadoEn: new Date('2026-09-04T10:00:00Z'),
      createdAt: new Date('2026-09-04T09:00:00Z'),
      tamanoHoja: 50,
      _count: { hojas: 0 },
    });

    const r = await activo(1);

    expect(r!.tamanoHoja).toBeNull();
    expect(r!.totalHojas).toBe(0);
    expect(r!.items).toBe(1548);
    expect(r!.rondaActiva).toBeNull();
    // Sin hojas no hay maximo que pedir: ni siquiera se consulta.
    expect(prismaMock.hojaConteo.aggregate).not.toHaveBeenCalled();
  });

  it('con hojas creadas devuelve el tamaño real y la ronda con mas hojas', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue({
      id: 9,
      snapshotItems: 1548,
      snapshotTomadoEn: new Date('2026-09-04T10:00:00Z'),
      createdAt: new Date(),
      tamanoHoja: 30,
      _count: { hojas: 52 },
    });
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 1 } });

    const r = await activo(1);

    expect(r!.tamanoHoja).toBe(30);
    expect(r!.totalHojas).toBe(52);
    expect(r!.rondaActiva).toBe(1);
    expect(prismaMock.hojaConteo.aggregate).toHaveBeenCalledWith({
      where: { inventarioId: 9 },
      _max: { numeroConteo: true },
    });
  });

  /**
   * EL CASO LIMITE QUE ESTE CAMPO NO DISTINGUE, a proposito (ver el
   * comentario largo de `InventarioActivoDto.rondaActiva`): la ronda 3 (la
   * ultima del ciclo) se cerro sin abrir una ronda 4 -- el inventario
   * sigue en_curso, esa ronda ya no admite mas conteo, y rondaActiva sigue
   * devolviendo 3 igual, porque es la ronda mas alta que existe de verdad.
   * No inventa un "esta cerrada" que el modelo no persiste.
   */
  it('devuelve la ronda mas alta que existe aunque esa ronda ya este cerrada', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue({
      id: 9,
      snapshotItems: 1548,
      snapshotTomadoEn: new Date(),
      createdAt: new Date(),
      tamanoHoja: 30,
      _count: { hojas: 3 },
    });
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 3 } });

    const r = await activo(1);

    expect(r!.rondaActiva).toBe(3);
  });

  it('solo mira inventarios EN CURSO, no el ultimo cerrado', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(null);
    await activo(1);
    expect(prismaMock.inventario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sucursalId: 1, estado: 'en_curso' } }),
    );
  });
});
