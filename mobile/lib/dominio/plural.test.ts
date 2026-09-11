/**
 * `pluralizar` resuelve "1 producto" vs "3 productos" en un solo lugar, en vez
 * de un `${n} productos` con el plural clavado que miente cuando n === 1
 * (bug real: "1 productos" en la búsqueda de Clasificación y en el Reporte a
 * gerencia). Toma las DOS formas para cubrir también los irregulares
 * ("1 excepción" / "2 excepciones"), donde un sufijo "s" no alcanza.
 */
import { describe, expect, it } from 'vitest';

import { pluralizar } from './plural';

describe('pluralizar: singular solo en 1, plural en todo lo demás', () => {
  it('n === 1 devuelve el singular', () => {
    expect(pluralizar(1, 'producto', 'productos')).toBe('producto');
  });

  it('n === 0 es plural (en español, "0 productos")', () => {
    expect(pluralizar(0, 'producto', 'productos')).toBe('productos');
  });

  it('n > 1 es plural', () => {
    expect(pluralizar(2, 'producto', 'productos')).toBe('productos');
    expect(pluralizar(11800, 'producto', 'productos')).toBe('productos');
  });

  it('sirve para irregulares: la forma plural va explícita, no un sufijo', () => {
    expect(pluralizar(1, 'excepción', 'excepciones')).toBe('excepción');
    expect(pluralizar(3, 'excepción', 'excepciones')).toBe('excepciones');
  });
});
