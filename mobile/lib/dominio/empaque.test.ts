import { describe, expect, it } from 'vitest';
import { totalUnidades, validarConteo } from './empaque';
import type { Conteo, Empaque } from './tipos';

function conteo(parciales: Partial<Conteo> = {}): Conteo {
  return {
    productoId: 1,
    empaques: 0,
    sueltas: 0,
    confirmadoPorEscaner: false,
    contadoEn: '2026-09-01T10:00:00.000Z',
    ...parciales,
  };
}

function empaque(parciales: Partial<Empaque> = {}): Empaque {
  return {
    nombre: 'Caja',
    factor: 12,
    ...parciales,
  };
}

describe('totalUnidades', () => {
  it('2 cajas x12 + 0 sueltas = 24 (caso del mockup)', () => {
    expect(totalUnidades(conteo({ empaques: 2, sueltas: 0 }), empaque({ nombre: 'Caja', factor: 12 }))).toBe(24);
  });

  it('5 packs x6 + 2 sueltas = 32 (caso del mockup)', () => {
    expect(totalUnidades(conteo({ empaques: 5, sueltas: 2 }), empaque({ nombre: 'Pack', factor: 6 }))).toBe(32);
  });

  it('2 planchas x24 + 5 sueltas = 53 (caso del mockup)', () => {
    expect(totalUnidades(conteo({ empaques: 2, sueltas: 5 }), empaque({ nombre: 'Plancha', factor: 24 }))).toBe(53);
  });

  it('cero empaques y cero sueltas da cero', () => {
    expect(totalUnidades(conteo({ empaques: 0, sueltas: 0 }), empaque({ factor: 12 }))).toBe(0);
  });

  it('factor 1 (producto que solo va suelto): el total es igual a las sueltas', () => {
    expect(totalUnidades(conteo({ empaques: 0, sueltas: 7 }), empaque({ nombre: 'Unidad', factor: 1 }))).toBe(7);
  });

  it('factor 1 con empaques igual funciona (aunque no tenga sentido de negocio, la aritmetica es la misma)', () => {
    expect(totalUnidades(conteo({ empaques: 3, sueltas: 2 }), empaque({ nombre: 'Unidad', factor: 1 }))).toBe(5);
  });
});

describe('validarConteo', () => {
  it('no devuelve advertencias para un conteo valido y sueltas por debajo del factor', () => {
    expect(validarConteo(conteo({ empaques: 5, sueltas: 5 }), empaque({ nombre: 'Pack', factor: 6 }))).toEqual([]);
  });

  it('5 sueltas con pack de 6 esta bien: no hay advertencia', () => {
    expect(validarConteo(conteo({ sueltas: 5 }), empaque({ factor: 6 }))).toEqual([]);
  });

  it('8 sueltas con pack de 6 significa que no armo un pack: advierte, no corrige', () => {
    const advertencias = validarConteo(conteo({ sueltas: 8 }), empaque({ nombre: 'Pack', factor: 6 }));
    expect(advertencias).toHaveLength(1);
    expect(advertencias[0].tipo).toBe('sueltas-exceden-factor');
  });

  it('sueltas exactamente igual al factor tambien advierte (alcanza para un empaque mas)', () => {
    const advertencias = validarConteo(conteo({ sueltas: 6 }), empaque({ factor: 6 }));
    expect(advertencias.some((a) => a.tipo === 'sueltas-exceden-factor')).toBe(true);
  });

  it('NO corrige el valor: sigue devolviendo las sueltas tal cual las cargaron', () => {
    const c = conteo({ sueltas: 8 });
    validarConteo(c, empaque({ factor: 6 }));
    expect(c.sueltas).toBe(8);
  });

  it('factor 1: cualquier cantidad de sueltas es valida, no hay empaque en el que "deberian entrar"', () => {
    expect(validarConteo(conteo({ sueltas: 50 }), empaque({ nombre: 'Unidad', factor: 1 }))).toEqual([]);
  });

  it('empaques negativos advierten como valor invalido', () => {
    const advertencias = validarConteo(conteo({ empaques: -1 }), empaque({ factor: 12 }));
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });

  it('sueltas no enteras (decimales) advierten como valor invalido', () => {
    const advertencias = validarConteo(conteo({ sueltas: 2.5 }), empaque({ factor: 12 }));
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });

  it('empaques no enteros advierten como valor invalido', () => {
    const advertencias = validarConteo(conteo({ empaques: 1.5 }), empaque({ factor: 12 }));
    expect(advertencias.some((a) => a.tipo === 'valor-invalido')).toBe(true);
  });

  it('puede devolver mas de una advertencia a la vez', () => {
    const advertencias = validarConteo(conteo({ empaques: -1, sueltas: 8 }), empaque({ factor: 6 }));
    expect(advertencias.length).toBeGreaterThanOrEqual(2);
  });
});
