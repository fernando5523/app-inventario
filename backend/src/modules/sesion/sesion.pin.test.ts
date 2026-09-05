import { describe, expect, it } from 'vitest';
import { SolicitudInvalida } from '../../shared/errores';
import { esPinPredecible, esPinTrivial, validarCambioDePin, validarPinElegible } from './sesion.pin';

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

describe('validarPinElegible', () => {
  it('al RESETEAR (con id): rechaza el id con ceros', () => {
    expect(() => validarPinElegible('000022', 22)).toThrow(SolicitudInvalida);
    expect(() => validarPinElegible('001000', 1000)).toThrow(SolicitudInvalida);
  });

  it('rechaza los triviales, con o sin id', () => {
    expect(() => validarPinElegible('123456', 22)).toThrow(SolicitudInvalida);
    expect(() => validarPinElegible('111111', 22)).toThrow(SolicitudInvalida);
    expect(() => validarPinElegible('654321')).toThrow(SolicitudInvalida);
    expect(() => validarPinElegible('000000')).toThrow(SolicitudInvalida);
  });

  it('el mensaje dice QUE esta mal y COMO salir, no solo "invalido"', () => {
    // Predecible: menciona la lista de login (de donde se deduce el PIN).
    expect(() => validarPinElegible('000022', 22)).toThrow(/lista de login/i);
    // Trivial: nombra el ejemplo concreto para que se entienda.
    expect(() => validarPinElegible('123456')).toThrow(/123456/);
  });

  it('al CREAR (sin id): el predecible NO aplica -- todavia no hay id -- pero el trivial si', () => {
    // El id lo autogenera Prisma al crear, asi que "000022" no se puede
    // considerar predecible de nadie en ese momento: se acepta.
    expect(() => validarPinElegible('000022')).not.toThrow();
    // Los triviales se frenan igual, con o sin id.
    expect(() => validarPinElegible('123456')).toThrow(SolicitudInvalida);
  });

  it('acepta un PIN normal', () => {
    expect(() => validarPinElegible('820394', 22)).not.toThrow();
    expect(() => validarPinElegible('445566')).not.toThrow();
  });

  it('los PINs que siembra el seed (PIN_DEV_POR_ROL) siguen siendo reseteables', () => {
    // Si alguno de estos cayera en predecible o trivial, el seed quedaria
    // INCORREGIBLE desde la app: nadie podria resetear una cuenta de dev a su
    // valor conocido. Estos 4 son los de prisma/seed.ts#PIN_DEV_POR_ROL; si se
    // cambian alla y aca no, este test avisa. Se prueban con un id realista
    // por rol (coordinador 101, conteo 102, auditor 103, administrador 1000).
    expect(() => validarPinElegible('724193', 101)).not.toThrow();
    expect(() => validarPinElegible('518274', 102)).not.toThrow();
    expect(() => validarPinElegible('306581', 103)).not.toThrow();
    expect(() => validarPinElegible('947260', 1000)).not.toThrow();
  });
});
