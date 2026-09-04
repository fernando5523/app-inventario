/**
 * Tests de que almacenes entran al inventario. Logica pura, sin base.
 *
 * El caso que justifica todo el archivo es `MD07_CEN`: cumple el patron
 * "Market Disponible" y NO se inventaria. Si alguien alguna vez reemplaza
 * la lista por una regex, el primer test de abajo se pone rojo.
 */

import { describe, expect, it } from 'vitest';

import {
  ALMACENES_INICIALES,
  agregar,
  filtrar,
  parsear,
  serializar,
  type AlmacenListado,
} from './d365.almacenes-inventario';

/** Como los devuelve Dynamics, incluyendo los que no se inventarian. */
const DE_DYNAMICS: AlmacenListado[] = [
  { codigo: 'MC01_LUZ', nombre: 'ALMACÉN CUARENTENA MARKET LUZURIAGA' },
  { codigo: 'MD01_LUZ', nombre: 'ALMACÉN DISPONIBLE MARKET LUZURIAGA' },
  { codigo: 'MD07_CEN', nombre: 'ALMACÉN DISPONIBLE MARKET CENTER' },
  { codigo: 'MD10', nombre: 'ALMACÉN DISPONIBLE MARKET SANTA ROSA' },
  { codigo: 'MT01_LUZ', nombre: 'ALMACÉN TRÁNSITO MARKET LUZURIAGA' },
];

describe('la lista inicial', () => {
  it('son 10 y NO incluye MD07_CEN', () => {
    expect(ALMACENES_INICIALES).toHaveLength(10);
    // El contraejemplo que prueba que un patron sobre el codigo no sirve:
    // MD07_CEN es "Market Disponible" igual que los otros diez y queda afuera.
    expect(ALMACENES_INICIALES).not.toContain('MD07_CEN');
    expect(ALMACENES_INICIALES).toContain('MD01_LUZ');
    expect(ALMACENES_INICIALES).toContain('MD10');
  });
});

describe('parsear', () => {
  it('separa por coma y limpia espacios', () => {
    expect(parsear('MD01_LUZ, MD02_JRC ,MD10')).toEqual(['MD01_LUZ', 'MD02_JRC', 'MD10']);
  });

  it('descarta vacios de comas de mas', () => {
    expect(parsear('MD01_LUZ,,MD02_JRC,')).toEqual(['MD01_LUZ', 'MD02_JRC']);
  });

  it('normaliza a mayusculas', () => {
    expect(parsear('md01_luz')).toEqual(['MD01_LUZ']);
  });

  it('no repite', () => {
    expect(parsear('MD10,MD10,md10')).toEqual(['MD10']);
  });

  it('null, undefined o vacio dan lista vacia', () => {
    expect(parsear(null)).toEqual([]);
    expect(parsear(undefined)).toEqual([]);
    expect(parsear('   ')).toEqual([]);
  });
});

describe('serializar', () => {
  it('ordena y junta con coma', () => {
    expect(serializar(['MD10', 'MD01_LUZ'])).toBe('MD01_LUZ,MD10');
  });

  it('ida y vuelta no pierde nada', () => {
    expect(parsear(serializar([...ALMACENES_INICIALES])).sort()).toEqual([...ALMACENES_INICIALES].sort());
  });
});

describe('agregar: la tienda nueva', () => {
  it('agrega uno que no estaba y avisa que cambio', () => {
    const r = agregar(['MD01_LUZ'], 'MD12_NUEVO');
    expect(r.agregado).toBe(true);
    expect(r.lista).toContain('MD12_NUEVO');
  });

  /** Sin esto se escribiria en la base y se auditaria un cambio que no ocurrio. */
  it('uno que ya estaba NO cuenta como cambio', () => {
    expect(agregar(['MD01_LUZ'], 'MD01_LUZ').agregado).toBe(false);
    expect(agregar(['MD01_LUZ'], 'md01_luz').agregado).toBe(false);
  });

  it('un codigo vacio no agrega nada', () => {
    expect(agregar(['MD01_LUZ'], '  ').agregado).toBe(false);
  });
});

describe('filtrar', () => {
  it('deja solo los habilitados', () => {
    const r = filtrar(DE_DYNAMICS, ['MD01_LUZ', 'MD10']);
    expect(r.map((a) => a.codigo)).toEqual(['MD01_LUZ', 'MD10']);
  });

  it('MD07_CEN queda afuera aunque parezca de tienda', () => {
    const r = filtrar(DE_DYNAMICS, [...ALMACENES_INICIALES]);
    expect(r.map((a) => a.codigo)).not.toContain('MD07_CEN');
  });

  it('cuarentena y transito quedan afuera', () => {
    const r = filtrar(DE_DYNAMICS, [...ALMACENES_INICIALES]);
    expect(r.map((a) => a.codigo)).toEqual(['MD01_LUZ', 'MD10']);
  });

  /**
   * Sin configuracion se muestra TODO, no cero. Un selector vacio parece que
   * Dynamics no responde, y dejaria al Administrador sin poder dar de alta
   * ninguna tienda sin ningun mensaje que lo explique.
   */
  it('lista de habilitados vacia devuelve TODO, no nada', () => {
    expect(filtrar(DE_DYNAMICS, [])).toHaveLength(DE_DYNAMICS.length);
  });

  it('un habilitado que Dynamics no devolvio simplemente no aparece', () => {
    const r = filtrar(DE_DYNAMICS, ['MD01_LUZ', 'MD99_QUE_NO_EXISTE']);
    expect(r.map((a) => a.codigo)).toEqual(['MD01_LUZ']);
  });
});
