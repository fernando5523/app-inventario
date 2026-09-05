/**
 * Tests de las dos reglas que el servidor tiene que hacer cumplir SI O SI:
 * idempotencia al reintentar y hoja finalizada inmutable.
 *
 * Prisma esta mockeado -- no hace falta Postgres, igual que el resto de la
 * suite (`npm test` no levanta base). Lo que se prueba no es que Prisma
 * escriba: es que el service pida la operacion CORRECTA.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.hoisted` y no un `const` suelto: vitest sube el `vi.mock` al tope del
 * archivo, asi que una constante declarada arriba todavia no existe cuando
 * la factory corre. Esto la sube junto con el mock.
 */
const prismaMock = vi.hoisted(() => ({
  hojaConteo: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  producto: { findFirst: vi.fn() },
  conteo: { upsert: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { Conflicto } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { aHojaDto, finalizar, guardarConteo } from './hojas.service';

const CONTADOR: ColaboradorAutenticado = { colaboradorId: 10, sucursalId: 1, rol: 'conteo' };

const CONTEO = {
  empaques: [{ empaqueNombre: 'Plancha', cantidad: 2 }],
  sueltas: 5,
  confirmadoPorEscaner: true,
  contadoEn: new Date('2026-09-03T10:00:00.000Z'),
};

function hoja(estado: 'pendiente' | 'en_proceso' | 'finalizada') {
  return {
    id: 7,
    estado,
    asignadoAId: 10,
    asignadoA2Id: null,
    inventario: { sucursalId: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.producto.findFirst.mockResolvedValue({ id: 51, empaques: [{ nombre: 'Plancha', factor: 24 }] });
  prismaMock.conteo.upsert.mockResolvedValue({ productoId: 51, ...CONTEO });
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

describe('idempotencia: la cola offline reintenta y no puede duplicar', () => {
  it('escribe con upsert sobre la clave (hoja, producto), no con create', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('pendiente'));

    await guardarConteo(CONTADOR, 7, 51, CONTEO);

    expect(prismaMock.conteo.upsert).toHaveBeenCalledTimes(1);
    const args = prismaMock.conteo.upsert.mock.calls[0]![0];
    // La identidad de un conteo ES el par (hoja, producto). Con un create por
    // envio, cada reintento del WiFi seria una fila mas y el inventario
    // quedaria contando dos veces lo mismo.
    expect(args.where).toEqual({ hojaId_productoId: { hojaId: 7, productoId: 51 } });
  });

  it('el mismo conteo enviado tres veces deja el mismo estado', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('en_proceso'));

    const r1 = await guardarConteo(CONTADOR, 7, 51, CONTEO);
    const r2 = await guardarConteo(CONTADOR, 7, 51, CONTEO);
    const r3 = await guardarConteo(CONTADOR, 7, 51, CONTEO);

    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
    // Tres envios, tres upserts sobre LA MISMA clave: una sola fila.
    const claves = prismaMock.conteo.upsert.mock.calls.map((c) => c[0].where);
    expect(new Set(claves.map((k) => JSON.stringify(k))).size).toBe(1);
  });

  it('finalizar dos veces no falla: la cola tambien reintenta eso', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue({
      ...hoja('finalizada'),
      inventarioId: 1,
      numero: '002',
      zona: 'Abarrotes',
      gondola: 'A2',
      tamano: 50,
      sync: 'sincronizado',
      asignadoA: { nombre: 'Maria Rojas' },
      asignadoA2: null,
      productos: [],
      conteos: [],
    });

    await expect(finalizar(CONTADOR, 7)).resolves.toMatchObject({ estado: 'finalizada' });
    // Ya estaba finalizada: no se vuelve a escribir.
    expect(prismaMock.hojaConteo.update).not.toHaveBeenCalled();
  });
});

describe('una hoja finalizada es inmutable', () => {
  it('rechaza el conteo con 409, no con 400', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('finalizada'));

    const error = await guardarConteo(CONTADOR, 7, 51, CONTEO).catch((e) => e);

    expect(error).toBeInstanceOf(Conflicto);
    // 409 y no 400: el dato del telefono NO esta mal, puede ser un conteo
    // valido que quedo en la cola offline y llego tarde. Es un conflicto de
    // estado, y la app necesita distinguirlo para saber que hacer con un
    // dato que ya tenia guardado local.
    expect(error.status).toBe(409);
  });

  it('y no escribe NADA cuando rechaza', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('finalizada'));

    await guardarConteo(CONTADOR, 7, 51, CONTEO).catch(() => undefined);

    expect(prismaMock.conteo.upsert).not.toHaveBeenCalled();
    expect(prismaMock.hojaConteo.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('INVESTIGACIÓN (sin arreglar): finalizar() no sabe si quedó algún producto sin contar', () => {
  // Pregunta del hallazgo: "el Contador cuenta SIN RED, el Coordinador
  // cierra la ronda, y recién después la cola sincroniza un conteo de una
  // ronda que ya no está abierta -- ¿el servidor lo acepta, lo rechaza,
  // recalcula?". Este test prueba la otra mitad, la que hace posible que
  // el Coordinador llegue a cerrar SIN saber que falta un producto:
  // `finalizar()` no consulta `producto` ni `conteo` para decidir --
  // selecciona solo `{ id, estado, asignadoAId, asignadoA2Id, inventario }`
  // (ver hojas.service.ts, la función `finalizar`) y marca
  // `sync: 'sincronizado'` sin preguntar si algún renglón quedó sin
  // Conteo. `rondas.service.ts#cerrar` (hojasSinSincronizar) solo mira
  // ESTE campo de la hoja, nunca sus productos -- así que un producto
  // cuyo conteo se rechazó camino al servidor (ver hojas-sqlite.test.ts,
  // mismo hallazgo del lado del teléfono) puede quedar afuera del cierre
  // sin que nada lo detecte acá.
  it('marca sync: sincronizado sin verificar que todos los productos tengan un Conteo', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue({
      ...hoja('en_proceso'),
      inventarioId: 1,
      numero: '002',
      zona: 'Abarrotes',
      gondola: 'A2',
      tamano: 50,
      sync: 'local',
      asignadoA: { nombre: 'Maria Rojas' },
      asignadoA2: null,
      // A propósito vacíos: si finalizar() los necesitara para decidir
      // algo, este test tendría que mockearlos con contenido real. No los
      // usa -- y ESE es el hallazgo, no un detalle del mock.
      productos: [],
      conteos: [],
    });

    await finalizar(CONTADOR, 7);

    expect(prismaMock.hojaConteo.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { estado: 'finalizada', sync: 'sincronizado' },
    });
    // Ninguna consulta a producto/conteo se hizo para decidir esto --
    // finalizar() no tiene forma de saber si falta un renglón.
    expect(prismaMock.producto.findFirst).not.toHaveBeenCalled();
  });
});

describe('aHojaDto: el DTO manda el ID de cada asignado, no solo el nombre', () => {
  // Endurecimiento pedido tras el hallazgo de "hojas cruzadas sin red"
  // (2026-09-06): el filtro local de `mias()` (mobile/hojas-sqlite.ts)
  // solo tenía el NOMBRE para decidir "esta hoja es mía" -- frágil ante
  // un homónimo entre dos sucursales, un cambio de nombre, o alguien que
  // literalmente se llame igual que un rol ("Conteo"). El id es la
  // identidad dura que el backend ya tiene (`Colaborador.id`) y nunca
  // cambia ni se repite; los nombres se conservan para MOSTRAR, no para
  // filtrar.
  function hojaCompleta(asignadoA: { id: number; nombre: string } | null, asignadoA2: { id: number; nombre: string } | null) {
    return {
      id: 42,
      inventarioId: 1,
      numero: '007',
      zona: 'Lácteos',
      gondola: 'B3',
      tamano: 50,
      estado: 'en_proceso' as const,
      sync: 'local' as const,
      asignadoA,
      asignadoA2,
      productos: [],
      conteos: [],
    };
  }

  it('con dos asignados: manda asignadoAId y asignadoA2Id, en el mismo orden que los nombres', () => {
    const dto = aHojaDto(hojaCompleta({ id: 501, nombre: 'María Rojas' }, { id: 502, nombre: 'Luis Shuan' }));

    expect(dto.asignados).toEqual(['María Rojas', 'Luis Shuan']);
    expect(dto.asignadoAId).toBe(501);
    expect(dto.asignadoA2Id).toBe(502);
  });

  it('con un solo asignado: el segundo id es null, no undefined ni 0', () => {
    const dto = aHojaDto(hojaCompleta({ id: 501, nombre: 'María Rojas' }, null));

    expect(dto.asignados).toEqual(['María Rojas']);
    expect(dto.asignadoAId).toBe(501);
    expect(dto.asignadoA2Id).toBeNull();
  });

  it('sin nadie asignado: los dos ids son null', () => {
    const dto = aHojaDto(hojaCompleta(null, null));

    expect(dto.asignados).toEqual([]);
    expect(dto.asignadoAId).toBeNull();
    expect(dto.asignadoA2Id).toBeNull();
  });

  it('INCLUIR_TODO pide el id además del nombre para los dos asignados', async () => {
    const { INCLUIR_TODO } = await import('./hojas.service');
    expect(INCLUIR_TODO.asignadoA).toEqual({ select: { id: true, nombre: true } });
    expect(INCLUIR_TODO.asignadoA2).toEqual({ select: { id: true, nombre: true } });
  });
});

/**
 * `productosSinConteo`: con qué valida el Coordinador antes de cerrar la
 * ronda. Decisión del cliente: un FILTRO en Gestión de hojas, no una
 * notificación — así que el número tiene que venir por hoja, para poder
 * ordenar y filtrar por él sin abrir ninguna.
 */
describe('aHojaDto: cuántos productos quedaron sin contar', () => {
  const prod = (id: number) => ({
    id,
    codigo: `IT-${id}`,
    codigoBarras: `BC${id}`,
    descripcion: `Producto ${id}`,
    categoria: null,
    empaques: [],
  });
  const conteo = (productoId: number) => ({
    productoId,
    empaques: [],
    sueltas: 3,
    confirmadoPorEscaner: false,
    contadoEn: new Date('2026-09-06T10:00:00.000Z'),
  });

  function hojaCon(productos: number[], contados: number[], estado: 'pendiente' | 'en_proceso' | 'finalizada' = 'en_proceso') {
    return {
      id: 42,
      inventarioId: 1,
      numero: '007',
      zona: 'Lácteos',
      gondola: 'B3',
      tamano: 50,
      estado,
      sync: 'local' as const,
      asignadoA: null,
      asignadoA2: null,
      productos: productos.map(prod),
      conteos: contados.map(conteo),
    };
  }

  it('cuenta los productos que no tienen ningún conteo', () => {
    // 5 productos, 2 contados -> faltan 3.
    expect(aHojaDto(hojaCon([1, 2, 3, 4, 5], [1, 3]) as never).productosSinConteo).toBe(3);
  });

  it('con todo contado es 0', () => {
    expect(aHojaDto(hojaCon([1, 2, 3], [1, 2, 3]) as never).productosSinConteo).toBe(0);
  });

  it('sin ningún conteo, faltan todos', () => {
    expect(aHojaDto(hojaCon([1, 2, 3], []) as never).productosSinConteo).toBe(3);
  });

  it('una hoja sin productos da 0, no NaN', () => {
    expect(aHojaDto(hojaCon([], []) as never).productosSinConteo).toBe(0);
  });

  /**
   * El conteo de un producto que ya no está en la hoja NO puede restar de
   * más: se cuenta por PRODUCTO existente, no por diferencia de longitudes.
   * `productos.length - conteos.length` daría -1 acá.
   */
  it('un conteo huérfano no hace bajar el número por debajo de 0', () => {
    expect(aHojaDto(hojaCon([1, 2], [1, 2, 999]) as never).productosSinConteo).toBe(0);
  });

  it('el número viene por hoja aunque la hoja esté finalizada', () => {
    // `finalizar` (min-4) va a registrar 0 en los que falten, así que una
    // finalizada debería terminar en 0 -- pero las cerradas ANTES de ese
    // cambio pueden traer N > 0, y el DTO dice la verdad de lo que hay.
    expect(aHojaDto(hojaCon([1, 2, 3], [1], 'finalizada') as never).productosSinConteo).toBe(2);
  });
});

describe('el total se calcula, nunca se guarda', () => {
  it('devuelve la suma de cada linea (cantidad x factor) mas las sueltas', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('en_proceso'));

    const { conteo, total } = await guardarConteo(CONTADOR, 7, 51, CONTEO);

    expect(total).toBe(2 * 24 + 5); // 53, el caso de la maqueta
    // Y no se persiste: lo que se manda a la base son las PARTES.
    expect(prismaMock.conteo.upsert.mock.calls[0]![0].create).not.toHaveProperty('total');
    expect(conteo).not.toHaveProperty('total');
  });

  it('reemplaza la lista de lineas ENTERA en cada guardado (deleteMany + create, no un merge)', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('en_proceso'));

    await guardarConteo(CONTADOR, 7, 51, CONTEO);

    const update = prismaMock.conteo.upsert.mock.calls[0]![0].update;
    expect(update.empaques).toEqual({ deleteMany: {}, create: [{ empaqueNombre: 'Plancha', cantidad: 2 }] });
  });
});

describe('una linea no puede referenciar un empaque que el producto no tiene', () => {
  it('rechaza con 400 (SolicitudInvalida), no con 500', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('en_proceso'));
    prismaMock.producto.findFirst.mockResolvedValue({ id: 51, empaques: [{ nombre: 'Caja', factor: 12 }] });

    const conteoConEmpaqueInexistente = { ...CONTEO, empaques: [{ empaqueNombre: 'Fardo', cantidad: 1 }] };
    const error = await guardarConteo(CONTADOR, 7, 51, conteoConEmpaqueInexistente).catch((e) => e);

    expect(error.status).toBe(400);
  });

  it('y no escribe NADA cuando rechaza', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('en_proceso'));
    prismaMock.producto.findFirst.mockResolvedValue({ id: 51, empaques: [{ nombre: 'Caja', factor: 12 }] });

    const conteoConEmpaqueInexistente = { ...CONTEO, empaques: [{ empaqueNombre: 'Fardo', cantidad: 1 }] };
    await guardarConteo(CONTADOR, 7, 51, conteoConEmpaqueInexistente).catch(() => undefined);

    expect(prismaMock.conteo.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
