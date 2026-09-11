import { describe, expect, it } from 'vitest';
import { cifraMisHojas, cifraOSinRed, filaPct, motivoCorto } from './cifra-sin-red';
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

describe('cifraMisHojas', () => {
  // Bug real (2026-09-10): al entrar como Contador justo después de que el
  // Coordinador repartió la ronda 2, Inicio mostraba "0 hojas asignadas" --
  // un cero inventado, indistinguible del caso real (nadie te asignó nada
  // todavía). La causa: hojasSqlite.mias() puede devolver `[]` porque la
  // descarga de esa ronda TODAVÍA no terminó (o falló), y esa información
  // vive en `ultimaDescarga()` (hojas-sqlite.ts) -- Inicio no la consultaba.
  it('un array vacío CON una descarga que falló no es un 0 real: da null', () => {
    expect(cifraMisHojas([], { ok: false, motivo: 'sin-red' })).toBeNull();
    expect(cifraMisHojas([], { ok: false, motivo: 'error' })).toBeNull();
  });

  it('un array vacío SIN intento de descarga (todavía no se sabe) también da null', () => {
    expect(cifraMisHojas([], null)).toBeNull();
  });

  it('un array vacío CON una descarga que sí salió bien es un 0 real', () => {
    expect(cifraMisHojas([], { ok: true })).toBe(0);
  });

  it('con hojas, la cifra es la cantidad real -- el resultado de la descarga no importa', () => {
    expect(cifraMisHojas([{}, {}], { ok: false, motivo: 'sin-red' })).toBe(2);
    expect(cifraMisHojas([{}], null)).toBe(1);
  });
});

describe('motivoCorto', () => {
  it('traduce cada motivo a un texto corto para la fila de estado', () => {
    expect(motivoCorto('sin-red')).toBe('sin red');
    expect(motivoCorto('sesion-vencida')).toBe('sesión vencida');
    expect(motivoCorto('incompleta')).toBe('descarga incompleta');
    expect(motivoCorto('error')).toBe('no se pudo bajar');
  });

  it('sin motivo (todavía no se intentó) usa el mismo texto que un error genérico', () => {
    expect(motivoCorto(undefined)).toBe('no se pudo bajar');
  });
});
