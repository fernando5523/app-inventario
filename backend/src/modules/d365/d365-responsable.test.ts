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
