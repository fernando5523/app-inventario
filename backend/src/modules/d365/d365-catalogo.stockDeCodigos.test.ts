/**
 * `stockDeCodigos` y su filtro: pedirle a Dynamics el stock de una LISTA
 * ACOTADA de items, que es lo que necesita la descarga por ronda.
 *
 * Lo que se fija aca es el `$filter`, y no es un detalle de formato: un filtro
 * mal armado NO falla -- devuelve otras filas. El stock de una ronda queda mal
 * y nadie ve un error hasta que alguien discute un descuento a fin de mes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./d365-entity.service', () => ({
  d365EntityService: { obtenerTodos: vi.fn() },
}));

import { d365EntityService } from './d365-entity.service';
import {
  CODIGOS_POR_CONSULTA,
  comillarLiteralOData,
  enLotes,
  FILAS_POR_INSERT,
  filtroStockDeCodigos,
  lotesDeCodigos,
  lotesDeFilas,
  stockDeCodigos,
} from './d365-catalogo.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('filtroStockDeCodigos', () => {
  it('liga el almacen con AND y los codigos con OR, y el OR va entre parentesis', () => {
    const filtro = filtroStockDeCodigos('MD01_LUZ', ['100150', '113967']);

    expect(filtro).toBe(
      "InventoryWarehouseId eq 'MD01_LUZ' and (ItemNumber eq '100150' or ItemNumber eq '113967')",
    );
    // EL PARENTESIS ES LO QUE IMPORTA. Sin el, `and` liga mas fuerte que `or` y
    // el filtro pasa a ser "(este almacen y el primer codigo) o cualquiera de
    // los demas EN CUALQUIER ALMACEN": traeria el stock de las otras tiendas
    // sumado al de esta, y la auditoria compararia contra numeros de Huaraz.
    expect(filtro).toContain('and (ItemNumber');
  });

  it('un solo codigo tambien va entre parentesis -- no hay un caso especial', () => {
    expect(filtroStockDeCodigos('MD01_LUZ', ['100150'])).toBe(
      "InventoryWarehouseId eq 'MD01_LUZ' and (ItemNumber eq '100150')",
    );
  });

  it('la comilla simple se duplica: cierra el literal, no da un error', () => {
    // Los ItemNumber del tenant son numericos, asi que hoy esto no cambia
    // ninguna consulta. Va igual porque un apostrofo sin escapar no falla:
    // termina el literal y el resto pasa a ser sintaxis del filtro.
    expect(comillarLiteralOData("O'BRIEN")).toBe("'O''BRIEN'");
    expect(filtroStockDeCodigos("MD01'LUZ", ["a'b"])).toBe(
      "InventoryWarehouseId eq 'MD01''LUZ' and (ItemNumber eq 'a''b')",
    );
  });
});

describe('lotesDeCodigos', () => {
  it('parte en lotes del tamano pedido y no pierde ni repite ninguno', () => {
    const codigos = Array.from({ length: 205 }, (_, i) => String(i));
    const lotes = lotesDeCodigos(codigos, 80);

    expect(lotes.map((l) => l.length)).toEqual([80, 80, 45]);
    expect(lotes.flat()).toEqual(codigos);
  });

  it('una lista vacia no da ningun lote -- no un lote vacio', () => {
    // Un lote vacio armaria el filtro `... and ()`, que Dynamics rechaza.
    expect(lotesDeCodigos([])).toEqual([]);
  });

  it('el default acota la URL: 80 codigos por consulta', () => {
    // La lista viaja en la URL y una URL no es infinita (IIS corta en ~16 KB).
    // Con ~25 caracteres por codigo, 80 son ~2 KB de filtro: margen de sobra.
    expect(CODIGOS_POR_CONSULTA).toBe(80);
    expect(filtroStockDeCodigos('MD01_LUZ', Array(CODIGOS_POR_CONSULTA).fill('101127')).length).toBeLessThan(4000);
  });

  it('un tamaño de lote no positivo es un error del que llama, no un bucle infinito', () => {
    expect(() => enLotes([1, 2, 3], 0)).toThrow(/positivo/);
    expect(() => enLotes([1, 2, 3], -5)).toThrow(/positivo/);
  });
});

describe('lotesDeFilas: el techo es el de PARAMETROS de Postgres, no el de la URL', () => {
  it('el catalogo anual entero entra en 3 INSERT, y ninguno pasa los 65.535 parametros', () => {
    // Postgres acepta 65.535 parametros por statement. Una fila de `stock_rondas`
    // son 5 columnas, asi que el techo duro esta en ~13.100 filas -- y el
    // catalogo anual real tiene 11.863. Un solo INSERT entraria HOY y reventaria
    // el dia que el catalogo crezca un 10%, con un error que no nombra ni la
    // tabla ni el snapshot.
    const COLUMNAS = 5;
    const lotes = lotesDeFilas(Array.from({ length: 11863 }, (_, i) => ({ i })));

    expect(lotes).toHaveLength(3);
    for (const lote of lotes) expect(lote.length * COLUMNAS).toBeLessThan(65535);
    expect(FILAS_POR_INSERT * COLUMNAS).toBeLessThan(65535);
  });

  it('una lista vacia da CERO lotes: `createMany({ data: [] })` es un INSERT sin filas', () => {
    expect(lotesDeFilas([])).toEqual([]);
  });
});

describe('stockDeCodigos', () => {
  it('sin codigos no le pregunta nada a Dynamics', async () => {
    expect(await stockDeCodigos('MD01_LUZ', [])).toEqual(new Map());
    expect(d365EntityService.obtenerTodos).not.toHaveBeenCalled();
  });

  it('una vuelta por lote, y suma las filas repetidas del mismo item', async () => {
    // `WarehousesOnHandV2` puede traer dos filas del mismo item en el mismo
    // almacen (dimensiones de inventario distintas). Se agrupa con
    // `agruparStockPorItem`, la MISMA funcion que usa el snapshot: dos formas de
    // agrupar el mismo dato darian dos stocks segun por donde entre.
    vi.mocked(d365EntityService.obtenerTodos).mockResolvedValue([
      { ItemNumber: '100150', InventoryWarehouseId: 'MD01_LUZ', OnHandQuantity: 4 },
      { ItemNumber: '100150', InventoryWarehouseId: 'MD01_LUZ', OnHandQuantity: 3 },
      { ItemNumber: '113967', InventoryWarehouseId: 'MD01_LUZ', OnHandQuantity: 10 },
    ] as never);

    const stock = await stockDeCodigos('MD01_LUZ', ['100150', '113967']);

    expect(stock.get('100150')).toBe(7);
    expect(stock.get('113967')).toBe(10);
    expect(d365EntityService.obtenerTodos).toHaveBeenCalledTimes(1);
  });

  it('un codigo que el ERP no devuelve NO esta en el mapa -- y eso no es 0', async () => {
    vi.mocked(d365EntityService.obtenerTodos).mockResolvedValue([] as never);

    const stock = await stockDeCodigos('MD01_LUZ', ['108591']);

    // Devolver un Map (y no pares con 0) es lo que obliga a quien llama a
    // decidir el `?? null`. Ver `StockRonda.stockErp`.
    expect(stock.has('108591')).toBe(false);
    expect(stock.get('108591')).toBeUndefined();
  });

  it('con mas codigos que un lote, pagina -- y el progreso cuenta CODIGOS PEDIDOS', async () => {
    vi.mocked(d365EntityService.obtenerTodos).mockResolvedValue([] as never);
    const codigos = Array.from({ length: 130 }, (_, i) => String(100000 + i));
    const avances: Array<[number, number]> = [];

    await stockDeCodigos('MD01_LUZ', codigos, (resueltos, total) => avances.push([resueltos, total]));

    expect(d365EntityService.obtenerTodos).toHaveBeenCalledTimes(2);
    // 130 items, no "filas traidas": es el numero que el Coordinador reconoce.
    expect(avances).toEqual([
      [80, 130],
      [130, 130],
    ]);
  });

  it('un error del progreso no voltea la descarga', async () => {
    vi.mocked(d365EntityService.obtenerTodos).mockResolvedValue([
      { ItemNumber: '100150', InventoryWarehouseId: 'MD01_LUZ', OnHandQuantity: 5 },
    ] as never);

    const stock = await stockDeCodigos('MD01_LUZ', ['100150'], () => {
      throw new Error('el sondeo explotó');
    });

    // Mismo criterio que `obtenerTodos#avisar`: reportar el avance es accesorio
    // y no puede costar la descarga.
    expect(stock.get('100150')).toBe(5);
  });

  it('el error de Dynamics se propaga tal cual: no hay `.catch(() => [])` aca', async () => {
    const boom = new Error('Error de Dynamics (502)');
    vi.mocked(d365EntityService.obtenerTodos).mockRejectedValue(boom);

    // El snapshot SI lo traga (alla el stock es una de siete entidades y un
    // catalogo sin stock es mejor que ningun catalogo). Aca el stock es lo unico
    // que se vino a buscar.
    await expect(stockDeCodigos('MD01_LUZ', ['100150'])).rejects.toBe(boom);
  });
});
