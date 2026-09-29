/**
 * EL ARRASTRE DE LA RONDA SIGUIENTE CON STOCK POR RONDA.
 *
 * El cambio de 2026-09-29 (cada reconteo baja su propio stock del ERP) toca la
 * decision mas delicada del ciclo: QUIEN pasa a la ronda siguiente. La regla que
 * estos tests fijan, y que el encabezado de `universoDeLaRonda` explica:
 *
 *   EL CONJUNTO QUE ARRASTRA LA RONDA N SE DECIDE CON LA COMPARACION DE LA
 *   RONDA N−1 CONTRA EL STOCK DE LA RONDA N−1.
 *
 * O sea: el stock nuevo sirve para evaluar el conteo NUEVO, nunca para
 * redefinir quien entro. Es lo que hace el cliente en su Excel -- filtra los
 * faltantes y sobrantes de la pasada anterior y recien a ESOS les pide stock
 * nuevo. Si esto se invirtiera, el universo de una ronda cambiaria debajo de la
 * gente que ya esta caminando la gondola con la hoja en la mano.
 *
 * Se prueba a traves de `resumen()`, que es de solo lectura y devuelve el embudo
 * tal cual lo calcula el cierre: `universoDeLaRonda` es privada y la unica forma
 * honesta de verla es por lo que decide.
 *
 * Prisma mockeado: `npm test` no levanta Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  hojaConteo: { count: vi.fn(), findMany: vi.fn() },
  producto: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  stockRonda: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { resumen } from './rondas.service';

const COORD: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };
const INV = 9;

/** Un `Producto` de la hoja de la ronda que se esta cerrando. */
const producto = (codigo: string) => ({ codigo, descripcion: `Producto ${codigo}`, categoria: 'ABARROTES' });

/** Una fila de `CatalogoItem`: el stock de la RONDA 1. */
const delCatalogo = (codigo: string, stockErp: number | null) => ({ codigo, stockErp });

/** Una fila de `StockRonda`. */
const deLaRonda = (codigo: string, numeroConteo: number, stockErp: number | null) => ({
  codigo,
  numeroConteo,
  stockErp,
});

/**
 * Lo contado en una ronda, con la forma que `contadoHastaLaRonda` consume: un
 * `Conteo` de sueltas, sin empaques (el factor no es lo que se prueba aca).
 */
const hojaDeLaRonda = (numeroConteo: number, conteos: Array<[string, number]>) => ({
  numeroConteo,
  productos: conteos.map(([codigo, unidades]) => ({
    codigo,
    empaques: [{ nombre: 'U', factor: 1 }],
    conteos: [{ sueltas: unidades, empaques: [] }],
  })),
});

/**
 * `hojaConteo.findMany` sirve a DOS consultas en el camino de `resumen`:
 * `contadoHastaLaRonda` (filtra `numeroConteo: { lte }`) y `hojasSinFinalizar`
 * (filtra `estado: { not: 'finalizada' }`). Se distinguen por la forma del
 * `where`, mismo criterio que `mockHojaConteoFindMany` en rondas.service.test.ts.
 */
function mockHojas(hojas: ReturnType<typeof hojaDeLaRonda>[]): void {
  prismaMock.hojaConteo.findMany.mockImplementation(async (query: unknown) => {
    const q = query as { where?: Record<string, unknown> };
    if (q.where?.estado !== undefined) return []; // hojasSinFinalizar: ninguna
    return hojas;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.inventario.findUnique.mockResolvedValue({
    id: INV,
    sucursalId: 1,
    estado: 'en_curso',
    tamanoHoja: 50,
    ultimaRondaCerrada: null,
  });
  prismaMock.hojaConteo.count.mockResolvedValue(1); // la ronda tiene hojas
  prismaMock.stockRonda.findMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// LA RONDA 2 SE EVALUA CONTRA SU PROPIO STOCK
// ---------------------------------------------------------------------------

describe('cerrar la ronda 2 con stock propio de la ronda 2', () => {
  beforeEach(() => {
    // Los dos items arrastrados de la ronda 1. El catalogo (ronda 1) decia 100.
    prismaMock.producto.findMany.mockResolvedValue([producto('A'), producto('B')]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([delCatalogo('A', 100), delCatalogo('B', 100)]);
    mockHojas([
      hojaDeLaRonda(1, [
        ['A', 98],
        ['B', 98],
      ]),
      hojaDeLaRonda(2, [
        ['A', 97],
        ['B', 98],
      ]),
    ]);
  });

  it('cuadra el que coincide con el stock NUEVO, no el que coincide con el viejo', async () => {
    // El ERP bajo de 100 a 97 entre las dos rondas. A conto 97 -> cuadra.
    // B conto 98, que era lo mismo que en la ronda 1, y ahora NO cuadra.
    prismaMock.stockRonda.findMany.mockResolvedValue([
      deLaRonda('A', 1, 100),
      deLaRonda('B', 1, 100),
      deLaRonda('A', 2, 97),
      deLaRonda('B', 2, 97),
    ]);

    const r = await resumen(COORD, INV, 2);
    expect(r).toMatchObject({ total: 2, contados: 2, cuadrados: 1, aRecontar: 1, sinDatoErp: 0 });
  });

  it('con el stock de la ronda 2 IGUAL al de la 1, el arrastre es el de siempre', async () => {
    // La garantia de que el cambio es aditivo: si el ERP no se movio, el embudo
    // da lo que daba antes.
    prismaMock.stockRonda.findMany.mockResolvedValue([
      deLaRonda('A', 1, 100),
      deLaRonda('B', 1, 100),
      deLaRonda('A', 2, 100),
      deLaRonda('B', 2, 100),
    ]);

    const r = await resumen(COORD, INV, 2);
    expect(r).toMatchObject({ total: 2, cuadrados: 0, aRecontar: 2 });
  });
});

// ---------------------------------------------------------------------------
// EL ORDEN: EL STOCK DE LA RONDA N NO REDEFINE QUIEN ENTRO A LA RONDA N
// ---------------------------------------------------------------------------

describe('el stock nuevo evalua el conteo nuevo, no redefine el universo', () => {
  it('cerrar la ronda 1 usa el stock de la RONDA 1 aunque la 2 ya tenga el suyo', async () => {
    // El caso que no se puede romper: se cierra la ronda 1 y en la base ya hay
    // stock de la ronda 2 (se descargo antes de cerrar). El arrastre tiene que
    // salir de la comparacion de la ronda 1 contra el stock de la ronda 1 -- si
    // mirara el de la 2, el item cuadraria y NO entraria al reconteo, dejando
    // fuera del ciclo un faltante que la ronda 1 si encontro.
    prismaMock.producto.findMany.mockResolvedValue([producto('A')]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([delCatalogo('A', 100)]);
    mockHojas([hojaDeLaRonda(1, [['A', 97]])]);
    prismaMock.stockRonda.findMany.mockResolvedValue([deLaRonda('A', 1, 100), deLaRonda('A', 2, 97)]);

    const r = await resumen(COORD, INV, 1);
    expect(r).toMatchObject({ total: 1, cuadrados: 0, aRecontar: 1 });
  });

  it('el item que la hoja de la ronda 2 no conto se mide con la vara de la ronda 1', async () => {
    // Manda el ultimo conteo QUE EXISTE (ciclo-conteos.ts#conteoQueManda), y si
    // ese es el de la ronda 1, la vara tambien. Medir un conteo del dia 22
    // contra el stock del dia 23 compararia dos momentos distintos.
    prismaMock.producto.findMany.mockResolvedValue([producto('A')]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([delCatalogo('A', 100)]);
    mockHojas([hojaDeLaRonda(1, [['A', 100]]), hojaDeLaRonda(2, [])]);
    prismaMock.stockRonda.findMany.mockResolvedValue([deLaRonda('A', 1, 100), deLaRonda('A', 2, 90)]);

    const r = await resumen(COORD, INV, 2);
    // Contra la ronda 1 cuadra (100 == 100); contra el stock de la ronda 2 no.
    expect(r).toMatchObject({ total: 1, contados: 1, cuadrados: 1, aRecontar: 0 });
  });
});

// ---------------------------------------------------------------------------
// SIN STOCK POR RONDA: EL INVENTARIO VIEJO SE COMPORTA IGUAL QUE ANTES
// ---------------------------------------------------------------------------

describe('un inventario sin stock por ronda', () => {
  it('cae al stock del catalogo y el embudo da lo mismo que antes del cambio', async () => {
    prismaMock.producto.findMany.mockResolvedValue([producto('A'), producto('B'), producto('C')]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([
      delCatalogo('A', 100),
      delCatalogo('B', 100),
      // Sin stock del ERP: no se puede auditar y NO se recuenta.
      delCatalogo('C', null),
    ]);
    mockHojas([
      hojaDeLaRonda(1, [
        ['A', 100],
        ['B', 88],
        ['C', 50],
      ]),
    ]);
    prismaMock.stockRonda.findMany.mockResolvedValue([]); // la tabla vacia

    const r = await resumen(COORD, INV, 1);
    expect(r).toMatchObject({ total: 3, contados: 3, cuadrados: 1, aRecontar: 1, sinDatoErp: 1 });
  });

  it('una ronda con stock en NULL para un item cae a la ronda 1, no lo da por 0', async () => {
    // NULL no es 0 tampoco acá: si el stock de la ronda 2 no vino, se mide con
    // el de la ronda 1 en vez de afirmar "el ERP esperaba cero" y mandar el item
    // a recontar por un faltante inventado.
    prismaMock.producto.findMany.mockResolvedValue([producto('A')]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([delCatalogo('A', 100)]);
    mockHojas([hojaDeLaRonda(1, [['A', 98]]), hojaDeLaRonda(2, [['A', 100]])]);
    prismaMock.stockRonda.findMany.mockResolvedValue([deLaRonda('A', 1, 100), deLaRonda('A', 2, null)]);

    const r = await resumen(COORD, INV, 2);
    expect(r).toMatchObject({ total: 1, cuadrados: 1, aRecontar: 0, sinDatoErp: 0 });
  });
});
