/**
 * El cruce del precio de venta. Puro, sin red.
 *
 * Los dos casos que este archivo blinda son los dos que rompen en SILENCIO:
 * el simbolo de unidad que no matchea (dejaria todo en null) y la fila del
 * empaque tomada por la de la unidad (valorizaria 20x de mas).
 */
import { describe, expect, it } from 'vitest';
import { agruparPreciosPorItem, elegirPrecioVenta, normalizarUnidad } from './d365-catalogo.service';
import type { D365PrecioVenta } from './d365.types';

const precio = (p: Partial<D365PrecioVenta>): D365PrecioVenta => ({
  ItemNumber: '101127',
  Price: 1.2,
  QuantityUnitySymbol: 'U',
  ...p,
});

describe('normalizarUnidad: el punto final que rompia todo', () => {
  it('el producto dice "U." y el precio dice "U": son la misma unidad', () => {
    // Medido contra el tenant real: con comparacion exacta coincidian CERO
    // de 1.554 filas, y precioVenta habria quedado null en todo el catalogo.
    expect(normalizarUnidad('U.')).toBe(normalizarUnidad('U'));
  });

  it.each([
    ['SA.', 'SA'],
    ['LTR.', 'LTR'],
    ['  u.  ', 'U'],
  ])('normaliza %s a %s', (entrada, esperado) => {
    expect(normalizarUnidad(entrada)).toBe(esperado);
  });

  it('vacio o null da cadena vacia, no revienta', () => {
    expect(normalizarUnidad(null)).toBe('');
    expect(normalizarUnidad(undefined)).toBe('');
    expect(normalizarUnidad('')).toBe('');
  });

  it('NO le come el punto a un empaque: "Emp.20" no termina en punto', () => {
    expect(normalizarUnidad('Emp.20')).toBe('EMP.20');
  });
});

describe('elegirPrecioVenta: la unidad suelta, nunca el empaque', () => {
  // Caso real medido (item 101127 en MD01_LUZ).
  const filas = [precio({ QuantityUnitySymbol: 'U', Price: 1.2 }), precio({ QuantityUnitySymbol: 'Emp.20', Price: 22.8 })];

  it('toma el precio de la unidad, no el de la caja', () => {
    // Con el del empaque, cada unidad valdria 22.80 en vez de 1.20: 19x de
    // mas en la liquidacion de alguien.
    expect(elegirPrecioVenta(filas, 'U.')).toBe(1.2);
  });

  it('si el item SOLO tiene precio de empaque, devuelve null', () => {
    // No se divide 22.80 / 20: el empaque tiene descuento por volumen
    // (1.20 x 20 = 24, no 22.80). Dividir inventaria plata.
    expect(elegirPrecioVenta([precio({ QuantityUnitySymbol: 'Emp.20', Price: 22.8 })], 'U.')).toBeNull();
  });

  it('sin ninguna fila, null', () => {
    expect(elegirPrecioVenta([], 'U.')).toBeNull();
  });

  it('sin unidad de inventario en el producto, null', () => {
    // Hay productos con InventoryUnitSymbol vacio en el tenant real.
    expect(elegirPrecioVenta(filas, '')).toBeNull();
    expect(elegirPrecioVenta(filas, null)).toBeNull();
  });

  it('un precio 0 se trata como SIN precio', () => {
    // Un producto de la gondola no vale cero: valorizarlo asi esconde el
    // faltante en vez de mostrarlo.
    expect(elegirPrecioVenta([precio({ Price: 0 })], 'U.')).toBeNull();
  });

  it('un precio negativo tampoco pasa', () => {
    expect(elegirPrecioVenta([precio({ Price: -5 })], 'U.')).toBeNull();
  });

  it('funciona con otras unidades, no solo "U"', () => {
    expect(elegirPrecioVenta([precio({ QuantityUnitySymbol: 'SA', Price: 90 })], 'SA.')).toBe(90);
  });
});

describe('agruparPreciosPorItem', () => {
  it('junta TODAS las filas de un item, no se queda con una', () => {
    // Quedarse con la primera perderia la fila de la unidad si venia segunda.
    const mapa = agruparPreciosPorItem([
      precio({ ItemNumber: 'A', QuantityUnitySymbol: 'Emp.20', Price: 22.8 }),
      precio({ ItemNumber: 'A', QuantityUnitySymbol: 'U', Price: 1.2 }),
      precio({ ItemNumber: 'B', Price: 5 }),
    ]);
    expect(mapa.get('A')).toHaveLength(2);
    expect(elegirPrecioVenta(mapa.get('A')!, 'U.')).toBe(1.2);
    expect(mapa.get('B')).toHaveLength(1);
  });

  it('descarta filas sin ItemNumber en vez de agruparlas bajo una clave vacia', () => {
    const mapa = agruparPreciosPorItem([precio({ ItemNumber: '' })]);
    expect(mapa.size).toBe(0);
  });
});
