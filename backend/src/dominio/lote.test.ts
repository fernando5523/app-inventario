/**
 * Tests de como se arman y reparten las hojas. Logica pura, sin base.
 *
 * El grupo que mas importa es `ordenarParaContar`: es lo que decide si el
 * operario barre un sector o cruza la tienda en cada renglon. Un bug ahi no
 * rompe nada visible -- simplemente hace que el inventario tarde el doble, y
 * eso no se detecta leyendo codigo.
 */

import { describe, expect, it } from 'vitest';

import { numeroDeHoja, ordenarParaContar, partirEnHojas, repartir, tamanoEfectivoDeHoja, zonaDeHoja } from './lote';

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

/**
 * EL TAMAÑO EFECTIVO: que una ronda chica se reparta entre los presentes en
 * vez de salir en una sola hoja para una sola persona.
 *
 * Pedido de Gilmer, reunión 2 (00:38:29): si hay 20 productos se le asigne a
 * los 20 presentes, "uno, uno, uno cada uno... de manera que todos alcancen".
 */
describe('tamanoEfectivoDeHoja', () => {
  it('LA RONDA 1 NO CAMBIA: con 980 ítems y 4 presentes manda el 50 elegido', () => {
    // Repartir daría hojas de 245, y nadie cuenta 245 ítems seguidos. El
    // tamaño elegido es un techo real, no una preferencia.
    expect(tamanoEfectivoDeHoja(980, 4, 50)).toBe(50);
  });

  it('16 ítems entre 4: hojas de 4, una por cabeza', () => {
    // El caso medido en el inventario 8073: antes era UNA hoja de 16 para
    // Elena y los otros tres sin nada.
    expect(tamanoEfectivoDeHoja(16, 4, 50)).toBe(4);
    expect(partirEnHojas(16, tamanoEfectivoDeHoja(16, 4, 50))).toEqual([4, 4, 4, 4]);
  });

  it('8 ítems entre 4: hojas de 2', () => {
    expect(tamanoEfectivoDeHoja(8, 4, 50)).toBe(2);
    expect(partirEnHojas(8, tamanoEfectivoDeHoja(8, 4, 50))).toEqual([2, 2, 2, 2]);
  });

  it('5 ítems entre 4: hojas de 1, y son CINCO hojas para cuatro personas', () => {
    // `repartir` le da 2 al primero y 1 a cada uno de los otros -- esa parte
    // no cambia, ya estaba bien.
    expect(tamanoEfectivoDeHoja(5, 4, 50)).toBe(1);
    expect(partirEnHojas(5, 1)).toEqual([1, 1, 1, 1, 1]);
  });

  it('MÁS PRESENTES QUE ÍTEMS: 5 entre 8 da hojas de 1, y tres se quedan sin', () => {
    // Un ítem no se parte en ocho. No se inventan hojas vacías ni se duplica
    // un ítem en dos hojas: eso rompería el conteo ciego y la asistencia.
    expect(tamanoEfectivoDeHoja(5, 8, 50)).toBe(1);
    expect(partirEnHojas(5, tamanoEfectivoDeHoja(5, 8, 50))).toHaveLength(5);
  });

  it('SIN PRESENTES: manda el tamaño elegido, sin tocar nada', () => {
    // Cero presentes es "todavía no se tomó asistencia", no "nadie va a
    // contar". Forzar hojas de 1 sería decidir sobre un dato que no existe.
    expect(tamanoEfectivoDeHoja(16, 0, 50)).toBe(50);
    expect(tamanoEfectivoDeHoja(980, 0, 20)).toBe(20);
  });

  it('nunca devuelve 0: una hoja de cero ítems no es una hoja', () => {
    expect(tamanoEfectivoDeHoja(1, 4, 50)).toBe(1);
    expect(tamanoEfectivoDeHoja(0, 4, 50)).toBe(1);
  });

  it('un solo presente: manda el techo, como siempre', () => {
    expect(tamanoEfectivoDeHoja(16, 1, 50)).toBe(16);
    expect(tamanoEfectivoDeHoja(980, 1, 50)).toBe(50);
  });

  it('respeta el tamaño elegido más chico: con 20 elegido no sube a 30', () => {
    expect(tamanoEfectivoDeHoja(980, 4, 20)).toBe(20);
  });

  it('rechaza un tamaño elegido inválido en vez de repartir cualquier cosa', () => {
    expect(() => tamanoEfectivoDeHoja(16, 4, 0)).toThrow();
    expect(() => tamanoEfectivoDeHoja(16, 4, -5)).toThrow();
  });
});
