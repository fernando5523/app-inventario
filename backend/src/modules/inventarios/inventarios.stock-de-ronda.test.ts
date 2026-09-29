/**
 * `activo()` TIENE QUE DECIR SI LA RONDA ACTIVA YA BAJO SU STOCK DEL DIA.
 *
 * La pantalla del Coordinador decidia "paso 1 (Catalogo de Dynamics) hecho" con
 * `inventarioId !== null`: correcto para la ronda 1, y deja el paso en "hecho"
 * para siempre. Desde que cada reconteo baja su propio stock del ERP (decision
 * del cliente, 2026-09-29), en un reconteo el paso 1 tiene que VOLVER a estar
 * pendiente hasta que se descargue el stock de esa ronda -- y sin estos dos
 * campos la pantalla no tiene con que saberlo.
 *
 * LA RONDA 1 NO ES UN CASO ESPECIAL: se devuelve igual que las demas. Que
 * coincida con `items`/`tomadoEn` del snapshot es justamente la señal de eso.
 *
 * Prisma mockeado: `npm test` no levanta Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findFirst: vi.fn() },
  hojaConteo: { aggregate: vi.fn(), count: vi.fn() },
  stockRonda: { aggregate: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { activo } from './inventarios.service';

const TOMADO = new Date('2026-09-22T11:30:00.000Z');

/** `Inventario` como lo devuelve Prisma para `activo()`. */
const inventario = (hojas: number) => ({
  id: 8078,
  sucursalId: 1,
  estado: 'en_curso',
  snapshotItems: 985,
  snapshotTomadoEn: TOMADO,
  createdAt: TOMADO,
  tamanoHoja: 50,
  ultimaRondaCerrada: null,
  _count: { hojas },
});

/** Lo que devuelve `stockRonda.aggregate`: cuantas filas y de cuando. */
const descarga = (filas: number, tomadoEn: Date | null) => ({
  _count: { _all: filas },
  _max: { tomadoEn },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.hojaConteo.count.mockResolvedValue(0); // nada sin terminar
  prismaMock.stockRonda.aggregate.mockResolvedValue(descarga(0, null));
});

describe('activo(): el stock de la ronda activa', () => {
  it('la ronda 1 lo devuelve igual, y coincide con el snapshot', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(inventario(20));
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 1 } });
    prismaMock.stockRonda.aggregate.mockResolvedValue(descarga(985, TOMADO));

    const dto = await activo(1);
    expect(dto).toMatchObject({
      rondaActiva: 1,
      stockDeRondaItems: 985,
      stockDeRondaTomadoEn: TOMADO.toISOString(),
      // La coincidencia con el snapshot es la señal de que la ronda 1 no es un
      // caso especial: la pantalla decide sola que muestra.
      items: 985,
      tomadoEn: TOMADO.toISOString(),
    });
  });

  it('la ronda 2 SIN su descarga: los dos en null -- el paso 1 vuelve a estar pendiente', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(inventario(3));
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 2 } });
    prismaMock.stockRonda.aggregate.mockResolvedValue(descarga(0, null));

    const dto = await activo(1);
    expect(dto).toMatchObject({ rondaActiva: 2, stockDeRondaItems: null, stockDeRondaTomadoEn: null });
  });

  it('la ronda 2 CON su descarga: cuantos items y de cuando', async () => {
    const delReconteo = new Date('2026-09-23T09:05:00.000Z');
    prismaMock.inventario.findFirst.mockResolvedValue(inventario(3));
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 2 } });
    prismaMock.stockRonda.aggregate.mockResolvedValue(descarga(6, delReconteo));

    const dto = await activo(1);
    expect(dto).toMatchObject({
      rondaActiva: 2,
      stockDeRondaItems: 6,
      // NO el del snapshot: es la descarga del dia del reconteo.
      stockDeRondaTomadoEn: delReconteo.toISOString(),
    });
    expect(dto?.tomadoEn).toBe(TOMADO.toISOString());
  });

  it('PREGUNTA POR LA RONDA ACTIVA Y NO POR TODO EL INVENTARIO', async () => {
    // Sin el filtro por ronda contaria las 985 filas de la ronda 1 y la pantalla
    // daria el paso 1 por hecho en un reconteo que todavia no bajo nada.
    prismaMock.inventario.findFirst.mockResolvedValue(inventario(3));
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 2 } });

    await activo(1);
    expect(prismaMock.stockRonda.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inventarioId: 8078, numeroConteo: 2 } }),
    );
  });

  it('sin hojas todavia no se le pregunta nada a la tabla: no hay ronda de la cual', async () => {
    prismaMock.inventario.findFirst.mockResolvedValue(inventario(0));

    const dto = await activo(1);
    expect(dto).toMatchObject({ rondaActiva: null, stockDeRondaItems: null, stockDeRondaTomadoEn: null });
    expect(prismaMock.stockRonda.aggregate).not.toHaveBeenCalled();
  });
});
