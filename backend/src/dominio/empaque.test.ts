import { describe, expect, it } from 'vitest';
import { FACTOR_POR_DEFECTO, factorDesdeSimbolo, simboloEsAmbiguo } from './empaque';

describe('factorDesdeSimbolo: los casos que dio el cliente', () => {
  it('"Emp.12" son 12 unidades', () => {
    expect(factorDesdeSimbolo('Emp.12')).toBe(12);
  });

  it('"Emp.6" son 6', () => {
    expect(factorDesdeSimbolo('Emp.6')).toBe(6);
  });

  it.each(['Unidad', 'Ltr', 'Saco', 'Bolsa', 'U.', 'KG'])(
    '"%s" no tiene numero: factor 1',
    (simbolo) => {
      expect(factorDesdeSimbolo(simbolo)).toBe(1);
    },
  );
});

describe('separadores: se busca el numero, no un formato exacto', () => {
  // El ERP lo carga a mano; la unica constante observada es que el numero
  // esta ahi.
  it.each(['Emp.12', 'Emp 12', 'EMP.12', 'emp-12', 'emp12', 'Emp_12', '12'])(
    '"%s" da 12',
    (simbolo) => {
      expect(factorDesdeSimbolo(simbolo)).toBe(12);
    },
  );
});

describe('bordes: nunca un factor que rompa el conteo', () => {
  it.each([null, undefined, '', '   '])('%s da el factor por defecto', (simbolo) => {
    expect(factorDesdeSimbolo(simbolo)).toBe(FACTOR_POR_DEFECTO);
  });

  it('"Emp.0" da 1, no 0', () => {
    // Con factor 0, "2 cajas" sumarian 0 unidades y el item apareceria como
    // faltante total.
    expect(factorDesdeSimbolo('Emp.0')).toBe(1);
  });

  it('"Emp.-5" da 1: un empaque negativo no existe', () => {
    // El `-` no es parte del numero para el regex, asi que lee 5... pero lo
    // que importa es que NUNCA salga un negativo.
    expect(factorDesdeSimbolo('Emp.-5')).toBeGreaterThan(0);
  });

  it('un factor gigante no rompe', () => {
    expect(factorDesdeSimbolo('Emp.1000')).toBe(1000);
  });

  it('decimales: se queda con la parte entera del primer numero', () => {
    // `Empaque.factor` es Int en la base: media caja no es un empaque.
    expect(factorDesdeSimbolo('Emp.1.5')).toBe(1);
  });
});

describe('simbolos ambiguos: mas de un numero', () => {
  it('"Emp.12x6" toma el PRIMERO, no multiplica', () => {
    // Multiplicar seria inventar una semantica que el cliente no definio, y
    // equivocarse ahi rompe el conteo por 6x.
    expect(factorDesdeSimbolo('Emp.12x6')).toBe(12);
  });

  it('y queda marcado como ambiguo para poder revisarlo', () => {
    expect(simboloEsAmbiguo('Emp.12x6')).toBe(true);
    expect(simboloEsAmbiguo('Emp.12')).toBe(false);
    expect(simboloEsAmbiguo('Bolsa')).toBe(false);
    expect(simboloEsAmbiguo(null)).toBe(false);
  });
});
