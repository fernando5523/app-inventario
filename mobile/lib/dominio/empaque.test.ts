import { describe, expect, it } from 'vitest';
import { totalUnidades, validarConteo } from './empaque';
import type { Conteo, Empaque, LineaEmpaque } from './tipos';

function conteo(parciales: Partial<Conteo> = {}): Conteo {
  return {
    productoId: 1,
    empaques: [],
    sueltas: 0,
    confirmadoPorEscaner: false,
    contadoEn: '2026-09-01T10:00:00.000Z',
    ...parciales,
  };
}

function linea(empaqueNombre: string, cantidad: number): LineaEmpaque {
  return { empaqueNombre, cantidad };
}

const CAJA: Empaque = { nombre: 'Caja', factor: 12 };
const PACK: Empaque = { nombre: 'Pack', factor: 6 };
const PLANCHA: Empaque = { nombre: 'Plancha', factor: 24 };

describe('totalUnidades', () => {
  it('2 cajas x12 + 0 sueltas = 24 (caso del mockup, un solo empaque)', () => {
    expect(totalUnidades(conteo({ empaques: [linea('Caja', 2)], sueltas: 0 }), [CAJA])).toBe(24);
  });

  it('5 packs x6 + 2 sueltas = 32 (caso del mockup, un solo empaque)', () => {
    expect(totalUnidades(conteo({ empaques: [linea('Pack', 5)], sueltas: 2 }), [PACK])).toBe(32);
  });

  it('2 planchas x24 + 5 sueltas = 53 (caso del mockup, un solo empaque)', () => {
    expect(totalUnidades(conteo({ empaques: [linea('Plancha', 2)], sueltas: 5 }), [PLANCHA])).toBe(53);
  });

  it('cero lineas y cero sueltas da cero', () => {
    expect(totalUnidades(conteo({ empaques: [], sueltas: 0 }), [CAJA])).toBe(0);
  });

  it('sin ningún empaque cerrado, el total es igual a las sueltas', () => {
    expect(totalUnidades(conteo({ empaques: [], sueltas: 7 }), [CAJA])).toBe(7);
  });

  it('VARIOS empaques del mismo producto: 2 cajas x12 + 3 packs x6 + 5 sueltas = 47 (caso real del cliente)', () => {
    const c = conteo({ empaques: [linea('Caja', 2), linea('Pack', 3)], sueltas: 5 });
    expect(totalUnidades(c, [CAJA, PACK])).toBe(47);
  });

  it('tres empaques distintos a la vez suman los tres', () => {
    const c = conteo({ empaques: [linea('Caja', 1), linea('Pack', 1), linea('Plancha', 1)], sueltas: 0 });
    expect(totalUnidades(c, [CAJA, PACK, PLANCHA])).toBe(12 + 6 + 24);
  });

  it('el orden de las líneas no cambia el total', () => {
    const a = conteo({ empaques: [linea('Caja', 2), linea('Pack', 3)], sueltas: 5 });
    const b = conteo({ empaques: [linea('Pack', 3), linea('Caja', 2)], sueltas: 5 });
    expect(totalUnidades(a, [CAJA, PACK])).toBe(totalUnidades(b, [CAJA, PACK]));
  });

  it('una línea con cantidad 0 no suma nada (pero tampoco rompe)', () => {
    expect(totalUnidades(conteo({ empaques: [linea('Caja', 0), linea('Pack', 3)], sueltas: 0 }), [CAJA, PACK])).toBe(18);
  });

  it('una línea que referencia un empaque que el producto NO tiene revienta en vez de subcontar en silencio', () => {
    const c = conteo({ empaques: [linea('Fardo', 1)], sueltas: 0 });
    expect(() => totalUnidades(c, [CAJA, PACK])).toThrow();
  });
});

describe('validarConteo', () => {
  it('un solo empaque, conteo válido y sueltas por debajo del factor: sin advertencias', () => {
    expect(validarConteo(conteo({ empaques: [linea('Pack', 5)], sueltas: 5 }), [PACK])).toEqual([]);
  });

  it('un solo empaque, 8 sueltas con pack de 6: advierte, no corrige', () => {
    const advertencias = validarConteo(conteo({ sueltas: 8 }), [PACK]);
    expect(advertencias).toHaveLength(1);
    expect(advertencias[0].tipo).toBe('sueltas-exceden-factor');
  });

  it('sueltas exactamente igual al factor también advierte', () => {
    const advertencias = validarConteo(conteo({ sueltas: 6 }), [PACK]);
    expect(advertencias.some((a) => a.tipo === 'sueltas-exceden-factor')).toBe(true);
  });

  it('NO corrige el valor: sigue devolviendo las sueltas tal cual las cargaron', () => {
    const c = conteo({ sueltas: 8 });
    validarConteo(c, [PACK]);
    expect(c.sueltas).toBe(8);
  });

  it('sin ningún empaque en el catálogo del producto: cualquier cantidad de sueltas es válida', () => {
    expect(validarConteo(conteo({ sueltas: 50 }), [])).toEqual([]);
  });

  it('VARIOS empaques: 8 sueltas con Caja(12) y Pack(6) presentes advierte contra el MENOR factor (6), no el mayor', () => {
    const advertencias = validarConteo(conteo({ sueltas: 8 }), [CAJA, PACK]);
    expect(advertencias).toHaveLength(1);
    expect(advertencias[0].tipo).toBe('sueltas-exceden-factor');
    expect(advertencias[0].mensaje).toContain('Pack');
  });

  it('VARIOS empaques: 5 sueltas con Caja(12) y Pack(6) presentes NO advierte (no alcanza ni para el menor)', () => {
    expect(validarConteo(conteo({ sueltas: 5 }), [CAJA, PACK])).toEqual([]);
  });

  it('una línea con cantidad negativa advierte como valor inválido', () => {
    const advertencias = validarConteo(conteo({ empaques: [linea('Caja', -1)] }), [CAJA]);
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });

  it('una línea con cantidad no entera (decimal) advierte como valor inválido', () => {
    const advertencias = validarConteo(conteo({ empaques: [linea('Caja', 1.5)] }), [CAJA]);
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });

  it('sueltas no enteras (decimales) advierten como valor inválido', () => {
    const advertencias = validarConteo(conteo({ sueltas: 2.5 }), [CAJA]);
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });

  it('sueltas negativas advierten como valor inválido', () => {
    const advertencias = validarConteo(conteo({ sueltas: -1 }), [CAJA]);
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });

  it('puede devolver más de una advertencia a la vez', () => {
    const advertencias = validarConteo(conteo({ empaques: [linea('Caja', -1)], sueltas: 8 }), [CAJA, PACK]);
    expect(advertencias.length).toBeGreaterThanOrEqual(2);
  });

  it('una línea que referencia un empaque inexistente en el producto también advierte, no revienta', () => {
    const advertencias = validarConteo(conteo({ empaques: [linea('Fardo', 1)] }), [CAJA]);
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });
});
