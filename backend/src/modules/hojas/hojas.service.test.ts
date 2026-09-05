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
import { finalizar, guardarConteo } from './hojas.service';

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
