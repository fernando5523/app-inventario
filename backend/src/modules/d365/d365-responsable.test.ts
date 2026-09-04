/**
 * El filtro que decide QUE se cuenta. Puro, sin red ni base.
 *
 * La regla no la inventamos: sale del desarrollo que el cliente ya usa
 * (app_inventarioautomatico, report.service.ts#buildReportRows), donde el
 * reporte de conteo descarta todo lo que no sea responsabilidad del
 * Empleado.
 */
import { describe, expect, it } from 'vitest';
import {
  agruparResponsablesPorItem,
  agruparStockPorItem,
  resumirDescartes,
  tieneExistencia,
  esDeLaEmpresa,
  mapearCatalogo,
  seCuenta,
} from './d365-catalogo.service';
import type { D365ReleasedProduct, D365ResponsableItem } from './d365.types';

const RESPONSABLES: D365ResponsableItem[] = [
  { ItemId: 'A1', ModuleType: 'Invent', TRU_InventoryManagerPE: 'Employee' },
  { ItemId: 'A2', ModuleType: 'Invent', TRU_InventoryManagerPE: 'Company' },
  { ItemId: 'A3', ModuleType: 'Invent', TRU_InventoryManagerPE: 'None' },
  // Otro modulo: la misma entidad guarda responsables que no son de inventario.
  { ItemId: 'A4', ModuleType: 'Vendor', TRU_InventoryManagerPE: 'Employee' },
];

const prod = (n: string): D365ReleasedProduct => ({
  ItemNumber: n,
  SearchName: `PROD ${n}`,
  InventoryUnitSymbol: 'U.',
  PurchaseUnitSymbol: 'Emp.12',
});

describe('agruparResponsablesPorItem', () => {
  it('solo toma las filas del modulo de inventario', () => {
    const mapa = agruparResponsablesPorItem(RESPONSABLES);
    expect(mapa.get('A1')).toBe('Employee');
    // A4 es 'Employee' pero de otro modulo: no cuenta como responsable de inventario.
    expect(mapa.has('A4')).toBe(false);
  });
});

describe('seCuenta: solo lo que responde el Empleado', () => {
  it('cuenta al Empleado', () => {
    expect(seCuenta('Employee')).toBe(true);
  });

  it('NO cuenta lo de la Empresa: el faltante lo asume ella', () => {
    expect(seCuenta('Company')).toBe(false);
    expect(esDeLaEmpresa('Company')).toBe(true);
  });

  it('NO cuenta lo que no tiene responsable', () => {
    // Sin responsable no hay a quien liquidarle una diferencia: contarlo
    // solo agrega ruido a la auditoria.
    expect(seCuenta('None')).toBe(false);
    expect(seCuenta(undefined)).toBe(false);
  });
});

describe('mapearCatalogo: el filtro sobre el catalogo completo', () => {
  const productos = [prod('A1'), prod('A2'), prod('A3'), prod('SIN_FILA')];

  it('deja SOLO los del Empleado', () => {
    const catalogo = mapearCatalogo(productos, [], [], RESPONSABLES);
    expect(catalogo.map((c) => c.codigo)).toEqual(['A1']);
  });

  it('marca esEmpresa con el dato del ERP, no calculado', () => {
    const soloEmpresa: D365ResponsableItem[] = [
      { ItemId: 'A2', ModuleType: 'Invent', TRU_InventoryManagerPE: 'Company' },
      { ItemId: 'A1', ModuleType: 'Invent', TRU_InventoryManagerPE: 'Employee' },
    ];
    const catalogo = mapearCatalogo([prod('A1')], [], [], soloEmpresa);
    expect(catalogo[0]!.esEmpresa).toBe(false);
  });

  it('ANUAL cuenta TODO, empresa incluida', () => {
    // Decision del cliente: "en el inventario anual ya cuentan todo".
    const catalogo = mapearCatalogo(productos, [], [], RESPONSABLES, 'anual');
    expect(catalogo.map((c) => c.codigo)).toEqual(['A1', 'A2', 'A3', 'SIN_FILA']);
  });

  it('y en el ANUAL sigue marcando de quien es cada item', () => {
    // Contarlos a todos no borra la distincion: la auditoria necesita saber
    // de quien es cada faltante.
    const catalogo = mapearCatalogo([prod('A2')], [], [], RESPONSABLES, 'anual');
    expect(catalogo[0]!.esEmpresa).toBe(true);
  });

  it('el default es MENSUAL: el anual hay que pedirlo explicito', () => {
    // Que alguien cuente 11.835 items creyendo que cuenta 6.297 es una
    // jornada perdida.
    expect(mapearCatalogo(productos, [], [], RESPONSABLES)).toHaveLength(1);
  });

  it('si la entidad de responsables no responde, NO filtra nada', () => {
    // Un catalogo de mas es revisable; un snapshot vacio por un error de
    // red deja al Coordinador sin poder arrancar el inventario.
    const catalogo = mapearCatalogo(productos, [], [], []);
    expect(catalogo).toHaveLength(4);
  });
});

describe('stock del ERP: null NO es cero', () => {
  const productos = [prod('A1'), prod('A2')];

  it('agrupa por item y suma filas repetidas del mismo almacen', () => {
    const filas = [
      { ItemNumber: 'A1', InventoryWarehouseId: 'MD11', OnHandQuantity: 10 },
      { ItemNumber: 'A1', InventoryWarehouseId: 'MD11', OnHandQuantity: 5 },
      { ItemNumber: 'A2', InventoryWarehouseId: 'MD11', OnHandQuantity: 3 },
    ];
    const mapa = agruparStockPorItem(filas);
    // Sumar, no quedarse con la ultima: perderia existencias.
    expect(mapa.get('A1')).toBe(15);
    expect(mapa.get('A2')).toBe(3);
  });

  it('un item SIN dato de stock queda en null, nunca en 0', () => {
    // "No se cuanto hay" y "hay cero" llevan a conclusiones opuestas: un 0
    // falso hace que la auditoria reporte un faltante que no existe.
    const catalogo = mapearCatalogo(productos, [], [], [], 'anual', new Map([['A1', 7]]));
    expect(catalogo.find((c) => c.codigo === 'A1')!.stockErp).toBe(7);
    expect(catalogo.find((c) => c.codigo === 'A2')!.stockErp).toBeNull();
  });

  it('un stock de CERO real si se guarda como 0', () => {
    // Cero es un dato: significa que el ERP dice que no hay.
    const catalogo = mapearCatalogo([prod('A1')], [], [], [], 'anual', new Map([['A1', 0]]));
    expect(catalogo[0]!.stockErp).toBe(0);
  });

  it('sin ninguna consulta de stock, TODO queda en null', () => {
    const catalogo = mapearCatalogo(productos, [], [], [], 'anual');
    expect(catalogo.every((c) => c.stockErp === null)).toBe(true);
  });
});

describe('filtro por existencia: solo lo que tiene stock', () => {
  it('descarta null Y cero, igual que el proyecto que ya usa la empresa', () => {
    // Condicion de referencia: `if (qty === undefined || qty <= 0) continue`
    expect(tieneExistencia(null)).toBe(false);
    expect(tieneExistencia(0)).toBe(false);
    expect(tieneExistencia(-3)).toBe(false);
    expect(tieneExistencia(1)).toBe(true);
  });

  it('cuenta los descartes POR MOTIVO, no en una sola bolsa', () => {
    // "No se" y "hay cero" llevan a conversaciones distintas el dia que
    // alguien pregunte por que una hoja no trae tal producto.
    const items = [{ stockErp: null }, { stockErp: null }, { stockErp: 0 }, { stockErp: 5 }];
    expect(resumirDescartes(items)).toEqual({ sinRegistro: 2, stockCero: 1 });
  });

  it('filtra el catalogo cuando se lo piden explicitamente', () => {
    const stock = new Map([['A1', 4]]);
    const catalogo = mapearCatalogo([prod('A1'), prod('A2')], [], [], [], 'anual', stock, true);
    expect(catalogo.map((c) => c.codigo)).toEqual(['A1']);
  });

  it('NO filtra si no se lo piden: sin stock consultado, el catalogo entero', () => {
    // Si la consulta de stock falla y vuelve vacia, filtrar dejaria el
    // inventario en CERO items y el Coordinador no podria arrancar.
    const catalogo = mapearCatalogo([prod('A1'), prod('A2')], [], [], [], 'anual', new Map(), false);
    expect(catalogo).toHaveLength(2);
  });
});
