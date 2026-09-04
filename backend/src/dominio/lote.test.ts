/**
 * Tests de como se arman y reparten las hojas. Logica pura, sin base.
 *
 * El grupo que mas importa es `ordenarParaContar`: es lo que decide si el
 * operario barre un sector o cruza la tienda en cada renglon. Un bug ahi no
 * rompe nada visible -- simplemente hace que el inventario tarde el doble, y
 * eso no se detecta leyendo codigo.
 */

import { describe, expect, it } from 'vitest';

import { numeroDeHoja, ordenarParaContar, partirEnHojas, repartir, zonaDeHoja } from './lote';

const item = (codigo: string, categoria: string | null) => ({ codigo, categoria });

describe('ordenarParaContar', () => {
  it('agrupa por categoria y ordena por codigo dentro de cada una', () => {
    const items = [
      item('900', 'GALLETAS'),
      item('100', 'ABARROTES'),
      item('800', 'GALLETAS'),
      item('200', 'ABARROTES'),
    ];

    expect(ordenarParaContar(items).map((i) => i.codigo)).toEqual(['100', '200', '800', '900']);
  });

  /**
   * El caso que justifica la funcion: por codigo, estos cuatro items hacen
   * cruzar la tienda cuatro veces. Por categoria, son dos paradas.
   */
  it('el orden por categoria NO es el orden por codigo', () => {
    const items = [
      item('000123', 'CUIDADO PERSONAL'),
      item('000124', 'ABARROTES'),
      item('000131', 'CUIDADO PERSONAL'),
      item('000145', 'ABARROTES'),
    ];

    expect(ordenarParaContar(items).map((i) => i.codigo)).toEqual(['000124', '000145', '000123', '000131']);
  });

  /**
   * Sin categoria NO se descarta: un producto que esta en la gondola tiene
   * que contarse aunque el ERP no lo haya clasificado.
   */
  it('los sin categoria van al FINAL, juntos, y no se pierden', () => {
    const items = [item('500', null), item('100', 'ZAPATOS'), item('400', null), item('200', 'ABARROTES')];

    const orden = ordenarParaContar(items);

    expect(orden).toHaveLength(4);
    expect(orden.map((i) => i.codigo)).toEqual(['200', '100', '400', '500']);
  });

  it('"ZAPATOS" no empuja a los sin categoria hacia arriba (el vacio no compite alfabeticamente)', () => {
    const orden = ordenarParaContar([item('1', null), item('2', 'ZZZ')]);
    expect(orden.map((i) => i.codigo)).toEqual(['2', '1']);
  });

  it('no muta el arreglo original', () => {
    const items = [item('900', 'B'), item('100', 'A')];
    const copia = [...items];
    ordenarParaContar(items);
    expect(items).toEqual(copia);
  });

  it('lista vacia no explota', () => {
    expect(ordenarParaContar([])).toEqual([]);
  });
});

describe('partirEnHojas', () => {
  it('division exacta', () => {
    expect(partirEnHojas(100, 50)).toEqual([50, 50]);
  });

  /** Cada item tiene que caer en alguna hoja: la ultima queda parcial. */
  it('la ultima hoja queda parcial, no se descarta el resto', () => {
    expect(partirEnHojas(1548, 50)).toHaveLength(31);
    expect(partirEnHojas(1548, 50).reduce((a, b) => a + b, 0)).toBe(1548);
    expect(partirEnHojas(1548, 50).at(-1)).toBe(48);
  });

  it('menos items que el tamaño da una sola hoja parcial', () => {
    expect(partirEnHojas(7, 50)).toEqual([7]);
  });

  it('cero items da cero hojas', () => {
    expect(partirEnHojas(0, 50)).toEqual([]);
  });

  it('rechaza entradas invalidas en vez de devolver algo raro', () => {
    expect(() => partirEnHojas(-1, 50)).toThrow();
    expect(() => partirEnHojas(1.5, 50)).toThrow();
    expect(() => partirEnHojas(100, 0)).toThrow();
  });
});

describe('repartir', () => {
  const hojas = [1, 2, 3, 4, 5, 6, 7];

  /** Contiguos: cada persona camina un tramo, no salta de punta a punta. */
  it('reparte en bloques CONTIGUOS, no salteados', () => {
    const r = repartir(hojas, ['ana', 'beto']);
    expect(r[0]!.hojas).toEqual([1, 2, 3, 4]);
    expect(r[1]!.hojas).toEqual([5, 6, 7]);
  });

  it('el resto va a los primeros, ninguna hoja queda sin asignar', () => {
    const r = repartir(hojas, ['a', 'b', 'c']);
    expect(r.map((x) => x.hojas.length)).toEqual([3, 2, 2]);
    expect(r.flatMap((x) => x.hojas)).toEqual(hojas);
  });

  /** Dos personas en la misma hoja = contar dos veces lo mismo. */
  it('con menos hojas que personas, las que sobran quedan vacias', () => {
    const r = repartir([1, 2], ['a', 'b', 'c']);
    expect(r.map((x) => x.hojas.length)).toEqual([1, 1, 0]);
  });

  it('sin personas devuelve vacio en vez de explotar', () => {
    expect(repartir(hojas, [])).toEqual([]);
  });
});

describe('numeroDeHoja', () => {
  it('base 1 y tres digitos', () => {
    expect(numeroDeHoja(0)).toBe('001');
    expect(numeroDeHoja(30)).toBe('031');
  });

  it('pasando 999 no trunca: sigue siendo unico', () => {
    expect(numeroDeHoja(999)).toBe('1000');
  });
});

describe('zonaDeHoja', () => {
  it('la categoria dominante rotula la hoja', () => {
    expect(zonaDeHoja([item('1', 'GALLETAS'), item('2', 'GALLETAS'), item('3', 'WAFERS')])).toBe('GALLETAS');
  });

  it('una hoja toda sin categoria se rotula "SIN CATEGORIA"', () => {
    expect(zonaDeHoja([item('1', null), item('2', null)])).toBe('SIN CATEGORIA');
  });

  it('hoja vacia no explota', () => {
    expect(zonaDeHoja([])).toBe('SIN CATEGORIA');
  });
});

/**
 * El caso real medido: 1.548 items con stock en el almacen probado, hojas de
 * 50. Se verifica de punta a punta que nada se pierda ni se duplique.
 */
describe('el inventario real de Market Trujillo', () => {
  it('1.548 items en hojas de 50: 31 hojas, todos los items, ninguno repetido', () => {
    const categorias = ['ABARROTES', 'BEBIDAS', 'GALLETAS', 'LICOR-PISCOS', null];
    const items = Array.from({ length: 1548 }, (_, i) =>
      item(String(i).padStart(6, '0'), categorias[i % categorias.length]!),
    );

    const ordenados = ordenarParaContar(items);
    const tamanos = partirEnHojas(ordenados.length, 50);

    expect(tamanos).toHaveLength(31);
    expect(tamanos.reduce((a, b) => a + b, 0)).toBe(1548);
    expect(new Set(ordenados.map((i) => i.codigo)).size).toBe(1548);

    // Y repartidas entre 8 contadores, nadie queda sin hojas ni se pierde una.
    const hojas = tamanos.map((_, i) => i);
    const reparto = repartir(hojas, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(reparto.flatMap((r) => r.hojas)).toHaveLength(31);
    expect(reparto.every((r) => r.hojas.length > 0)).toBe(true);
  });
});
