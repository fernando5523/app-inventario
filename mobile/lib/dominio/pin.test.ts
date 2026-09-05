/**
 * Mismos casos que backend/src/modules/sesion/sesion.pin.test.ts — este
 * archivo es el espejo de sesion.pin.ts (ver el comentario ahí de por qué
 * se duplica). Si un caso se agrega de un lado y no del otro, las dos
 * reglas se desalinean sin que nada avise.
 */

import { describe, expect, it } from 'vitest';
import { esPinPredecible, esPinTrivial, validarPinNuevo } from './pin';

describe('esPinPredecible', () => {
  it('detecta el PIN que genera el seed: el id con ceros adelante', () => {
    expect(esPinPredecible(102, '000102')).toBe(true);
    expect(esPinPredecible(1000, '001000')).toBe(true);
    expect(esPinPredecible(103, '000103')).toBe(true);
  });

  it('no marca un PIN cualquiera', () => {
    expect(esPinPredecible(102, '445566')).toBe(false);
    expect(esPinPredecible(102, '000103')).toBe(false);
  });
});

describe('esPinTrivial', () => {
  it('rechaza todos los dígitos iguales', () => {
    expect(esPinTrivial('000000')).toBe(true);
    expect(esPinTrivial('111111')).toBe(true);
    expect(esPinTrivial('999999')).toBe(true);
  });

  it('rechaza secuencias corridas, para arriba y para abajo', () => {
    expect(esPinTrivial('123456')).toBe(true);
    expect(esPinTrivial('234567')).toBe(true);
    expect(esPinTrivial('654321')).toBe(true);
  });

  it('acepta un PIN normal', () => {
    expect(esPinTrivial('445566')).toBe(false);
    expect(esPinTrivial('820394')).toBe(false);
  });
});

describe('validarPinNuevo', () => {
  it('acepta un cambio razonable', () => {
    expect(validarPinNuevo('000102', '820394', 102)).toBeNull();
  });

  it('rechaza que el nuevo sea igual al actual', () => {
    expect(validarPinNuevo('820394', '820394', 102)).toBe('El PIN nuevo tiene que ser distinto del actual.');
  });

  it('RECHAZA volver al PIN predecible del seed', () => {
    expect(validarPinNuevo('820394', '000102', 102)).toMatch(/lista de login/i);
  });

  it('rechaza los triviales', () => {
    expect(validarPinNuevo('820394', '111111', 102)).toMatch(/000000|111111|123456/);
    expect(validarPinNuevo('820394', '123456', 102)).toMatch(/000000|111111|123456/);
  });

  it('el PIN predecible de OTRA persona sí se puede usar', () => {
    // "000103" no es deducible del id 102: solo se bloquea el propio.
    expect(validarPinNuevo('820394', '000103', 102)).toBeNull();
  });
});
