import { describe, expect, it } from 'vitest';

import { textoBotonCierre } from './texto-cierre-ronda';

// Formateador trivial: lo que se prueba acá es el TEXTO (qué ronda cierra y
// qué pasa después), no el formato de miles — ese ya tiene su propio test.
const fmt = (n: number) => String(n);

describe('textoBotonCierre: el botón dice qué ronda CIERRA y qué pasa DESPUÉS', () => {
  it('ronda 1 con ítems por recontar: cierra la 1ra y abre la 2da', () => {
    expect(textoBotonCierre(1, 136, fmt)).toBe('Cerrar el 1er conteo y abrir el 2do · 136 ítems');
  });

  it('ronda 2 con ítems por recontar: cierra la 2da y abre la 3ra — NUNCA "abrir el 2do" (esa era la mentira)', () => {
    expect(textoBotonCierre(2, 40, fmt)).toBe('Cerrar el 2do conteo y abrir el 3er · 40 ítems');
  });

  it('ronda 3 (última pasada del ciclo): cierra la 3ra y TERMINA el inventario, no promete una 4ta', () => {
    expect(textoBotonCierre(3, 5, fmt)).toBe('Cerrar el 3er conteo y terminar el inventario');
  });

  it('sin nada por recontar (aRecontar 0, todo cuadró): cerrar termina el inventario aunque no sea la 3ra ronda', () => {
    expect(textoBotonCierre(1, 0, fmt)).toBe('Cerrar el 1er conteo y terminar el inventario');
  });
});
