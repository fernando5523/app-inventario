import { describe, expect, it } from 'vitest';
import {
  agruparBarcodesPorItem,
  agruparConversionesPorProducto,
  criteriosDelSnapshot,
  clasificarItem,
  elegirEmpaques,
  empaqueDeCompra,
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

describe('criteriosDelSnapshot: que filtros corrieron DE VERDAD', () => {
  it('mensual con almacen y responsables: los dos que existen hoy', () => {
    expect(criteriosDelSnapshot({ tipo: 'mensual', cantidadResponsables: 8000, filtrarPorStock: true })).toEqual({
      porStock: true,
      porResponsable: true,
      porEstadoActivo: false,
    });
  });

  it('porEstadoActivo es SIEMPRE false: ReleasedProductsV2 no se filtra por estado', () => {
    // Es el hallazgo del 2026-09-09: la pantalla lo prometia y nunca se
    // aplico. Este test lo fija hasta que el filtro exista de verdad.
    for (const tipo of ['mensual', 'anual'] as const) {
      for (const filtrarPorStock of [true, false]) {
        expect(criteriosDelSnapshot({ tipo, cantidadResponsables: 100, filtrarPorStock }).porEstadoActivo).toBe(false);
      }
    }
  });

  it('sin almacen: porStock en false -- sin dato de stock no se filtro nada', () => {
    expect(criteriosDelSnapshot({ tipo: 'mensual', cantidadResponsables: 100, filtrarPorStock: false }).porStock).toBe(false);
  });

  it('sin responsables (la entidad fallo o vino vacia): porResponsable en false', () => {
    // El backend deja pasar TODO en ese caso a proposito -- mejor un catalogo
    // de mas, que se ve, que uno vacio por un error de red. Lo que no puede
    // pasar es que la pantalla siga afirmando que se filtro.
    expect(criteriosDelSnapshot({ tipo: 'mensual', cantidadResponsables: 0, filtrarPorStock: true }).porResponsable).toBe(false);
  });

  it('ANUAL: porResponsable en false aunque haya responsables -- ahi se cuenta todo a proposito', () => {
    expect(criteriosDelSnapshot({ tipo: 'anual', cantidadResponsables: 8000, filtrarPorStock: true }).porResponsable).toBe(false);
  });
});

/**
 * EL EMPAQUE DE COMPRA. Es el denominador de la regla del faltante por
 * paquete, y de el depende a QUIEN se le descuenta un faltante: si falta
 * menos de media unidad de paquete se le descuenta al trabajador; si falta
 * mas, sale del descuento al personal y va al cuadro del almacenero.
 *
 * Gilmer lo dijo tres veces: es el de COMPRA, no el de venta. Su ejemplo es
 * un chocolate con empaque de compra 540 y display de venta 20 -- con esa
 * diferencia, 10 unidades faltantes caen de un lado o del otro de la regla.
 */
describe('empaqueDeCompra', () => {
  it('toma el factor del PurchaseUnitSymbol A LA UNIDAD BASE', () => {
    const conversiones: D365UnitConversion[] = [
      { ProductNumber: '110605', FromUnitSymbol: 'U', ToUnitSymbol: 'U.', Factor: 1 },
      { ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12 },
    ];
    expect(empaqueDeCompra(conversiones, producto)).toEqual({ unidades: 12, simbolo: 'Emp.12' });
  });

  /**
   * LA TRAMPA, con datos reales (item 100016): el mismo simbolo de compra
   * tiene DOS conversiones, una a otro empaque y otra a la unidad. Tomar "la
   * primera que coincida" devuelve 4 -- cuantos Emp.12 entran en un Emp.48 --
   * en vez de 48. Con 4, media unidad de paquete son 2 unidades en vez de 24:
   * la regla cambiaria de lado para casi cualquier faltante.
   */
  it('NO se queda con la conversion a otro empaque: pide la que va a la unidad suelta', () => {
    const item100016: D365ReleasedProduct = {
      ItemNumber: '100016',
      SearchName: 'X',
      InventoryUnitSymbol: 'U.',
      PurchaseUnitSymbol: 'Emp.48',
    };
    const conversiones: D365UnitConversion[] = [
      { ProductNumber: '100016', FromUnitSymbol: 'Emp.48', ToUnitSymbol: 'Emp.12', Factor: 4 },
      { ProductNumber: '100016', FromUnitSymbol: 'Emp.48', ToUnitSymbol: 'U', Factor: 48 },
    ];
    expect(empaqueDeCompra(conversiones, item100016)?.unidades).toBe(48);
  });

  /**
   * EL CASO QUE MOTIVA TODO, con datos reales (item 101127): el catalogo
   * guarda hoy el MAYOR factor de las conversiones -- 1000 -- y el empaque de
   * compra es 20. Medir el umbral con el de hoy daria 500 unidades de
   * tolerancia en vez de 10.
   */
  it('NO es el mayor empaque del producto: el de compra puede ser mucho mas chico', () => {
    const item101127: D365ReleasedProduct = {
      ItemNumber: '101127',
      SearchName: 'X',
      InventoryUnitSymbol: 'U.',
      PurchaseUnitSymbol: 'Emp.20',
    };
    const conversiones: D365UnitConversion[] = [
      { ProductNumber: '101127', FromUnitSymbol: 'Emp.1000', ToUnitSymbol: 'U', Factor: 1000 },
      { ProductNumber: '101127', FromUnitSymbol: 'Emp.20', ToUnitSymbol: 'U', Factor: 20 },
    ];
    expect(empaqueDeCompra(conversiones, item101127)?.unidades).toBe(20);
    // Y lo que el catalogo guarda hoy como empaque sigue siendo el de gondola.
    expect(elegirEmpaques(conversiones, item101127)[0]?.factor).toBe(1000);
  });

  it('comprado por unidad ("U") es un paquete de 1, y eso es un DATO', () => {
    // 457 de los primeros 2.000 items del catalogo real. No es un caso de
    // borde ni un dato faltante: se compra suelto.
    const suelto: D365ReleasedProduct = {
      ItemNumber: '100033',
      SearchName: 'X',
      InventoryUnitSymbol: 'U.',
      PurchaseUnitSymbol: 'U',
    };
    expect(empaqueDeCompra([], suelto)).toEqual({ unidades: 1, simbolo: 'U' });
  });

  it('sin conversion a la unidad base, cae al numero del nombre ("Emp.12" -> 12)', () => {
    // El mismo respaldo que ya usa `elegirEmpaques`: 3.728 de 11.835
    // productos no tienen ninguna conversion cargada.
    expect(empaqueDeCompra([], producto)).toEqual({ unidades: 12, simbolo: 'Emp.12' });
  });

  it('sin nada de donde sacarlo devuelve NULL, que NO es 1', () => {
    // "No se sabe el tamano del paquete" es distinto de "se compra por
    // unidad". Con 1, el item entraria a la regla como suelto y se le
    // descontaria el faltante entero al personal sin que nadie lo decida.
    const sinNada: D365ReleasedProduct = {
      ItemNumber: '999',
      SearchName: 'X',
      InventoryUnitSymbol: 'U.',
      PurchaseUnitSymbol: 'SA',
    };
    expect(empaqueDeCompra([], sinNada)).toBeNull();
  });

  it('sin simbolo de compra, NULL', () => {
    const sinSimbolo: D365ReleasedProduct = { ItemNumber: '999', SearchName: 'X', InventoryUnitSymbol: 'U.' };
    expect(empaqueDeCompra([], sinSimbolo)).toBeNull();
  });
});

/**
 * LAS TRES VIAS. Reemplazan al booleano `esEmpresa`: la regla del cliente ya
 * no es "se descuenta o no", son tres destinos distintos para el faltante.
 */
describe('clasificarItem', () => {
  it('lo de la empresa es `empresa`, tenga el empaque que tenga', () => {
    expect(clasificarItem(true, 12)).toBe('empresa');
    expect(clasificarItem(true, 1)).toBe('empresa');
    expect(clasificarItem(true, null)).toBe('empresa');
  });

  it('con empaque de compra mayor que 1 es `paquete`: le aplica la regla del umbral', () => {
    expect(clasificarItem(false, 12)).toBe('paquete');
    expect(clasificarItem(false, 2)).toBe('paquete');
  });

  it('comprado por unidad es `unidad`: no hay paquete contra el cual medir media unidad', () => {
    expect(clasificarItem(false, 1)).toBe('unidad');
  });

  /**
   * SIN EMPAQUE DA `unidad`, que es el tratamiento de SIEMPRE. No se manda al
   * cuadro del almacenero por no tener el dato: eso sacaria plata del
   * descuento al personal sin que nadie lo haya decidido. La columna
   * `empaqueCompra` queda en null al lado, asi que el caso se puede encontrar.
   */
  it('sin empaque resuelto es `unidad`, no `paquete`: no se inventa un paquete', () => {
    expect(clasificarItem(false, null)).toBe('unidad');
  });
});

describe('mapearProducto: las columnas nuevas viajan con el item', () => {
  it('trae el empaque de compra, su simbolo y la clase, junto a los empaques de gondola', () => {
    const conversiones: D365UnitConversion[] = [
      { ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12 },
    ];
    const item = mapearProducto(producto, [], conversiones);
    expect(item.empaqueCompra).toBe(12);
    expect(item.empaqueCompraSimbolo).toBe('Emp.12');
    expect(item.clase).toBe('paquete');
  });

  it('`clase === empresa` y `esEmpresa === true` son el mismo hecho: no pueden discrepar', () => {
    // Se escriben juntas y de la misma fuente. Mientras el booleano siga
    // existiendo, esta equivalencia es lo que impide que la auditoria y el
    // calculo nuevo lean cosas distintas del mismo item.
    const deEmpresa = mapearProducto(producto, [], [], 'Company');
    const deEmpleado = mapearProducto(producto, [], [], 'Employee');
    expect(deEmpresa.esEmpresa).toBe(deEmpresa.clase === 'empresa');
    expect(deEmpleado.esEmpresa).toBe(deEmpleado.clase === 'empresa');
  });
});
