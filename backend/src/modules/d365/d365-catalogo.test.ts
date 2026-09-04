import { describe, expect, it } from 'vitest';
import { agruparBarcodesPorItem, mapearProducto, obtenerCatalogoEjemplo } from './d365-catalogo.service';
import type { D365ProductBarcode, D365ReleasedProduct } from './d365.types';

const producto: D365ReleasedProduct = {
  ItemId: '0051',
  ItemNumber: '0051',
  ProductName: 'Aceite Vegetal Primor 1L',
  InventoryUnitSymbol: 'UND',
};

describe('mapearProducto', () => {
  it('el barcode de cantidad 1 se mapea a codigoBarras (unidad suelta)', () => {
    const barcodes: D365ProductBarcode[] = [
      { ItemNumber: '0051', Barcode: '7750123051', ProductQuantity: 1, IsDefaultDisplayedBarcode: 'Yes' },
      { ItemNumber: '0051', Barcode: '7750123051012', ProductQuantity: 12, ProductQuantityUnitSymbol: 'Caja' },
    ];
    const resultado = mapearProducto(producto, barcodes);
    expect(resultado.codigoBarras).toBe('7750123051');
  });

  it('el barcode con cantidad > 1 se mapea al empaque, con su factor y su propio codigo de barras', () => {
    const barcodes: D365ProductBarcode[] = [
      { ItemNumber: '0051', Barcode: '7750123051', ProductQuantity: 1, IsDefaultDisplayedBarcode: 'Yes' },
      { ItemNumber: '0051', Barcode: '7750123051012', ProductQuantity: 12, ProductQuantityUnitSymbol: 'Caja' },
    ];
    const resultado = mapearProducto(producto, barcodes);
    expect(resultado.empaque).toEqual({ nombre: 'Caja', factor: 12, codigoBarras: '7750123051012' });
  });

  it('prefiere el barcode marcado IsDefaultDisplayedBarcode="Yes" como unidad suelta, aunque no sea el de menor cantidad', () => {
    const barcodes: D365ProductBarcode[] = [
      { ItemNumber: '0051', Barcode: 'AAA', ProductQuantity: 1 },
      { ItemNumber: '0051', Barcode: 'BBB', ProductQuantity: 1, IsDefaultDisplayedBarcode: 'Yes' },
    ];
    const resultado = mapearProducto(producto, barcodes);
    expect(resultado.codigoBarras).toBe('BBB');
  });

  it('sin ningun barcode de empaque, el factor queda en 1 con la unidad de inventario de D365', () => {
    const barcodes: D365ProductBarcode[] = [{ ItemNumber: '0051', Barcode: '7750123051', ProductQuantity: 1 }];
    const resultado = mapearProducto(producto, barcodes);
    expect(resultado.empaque).toEqual({ nombre: 'UND', factor: 1 });
  });

  it('sin ningun barcode en absoluto, el ItemNumber hace de codigo de barras de ultimo recurso (nunca vacio)', () => {
    const resultado = mapearProducto(producto, []);
    expect(resultado.codigoBarras).toBe('0051');
    expect(resultado.codigo).toBe('0051');
  });

  it('descripcion cae a ProductDescription y despues a ItemNumber si falta ProductName', () => {
    const sinNombre: D365ReleasedProduct = { ItemId: '9', ItemNumber: '9', ProductDescription: 'Desc X' };
    expect(mapearProducto(sinNombre, []).descripcion).toBe('Desc X');

    const sinNada: D365ReleasedProduct = { ItemId: '9', ItemNumber: '9' };
    expect(mapearProducto(sinNada, []).descripcion).toBe('9');
  });

  it('con mas de un barcode de empaque (D365 trae varias unidades alternas), se queda con uno solo -- nuestro dominio no modela varias', () => {
    const barcodes: D365ProductBarcode[] = [
      { ItemNumber: '0051', Barcode: '7750123051', ProductQuantity: 1, IsDefaultDisplayedBarcode: 'Yes' },
      { ItemNumber: '0051', Barcode: 'PACK6', ProductQuantity: 6, ProductQuantityUnitSymbol: 'Pack' },
      { ItemNumber: '0051', Barcode: 'CAJA12', ProductQuantity: 12, ProductQuantityUnitSymbol: 'Caja' },
    ];
    const resultado = mapearProducto(producto, barcodes);
    // El primero en cantidad ascendente despues de la unidad suelta.
    expect(resultado.empaque.factor).toBe(6);
  });
});

describe('agruparBarcodesPorItem', () => {
  it('agrupa varios barcodes bajo el mismo ItemNumber', () => {
    const barcodes: D365ProductBarcode[] = [
      { ItemNumber: '0051', Barcode: 'A', ProductQuantity: 1 },
      { ItemNumber: '0051', Barcode: 'B', ProductQuantity: 12 },
      { ItemNumber: '0052', Barcode: 'C', ProductQuantity: 1 },
    ];
    const mapa = agruparBarcodesPorItem(barcodes);
    expect(mapa.get('0051')).toHaveLength(2);
    expect(mapa.get('0052')).toHaveLength(1);
    expect(mapa.get('0099')).toBeUndefined();
  });
});

describe('obtenerCatalogoEjemplo', () => {
  it('nunca toca red y siempre devuelve los mismos 4 productos de la maqueta', () => {
    const catalogo = obtenerCatalogoEjemplo();
    expect(catalogo).toHaveLength(4);
    expect(catalogo.map((p) => p.descripcion)).toContain('Aceite Vegetal Primor 1L');
  });

  it('cada item de ejemplo tiene codigo de barras y empaque con factor > 1', () => {
    const catalogo = obtenerCatalogoEjemplo();
    for (const item of catalogo) {
      expect(item.codigoBarras).toBeTruthy();
      expect(item.empaque.factor).toBeGreaterThan(1);
    }
  });
});
