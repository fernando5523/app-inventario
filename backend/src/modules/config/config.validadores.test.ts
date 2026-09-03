import { describe, expect, it } from 'vitest';
import { SolicitudInvalida } from '../../shared/errores';
import { parsearValor, VALIDADORES } from './config.validadores';

describe('VALIDADORES.TAMANO_HOJA_DEFECTO', () => {
  it('acepta 20, 30 y 50', () => {
    expect(VALIDADORES.TAMANO_HOJA_DEFECTO(20)).toBe('20');
    expect(VALIDADORES.TAMANO_HOJA_DEFECTO(30)).toBe('30');
    expect(VALIDADORES.TAMANO_HOJA_DEFECTO(50)).toBe('50');
  });

  it('rechaza cualquier otro numero', () => {
    expect(() => VALIDADORES.TAMANO_HOJA_DEFECTO(25)).toThrow(SolicitudInvalida);
    expect(() => VALIDADORES.TAMANO_HOJA_DEFECTO(0)).toThrow(SolicitudInvalida);
  });
});

describe('VALIDADORES.CANTIDAD_CONTEOS_CICLO', () => {
  it('acepta enteros positivos', () => {
    expect(VALIDADORES.CANTIDAD_CONTEOS_CICLO(3)).toBe('3');
    expect(VALIDADORES.CANTIDAD_CONTEOS_CICLO(1)).toBe('1');
  });

  it('rechaza cero, negativos y decimales', () => {
    expect(() => VALIDADORES.CANTIDAD_CONTEOS_CICLO(0)).toThrow(SolicitudInvalida);
    expect(() => VALIDADORES.CANTIDAD_CONTEOS_CICLO(-1)).toThrow(SolicitudInvalida);
    expect(() => VALIDADORES.CANTIDAD_CONTEOS_CICLO(2.5)).toThrow(SolicitudInvalida);
  });
});

describe('VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE', () => {
  it('acepta 0.5 (la "mitad" que menciona Oscar en la reunion)', () => {
    expect(VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE(0.5)).toBe('0.5');
  });

  it('acepta cualquier fraccion estrictamente entre 0 y 1', () => {
    expect(VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE(0.1)).toBe('0.1');
    expect(VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE(0.99)).toBe('0.99');
  });

  it('rechaza 0 y 1 (limites excluidos) y cualquier valor fuera de rango', () => {
    expect(() => VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE(0)).toThrow(SolicitudInvalida);
    expect(() => VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE(1)).toThrow(SolicitudInvalida);
    expect(() => VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE(-0.5)).toThrow(SolicitudInvalida);
    expect(() => VALIDADORES.UMBRAL_MEDIA_UNIDAD_PAQUETE(1.5)).toThrow(SolicitudInvalida);
  });
});

describe('parsearValor', () => {
  it('entero: castea a number entero', () => {
    expect(parsearValor('50', 'entero')).toBe(50);
  });

  it('decimal: castea a number con fraccion', () => {
    expect(parsearValor('0.5', 'decimal')).toBe(0.5);
  });

  it('texto: lo deja como string', () => {
    expect(parsearValor('hola', 'texto')).toBe('hola');
  });
});
