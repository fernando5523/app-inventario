import { describe, expect, it } from 'vitest';
import { cifraOSinRed, filaPct } from './cifra-sin-red';
import { formatoMiles } from '../../components/ui/formato';

describe('cifraOSinRed', () => {
  it('devuelve el valor formateado cuando no es null', () => {
    expect(cifraOSinRed(5)).toBe('5');
    expect(cifraOSinRed(1236, formatoMiles)).toBe('1.236');
  });

  it('devuelve "—" cuando el valor es null -- nunca un cero inventado', () => {
    expect(cifraOSinRed(null)).toBe('—');
    expect(cifraOSinRed(null, formatoMiles)).toBe('—');
  });

  it('un 0 real (con red) se distingue de null: "0", no "—"', () => {
    expect(cifraOSinRed(0)).toBe('0');
    expect(cifraOSinRed(0, formatoMiles)).toBe('0');
  });
});

describe('filaPct', () => {
  it('calcula el porcentaje cuando el total es un número real mayor a 0', () => {
    expect(filaPct(12, 25)).toBe('/ 25 (48%)');
    expect(filaPct(0, 10)).toBe('/ 10 (0%)');
    expect(filaPct(10, 10)).toBe('/ 10 (100%)');
  });

  it('dice "sin red" cuando el total es null -- no divide por un denominador inventado', () => {
    expect(filaPct(12, null)).toBe('sin red');
  });

  it('dice "sin hojas creadas" cuando el total es 0 real -- nunca "0%" con denominador 0', () => {
    expect(filaPct(0, 0)).toBe('sin hojas creadas');
  });
});
