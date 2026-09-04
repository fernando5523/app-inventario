import { describe, expect, it } from 'vitest';
import { SolicitudInvalida } from '../../shared/errores';
import { esPinPredecible, esPinTrivial, validarCambioDePin } from './sesion.pin';

describe('esPinPredecible', () => {
  it('detecta el PIN que genera el seed: el id con ceros adelante', () => {
    // La pantalla de login LISTA a todas las personas con su nombre, asi que
    // cualquiera que abra la app deduce el PIN de todos.
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
  it('rechaza todos los digitos iguales', () => {
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

describe('validarCambioDePin', () => {
  it('acepta un cambio razonable', () => {
    expect(() => validarCambioDePin({ colaboradorId: 102, pinActual: '000102', pinNuevo: '820394' })).not.toThrow();
  });

  it('rechaza que el nuevo sea igual al actual', () => {
    expect(() => validarCambioDePin({ colaboradorId: 102, pinActual: '820394', pinNuevo: '820394' })).toThrow(
      SolicitudInvalida,
    );
  });

  it('RECHAZA volver al PIN predecible del seed', () => {
    // Seria volver voluntariamente al agujero que este endpoint viene a cerrar.
    expect(() => validarCambioDePin({ colaboradorId: 102, pinActual: '820394', pinNuevo: '000102' })).toThrow(
      SolicitudInvalida,
    );
  });

  it('el mensaje explica POR QUE, no solo que no se puede', () => {
    expect(() => validarCambioDePin({ colaboradorId: 102, pinActual: '820394', pinNuevo: '000102' })).toThrow(
      /lista de login/i,
    );
  });

  it('rechaza los triviales', () => {
    expect(() => validarCambioDePin({ colaboradorId: 102, pinActual: '820394', pinNuevo: '111111' })).toThrow(
      SolicitudInvalida,
    );
    expect(() => validarCambioDePin({ colaboradorId: 102, pinActual: '820394', pinNuevo: '123456' })).toThrow(
      SolicitudInvalida,
    );
  });

  it('el PIN predecible de OTRA persona si se puede usar', () => {
    // "000103" no es deducible del id 102: solo se bloquea el propio.
    expect(() => validarCambioDePin({ colaboradorId: 102, pinActual: '820394', pinNuevo: '000103' })).not.toThrow();
  });
});
