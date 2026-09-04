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
  empaques: 2,
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
  prismaMock.producto.findFirst.mockResolvedValue({ id: 51, empaqueFactor: 24 });
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

describe('el total se calcula, nunca se guarda', () => {
  it('devuelve empaques x factor + sueltas', async () => {
    prismaMock.hojaConteo.findUnique.mockResolvedValue(hoja('en_proceso'));

    const { conteo, total } = await guardarConteo(CONTADOR, 7, 51, CONTEO);

    expect(total).toBe(2 * 24 + 5); // 53, el caso de la maqueta
    // Y no se persiste: lo que se manda a la base son las PARTES.
    expect(prismaMock.conteo.upsert.mock.calls[0]![0].create).not.toHaveProperty('total');
    expect(conteo).not.toHaveProperty('total');
  });
});
