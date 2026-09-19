/**
 * CORREGIR CON LA RONDA CERRADA SACA EL ITEM DE LA RONDA SIGUIENTE.
 *
 * Es la mitad que faltaba de para lo que el cliente pidio la correccion:
 * *"puedes corregirlo para que ya no salga en mi segundo conteo"*. Lo que
 * estos tests cuidan es el borde, que es donde esta toda la decision: se saca
 * SOLO si esa ronda todavia no arranco, porque no se le cambia la hoja a
 * alguien que ya la tiene en la mano.
 *
 * Prisma mockeado: se le pasa el mock como cliente de transaccion, que es
 * exactamente como lo llama `hojas.service.ts#corregirConteo`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  hojaConteo: { aggregate: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  producto: { findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn(), count: vi.fn() },
  catalogoItem: { findFirst: vi.fn(), findMany: vi.fn() },
  inventario: { findUnique: vi.fn(), update: vi.fn() },
  colaborador: { count: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

const registrarAuditoriaMock = vi.hoisted(() => vi.fn());
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: registrarAuditoriaMock }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { abrirRondaExtra, iniciarAjuste, sacarDeLaRondaSiguienteSiCuadro } from './rondas.service';

const INV = 9;
const CODIGO = 'A-1';
const STOCK = 10;
const ARGS = { inventarioId: INV, codigo: CODIGO, rondaCorregida: 1, actorId: 5 };

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: null, rol: 'auditor' };

/** Una hoja de la ronda siguiente, intacta: nadie la toco. */
const hojaIntacta = (id = 50) => ({ id, estado: 'pendiente' as const, _count: { conteos: 0 } });

/**
 * Lo que devuelve `producto.findMany` en `itemCuadra`: una fila por ronda en
 * la que el item aparece. `contado` null = esa ronda no tiene conteo.
 */
function productosPorRonda(...rondas: Array<{ ronda: number; contado: number | null }>) {
  return rondas.map((r) => ({
    hoja: { numeroConteo: r.ronda },
    empaques: [{ nombre: 'U', factor: 1 }],
    conteos: r.contado === null ? [] : [{ sueltas: r.contado, empaques: [] }],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 2 } });
  prismaMock.hojaConteo.findMany.mockResolvedValue([hojaIntacta()]);
  prismaMock.catalogoItem.findFirst.mockResolvedValue({ stockErp: STOCK });
  // Contado 10 en la ronda 1 (la corregida) y nada en la 2: manda el 10, que
  // es igual al stock -> cuadra.
  prismaMock.producto.findMany.mockResolvedValue(
    productosPorRonda({ ronda: 1, contado: STOCK }, { ronda: 2, contado: null }),
  );
  prismaMock.producto.findFirst.mockResolvedValue({ id: 200, hojaId: 50 });
  // Quedan otros productos en la hoja: no se borra.
  prismaMock.producto.count.mockResolvedValue(19);
  prismaMock.hojaConteo.count.mockResolvedValue(1);
});

describe('la ronda siguiente todavia no empezo: el item sale', () => {
  it('borra el Producto de esa ronda, buscado por CODIGO', async () => {
    const r = await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS);

    expect(prismaMock.producto.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { codigo: CODIGO, hoja: { inventarioId: INV, numeroConteo: 2 } } }),
    );
    expect(prismaMock.producto.delete).toHaveBeenCalledWith({ where: { id: 200 } });
    expect(r).toMatchObject({ codigo: CODIGO, ronda: 2, hojaId: 50, hojaBorrada: false, rondaBorrada: false });
  });

  /**
   * `tamano` es CUANTOS ITEMS TIENE ESTA HOJA. Dejarlo quieto reintroduce el
   * bug que esa columna vino a arreglar: la persona veria "19 / 20 Productos"
   * con la hoja entera hecha, y al cerrar "queda 1 sin contar" cuando no
   * queda ninguno.
   */
  it('baja `tamano` al numero de productos que de verdad quedan', async () => {
    await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS);

    expect(prismaMock.hojaConteo.update).toHaveBeenCalledWith({ where: { id: 50 }, data: { tamano: 19 } });
  });

  /**
   * Hecho PROPIO, no un campo dentro de `conteo.corregido`: seis meses
   * despues alguien va a preguntar por que la hoja tiene 19 renglones y no 20.
   */
  it('lo audita como un hecho aparte, y DENTRO de la transaccion', async () => {
    await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS);

    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'inventario.item_salio_de_ronda',
        entidad: 'inventario',
        entidadId: INV,
        detalle: expect.objectContaining({ codigo: CODIGO, ronda: 2, hojaId: 50, hojaBorrada: false, rondaBorrada: false }),
      }),
      prismaMock,
    );
  });
});

describe('la ronda siguiente YA empezo: no se toca nada', () => {
  /** El caso que cubren los conteos y el estado no. */
  it('con UN conteo cargado en otro producto de la ronda, no sale nada', async () => {
    prismaMock.hojaConteo.findMany.mockResolvedValue([
      hojaIntacta(50),
      { id: 51, estado: 'pendiente' as const, _count: { conteos: 1 } },
    ]);

    expect(await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS)).toBeNull();
    expect(prismaMock.producto.delete).not.toHaveBeenCalled();
  });

  /**
   * El caso que cubre el estado y los conteos no: alguien abrio la hoja y
   * esta caminando la gondola sin cargar nada. POR RONDA, no por producto:
   * con 9 hojas intactas y 1 en proceso, no se saca nada de ninguna.
   */
  it('con las demas pendientes pero UNA en proceso, no sale nada', async () => {
    prismaMock.hojaConteo.findMany.mockResolvedValue([
      hojaIntacta(50),
      { id: 51, estado: 'en_proceso' as const, _count: { conteos: 0 } },
    ]);

    expect(await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS)).toBeNull();
    expect(prismaMock.producto.delete).not.toHaveBeenCalled();
  });
});

describe('la hoja y la ronda que quedan vacias', () => {
  it('si la hoja queda sin productos, se borra la hoja', async () => {
    prismaMock.producto.count.mockResolvedValue(0);
    // Queda otra hoja en la ronda: la ronda sobrevive.
    prismaMock.hojaConteo.count.mockResolvedValue(1);

    const r = await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS);

    // Una hoja vacia es una persona mandada a mirar una lista sin renglones.
    expect(prismaMock.hojaConteo.delete).toHaveBeenCalledWith({ where: { id: 50 } });
    // Y NO se actualiza `tamano` de una hoja que ya no existe.
    expect(prismaMock.hojaConteo.update).not.toHaveBeenCalled();
    expect(r).toMatchObject({ hojaBorrada: true, rondaBorrada: false });
  });

  it('si era la unica hoja, la ronda entera desaparece', async () => {
    prismaMock.producto.count.mockResolvedValue(0);
    prismaMock.hojaConteo.count.mockResolvedValue(0);

    const r = await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS);

    expect(r).toMatchObject({ hojaBorrada: true, rondaBorrada: true });
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ detalle: expect.objectContaining({ rondaBorrada: true }) }),
      prismaMock,
    );
  });
});

/**
 * EL BORDE QUE MAS FACIL SE ROMPE: con la ronda 2 desaparecida, el inventario
 * queda igual que si la ronda 1 hubiera cerrado sin nada que recontar --
 * `en_curso` esperando al Auditor. Sus dos botones arrancan de
 * `ultimaRondaDe`, asi que tienen que seguir funcionando sobre la ronda 1.
 */
describe('con la ronda borrada, el Auditor sigue pudiendo seguir', () => {
  beforeEach(() => {
    // La ronda 2 ya no existe: el maximo vuelve a ser 1.
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 1 } });
    prismaMock.inventario.findUnique.mockResolvedValue({
      id: INV,
      sucursalId: 1,
      estado: 'en_curso',
      tamanoHoja: 50,
    });
    // Sin hojas sin finalizar ni sin sincronizar en la ronda 1.
    prismaMock.hojaConteo.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prismaMock) : arg,
    );
  });

  it('iniciarAjuste arranca sobre la ronda 1, que volvio a ser la ultima', async () => {
    const r = await iniciarAjuste(AUDITOR, INV);

    expect(r).toMatchObject({ estado: 'ajuste_auditor', ronda: 1 });
    expect(prismaMock.inventario.update).toHaveBeenCalledWith({
      where: { id: INV },
      data: { estado: 'ajuste_auditor' },
    });
  });

  it('abrirRondaExtra corta con 409 si ya no queda nada para recontar', async () => {
    // Todo cuadro -- que es justamente por que la ronda 2 desaparecio.
    prismaMock.producto.findMany.mockResolvedValue([{ codigo: CODIGO, descripcion: 'x', categoria: null }]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([{ codigo: CODIGO, stockErp: STOCK }]);
    prismaMock.hojaConteo.findMany.mockImplementation(async (q: unknown) => {
      const w = (q as { where?: Record<string, unknown> }).where ?? {};
      // `contadoHastaLaRonda` pide numeroConteo: { lte }.
      if (typeof w['numeroConteo'] === 'object' && w['numeroConteo'] !== null) {
        return [
          {
            numeroConteo: 1,
            productos: [{ codigo: CODIGO, empaques: [{ nombre: 'U', factor: 1 }], conteos: [{ sueltas: STOCK, empaques: [] }] }],
          },
        ];
      }
      return [];
    });

    await expect(abrirRondaExtra(AUDITOR, INV)).rejects.toThrow(/cuadraron/);
  });
});

describe('cuando NO hay que sacar nada', () => {
  it('la correccion no hace cuadrar: el item se queda en la ronda', async () => {
    // Contado 7 contra stock 10: sigue habiendo diferencia.
    prismaMock.producto.findMany.mockResolvedValue(
      productosPorRonda({ ronda: 1, contado: 7 }, { ronda: 2, contado: null }),
    );

    expect(await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS)).toBeNull();
    expect(prismaMock.producto.delete).not.toHaveBeenCalled();
  });

  /**
   * Sin stock del ERP no se puede AFIRMAR que un item cuadra, asi que no se
   * lo saca. Es la regla de toda la auditoria: "no se" no es "cero".
   */
  it('sin stockErp no saca nada, aunque el conteo sea el que sea', async () => {
    prismaMock.catalogoItem.findFirst.mockResolvedValue({ stockErp: null });

    expect(await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS)).toBeNull();
    expect(prismaMock.producto.delete).not.toHaveBeenCalled();
  });

  it('corrigiendo sobre la ULTIMA ronda no hay siguiente que limpiar', async () => {
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 1 } });

    expect(await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS)).toBeNull();
    // Ni siquiera pregunta por las hojas: corta antes.
    expect(prismaMock.hojaConteo.findMany).not.toHaveBeenCalled();
  });

  /**
   * EL ULTIMO CONTEO MANDA: corregir la ronda 1 cuando la 2 ya tiene un
   * numero no cambia cual manda, asi que el item no cuadra por la correccion.
   * (En la practica la ronda 2 con un conteo ya corto antes por `rondaEmpezo`;
   * esto fija la regla del lado del calculo, que es donde podria divergir.)
   */
  it('mira el historico completo, no solo el valor corregido', async () => {
    prismaMock.hojaConteo.findMany.mockResolvedValue([hojaIntacta()]);
    prismaMock.producto.findMany.mockResolvedValue(
      productosPorRonda({ ronda: 1, contado: STOCK }, { ronda: 2, contado: 3 }),
    );

    // Manda el 3 de la ronda 2, no el 10 corregido en la 1: no cuadra.
    expect(await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS)).toBeNull();
  });

  it('si el item ya no estaba en la ronda siguiente, no falla', async () => {
    prismaMock.producto.findFirst.mockResolvedValue(null);

    expect(await sacarDeLaRondaSiguienteSiCuadro(prismaMock as never, ARGS)).toBeNull();
    expect(prismaMock.producto.delete).not.toHaveBeenCalled();
  });
});
