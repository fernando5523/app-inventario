import { describe, expect, it } from 'vitest';
import {
  agruparBarcodesPorItem,
  agruparConversionesPorProducto,
  elegirEmpaques,
  mapearProducto,
  obtenerCatalogoEjemplo,
} from './d365-catalogo.service';
import type { D365ProductBarcode, D365ReleasedProduct, D365UnitConversion } from './d365.types';

const producto: D365ReleasedProduct = {
  ItemNumber: '110605',
  SearchName: 'SAPOLIOLIMPIATODOANT',
  InventoryUnitSymbol: 'U.',
  PurchaseUnitSymbol: 'Emp.12',
};

// Forma real confirmada contra el tenant de Market Trujillo: SIEMPRE
// ProductQuantity=0 e IsDefaultDisplayedBarcode="No" -- nunca 1 ni "Yes"
// en la muestra real. Los tests reflejan esa forma, no la que se suponia.
const barcodeReal: D365ProductBarcode = {
  ItemNumber: '110605',
  Barcode: '7750243066730',
  ProductDescription: 'SAPOLIO LIMPIATODO ANTIBACTERIAL COCO 900 ML',
  ProductQuantityUnitSymbol: 'U',
  ProductQuantity: 0,
  IsDefaultDisplayedBarcode: 'No',
};

describe('mapearProducto (forma real: barcode siempre de unidad suelta)', () => {
  it('descripcion sale de ProductBarcodesV2.ProductDescription (nombre legible), no de SearchName', () => {
    const resultado = mapearProducto(producto, [barcodeReal], []);
    expect(resultado.descripcion).toBe('SAPOLIO LIMPIATODO ANTIBACTERIAL COCO 900 ML');
  });

  it('sin ProductDescription, cae a SearchName de ReleasedProductsV2', () => {
    const { ProductDescription: _sinUsar, ...sinDescripcion } = barcodeReal;
    const resultado = mapearProducto(producto, [sinDescripcion], []);
    expect(resultado.descripcion).toBe('SAPOLIOLIMPIATODOANT');
  });

  it('sin ningun barcode, la descripcion cae al ItemNumber (nunca vacia)', () => {
    const sinNombre: D365ReleasedProduct = { ItemNumber: '999' };
    expect(mapearProducto(sinNombre, [], []).descripcion).toBe('999');
  });

  it('codigoBarras: prefiere el marcado IsDefaultDisplayedBarcode="Yes" si existe', () => {
    const otro: D365ProductBarcode = { ...barcodeReal, Barcode: 'OTRO', IsDefaultDisplayedBarcode: 'Yes' };
    const resultado = mapearProducto(producto, [barcodeReal, otro], []);
    expect(resultado.codigoBarras).toBe('OTRO');
  });

  it('codigoBarras: sin ninguno marcado como default, toma el primero (nunca por ProductQuantity: siempre es 0)', () => {
    const resultado = mapearProducto(producto, [barcodeReal], []);
    expect(resultado.codigoBarras).toBe('7750243066730');
  });

  it('sin ningun barcode en absoluto, el ItemNumber hace de codigo de barras de ultimo recurso', () => {
    expect(mapearProducto(producto, [], []).codigoBarras).toBe('110605');
  });

  it('empaques[].codigoBarras NUNCA se llena: no hay barcode especifico por empaque en este tenant', () => {
    const conFactor: D365UnitConversion = { ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12 };
    const resultado = mapearProducto(producto, [barcodeReal], [conFactor]);
    expect(resultado.empaques.every((e) => e.codigoBarras === undefined)).toBe(true);
  });
});

describe('elegirEmpaques (el factor vive en ProductSpecificUnitOfMeasureConversions, no en el barcode)', () => {
  it('una fila con Factor=1 (equivalencia U/U.) NO cuenta como empaque: cae al simbolo de compra', () => {
    // CAMBIO 2026-09-04, regla confirmada por el cliente: sin conversion
    // util, el factor se lee del texto de la unidad de compra
    // (dominio/empaque.ts). Antes esto devolvia {U., 1} y perdia el empaque.
    const soloIdentidad: D365UnitConversion[] = [{ ProductNumber: '110605', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 }];
    const resultado = elegirEmpaques(soloIdentidad, producto);
    expect(resultado).toEqual([{ nombre: 'Emp.12', factor: 12 }]);
  });

  it('una fila con Factor != 1 es el empaque real (caso confirmado contra datos reales: Emp.12 = 12)', () => {
    const conversiones: D365UnitConversion[] = [
      { ProductNumber: '110605', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
      { ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12 },
      { ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U.', Factor: 12 },
    ];
    const resultado = elegirEmpaques(conversiones, producto);
    expect(resultado).toEqual([{ nombre: 'Emp.12', factor: 12 }]);
  });

  it('con DOS empaques alternos distintos, devuelve los DOS ordenados de mayor a menor factor', () => {
    const conversiones: D365UnitConversion[] = [
      { ProductNumber: '110605', FromUnitSymbol: 'Emp.6', ToUnitSymbol: 'U', Factor: 6 },
      { ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12 },
    ];
    const resultado = elegirEmpaques(conversiones, producto);
    expect(resultado).toEqual([
      { nombre: 'Emp.12', factor: 12 },
      { nombre: 'Emp.6', factor: 6 },
    ]);
  });

  it('sin ninguna conversion, saca el factor del texto de la unidad de compra', () => {
    // "Emp.12 es 12 unidades" -- 3.728 de 11.835 productos no tienen ninguna
    // conversion cargada en D365 y este es su unico factor posible.
    expect(elegirEmpaques([], producto)).toEqual([{ nombre: 'Emp.12', factor: 12 }]);
  });

  it('una unidad de medida sin numero sigue dando factor 1', () => {
    const porBolsa: D365ReleasedProduct = { ItemNumber: '1', InventoryUnitSymbol: 'U.', PurchaseUnitSymbol: 'Bolsa' };
    expect(elegirEmpaques([], porBolsa)).toEqual([{ nombre: 'Bolsa', factor: 1 }]);
  });

  it('sin conversion NI unidad de inventario, usa PurchaseUnitSymbol Y su numero', () => {
    // Este era el bug: devolvia factor 1 para "Emp.6". El operario cargaba
    // "2 packs" y el sistema guardaba 2 unidades en vez de 12.
    const sinInventoryUnit: D365ReleasedProduct = { ItemNumber: '1', PurchaseUnitSymbol: 'Emp.6' };
    expect(elegirEmpaques([], sinInventoryUnit)).toEqual([{ nombre: 'Emp.6', factor: 6 }]);
  });

  it('sin nada de nada, cae a "UND"', () => {
    expect(elegirEmpaques([], { ItemNumber: '1' })).toEqual([{ nombre: 'UND', factor: 1 }]);
  });
});

describe('agruparBarcodesPorItem', () => {
  it('agrupa varios barcodes bajo el mismo ItemNumber', () => {
    const b2: D365ProductBarcode = { ...barcodeReal, Barcode: 'B' };
    const mapa = agruparBarcodesPorItem([barcodeReal, b2]);
    expect(mapa.get('110605')).toHaveLength(2);
    expect(mapa.get('999')).toBeUndefined();
  });
});

describe('agruparConversionesPorProducto', () => {
  it('agrupa varias conversiones bajo el mismo ProductNumber', () => {
    const conversiones: D365UnitConversion[] = [
      { ProductNumber: '110605', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
      { ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12 },
      { ProductNumber: '110606', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
    ];
    const mapa = agruparConversionesPorProducto(conversiones);
    expect(mapa.get('110605')).toHaveLength(2);
    expect(mapa.get('110606')).toHaveLength(1);
  });
});

describe('obtenerCatalogoEjemplo', () => {
  it('nunca toca red y siempre devuelve los mismos 4 productos de la maqueta', () => {
    const catalogo = obtenerCatalogoEjemplo();
    expect(catalogo).toHaveLength(4);
    expect(catalogo.map((p) => p.descripcion)).toContain('Aceite Vegetal Primor 1L');
  });

  it('cada item de ejemplo tiene codigo de barras y al menos un empaque con factor > 1', () => {
    const catalogo = obtenerCatalogoEjemplo();
    for (const item of catalogo) {
      expect(item.codigoBarras).toBeTruthy();
      expect(item.empaques.length).toBeGreaterThan(0);
      expect(item.empaques[0]!.factor).toBeGreaterThan(1);
    }
  });

  it('ningun empaque de ejemplo trae codigoBarras propio (misma limitacion que el tenant real)', () => {
    const catalogo = obtenerCatalogoEjemplo();
    for (const item of catalogo) {
      expect(item.empaques.every((e) => e.codigoBarras === undefined)).toBe(true);
    }
  });

  it('el Aceite (0051) trae DOS empaques alternos, para probar el caso de verdad', () => {
    const aceite = obtenerCatalogoEjemplo().find((p) => p.descripcion === 'Aceite Vegetal Primor 1L');
    expect(aceite?.empaques).toEqual([
      { nombre: 'Emp.12', factor: 12 },
      { nombre: 'Emp.6', factor: 6 },
    ]);
  });
});

describe('el factor sale del MISMO simbolo que da el nombre', () => {
  it('numero en InventoryUnitSymbol y PurchaseUnitSymbol vacio', () => {
    // Caso real (item 100018): antes devolvia {Emp.12, factor 1} -- el
    // nombre decia 12 y la cuenta usaba 1.
    const soloInventory: D365ReleasedProduct = { ItemNumber: '100018', InventoryUnitSymbol: 'Emp.12' };
    expect(elegirEmpaques([], soloInventory)).toEqual([{ nombre: 'Emp.12', factor: 12 }]);
  });
});
