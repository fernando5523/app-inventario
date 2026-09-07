import { describe, expect, it } from 'vitest';

import { esUltimaPasada, estadoDePaso, etiquetaARecontar, textoBotonCierre, textoCierreExplicacion } from './texto-cierre-ronda';

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

describe('esUltimaPasada: cuándo cerrar TERMINA el conteo en vez de abrir otra ronda', () => {
  it('la 3ra siempre; y cualquier ronda cuando ya no queda nada por recontar', () => {
    expect(esUltimaPasada(3, 5)).toBe(true);
    expect(esUltimaPasada(1, 0)).toBe(true);
    expect(esUltimaPasada(2, 40)).toBe(false);
    expect(esUltimaPasada(1, 136)).toBe(false);
  });
});

describe('estadoDePaso: el badge de cada paso sale de la ronda ACTIVA, no de un literal', () => {
  it('EL BUG DEL CLIENTE — inventario en la 3ra: 1ro y 2do CERRADOS, 3ro EN CURSO', () => {
    expect(estadoDePaso(1, 3, true)).toBe('cerrado');
    // Antes el Paso 2 decía "en-proceso" (En curso) fijo: esa era la mentira.
    expect(estadoDePaso(2, 3, true)).toBe('cerrado');
    expect(estadoDePaso(3, 3, true)).toBe('en-curso');
  });

  it('inventario en la 1ra: la 1ra en curso, la 2da y 3ra pendientes', () => {
    expect(estadoDePaso(1, 1, true)).toBe('en-curso');
    expect(estadoDePaso(2, 1, false)).toBe('pendiente');
    expect(estadoDePaso(3, 1, false)).toBe('pendiente');
  });

  it('inventario en la 2da (intermedia): la 1ra cerrada, la 2da en curso, la 3ra pendiente', () => {
    expect(estadoDePaso(1, 2, true)).toBe('cerrado');
    expect(estadoDePaso(2, 2, true)).toBe('en-curso');
    expect(estadoDePaso(3, 2, false)).toBe('pendiente');
  });

  it('la ronda activa sin un solo conteo cargado es "pendiente", no "en curso"', () => {
    expect(estadoDePaso(1, 1, false)).toBe('pendiente');
  });

  it('sin ronda activa (el conteo ya cerró): las que corrieron cerradas, las que no, sin datos', () => {
    expect(estadoDePaso(1, null, true)).toBe('cerrado');
    expect(estadoDePaso(3, null, false)).toBe('sin-datos');
  });
});

describe('textos del bloque de cierre: nombran la ronda que corresponde, con ORDINAL', () => {
  it('ronda 1: la fila y el párrafo nombran el 2do conteo', () => {
    expect(etiquetaARecontar(1, 136)).toBe('A recontar en el 2do conteo');
    expect(textoCierreExplicacion(1, 136)).toContain('abre el 2do conteo');
  });

  it('ronda 2 (intermedia): nombran el 3er conteo, NUNCA el 2do (era la mentira reportada)', () => {
    expect(etiquetaARecontar(2, 40)).toBe('A recontar en el 3er conteo');
    const texto = textoCierreExplicacion(2, 40);
    expect(texto).toContain('abre el 3er conteo');
    expect(texto).not.toContain('2do conteo');
  });

  it('ronda 3 (última): sin "siguiente conteo"; cierra el conteo y queda para liquidar', () => {
    expect(etiquetaARecontar(3, 5)).toBe('Sin cuadrar (diferencia final para liquidar)');
    const texto = textoCierreExplicacion(3, 5);
    expect(texto).toContain('listo para liquidar');
    expect(texto).not.toMatch(/abre el .* conteo/);
  });

  it('todo cuadró antes de la última (aRecontar 0): también cierra sin prometer otra ronda', () => {
    expect(etiquetaARecontar(1, 0)).toBe('Sin cuadrar (diferencia final para liquidar)');
    expect(textoCierreExplicacion(1, 0)).toContain('listo para liquidar');
  });
});
