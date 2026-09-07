import { describe, expect, it } from 'vitest';
import { debeRefrescar, esVueltaAPrimerPlano, type EstadoApp } from './refresco';

describe('esVueltaAPrimerPlano', () => {
  it('background -> active: la persona volvió a la app', () => {
    expect(esVueltaAPrimerPlano('background', 'active')).toBe(true);
  });

  it('inactive -> active: también cuenta (iOS, salir del switcher)', () => {
    expect(esVueltaAPrimerPlano('inactive', 'active')).toBe(true);
  });

  it('active -> active NO cuenta: AppState repite el evento en algunos equipos', () => {
    // Sin esta guarda, cada evento espurio dispararía una recarga.
    expect(esVueltaAPrimerPlano('active', 'active')).toBe(false);
  });

  it.each<[EstadoApp, EstadoApp]>([
    ['active', 'background'],
    ['active', 'inactive'],
    ['background', 'inactive'],
    ['inactive', 'background'],
  ])('%s -> %s: irse o moverse fuera de foco nunca refresca', (anterior, siguiente) => {
    expect(esVueltaAPrimerPlano(anterior, siguiente)).toBe(false);
  });

  it('lo que importa es el CAMBIO, no el estado nuevo', () => {
    // Mismo estado final `active`, distinto resultado según de dónde venía.
    expect(esVueltaAPrimerPlano('background', 'active')).toBe(true);
    expect(esVueltaAPrimerPlano('active', 'active')).toBe(false);
  });
});

describe('debeRefrescar', () => {
  it('en reposo y sin pausa: refresca', () => {
    expect(debeRefrescar({ enVuelo: false, pausado: false })).toBe(true);
  });

  it('con una recarga ya corriendo: no dispara otra', () => {
    // Enfocar la pantalla y volver de segundo plano pasan JUNTOS al
    // desbloquear el teléfono: sin el candado salen dos pedidas iguales y la
    // que conteste segunda pisa a la primera.
    expect(debeRefrescar({ enVuelo: true, pausado: false })).toBe(false);
  });

  it('pausado: no refresca, aunque no haya nada en vuelo', () => {
    // Modal abierto o formulario a medio escribir. Refrescar acá le cierra
    // el modal o le pisa lo que escribió: es perder trabajo de la persona.
    expect(debeRefrescar({ enVuelo: false, pausado: true })).toBe(false);
  });

  it('pausado gana aunque tampoco haya nada corriendo: es la regla, no una optimización', () => {
    expect(debeRefrescar({ enVuelo: true, pausado: true })).toBe(false);
  });

  it.each([
    [false, false, true],
    [true, false, false],
    [false, true, false],
    [true, true, false],
  ])('enVuelo=%s pausado=%s -> %s', (enVuelo, pausado, esperado) => {
    expect(debeRefrescar({ enVuelo, pausado })).toBe(esperado);
  });
});
