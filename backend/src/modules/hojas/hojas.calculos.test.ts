import { describe, expect, it } from 'vitest';
import { SolicitudInvalida } from '../../shared/errores';
import { estadoParaElFront, estadoTrasContar, totalUnidades, validarFactor } from './hojas.calculos';

describe('totalUnidades: el total se calcula, no se guarda', () => {
  // Los mismos casos que mobile/lib/dominio/empaque.test.ts y que la maqueta
  // conteo.html ya validada por el cliente: la cuenta tiene que dar igual de
  // los dos lados del puente.
  it('2 cajas x12 + 0 sueltas = 24', () => {
    expect(totalUnidades({ empaques: 2, sueltas: 0 }, 12)).toBe(24);
  });

  it('5 packs x6 + 2 sueltas = 32', () => {
    expect(totalUnidades({ empaques: 5, sueltas: 2 }, 6)).toBe(32);
  });

  it('2 planchas x24 + 5 sueltas = 53', () => {
    expect(totalUnidades({ empaques: 2, sueltas: 5 }, 24)).toBe(53);
  });

  it('cero y cero da cero', () => {
    expect(totalUnidades({ empaques: 0, sueltas: 0 }, 12)).toBe(0);
  });

  it('solo sueltas, sin empaques cerrados', () => {
    expect(totalUnidades({ empaques: 0, sueltas: 7 }, 12)).toBe(7);
  });
});

describe('validarFactor', () => {
  it.each([0, -1, 1.5])('rechaza el factor %s: daria un total absurdo', (factor) => {
    expect(() => validarFactor(factor)).toThrow(SolicitudInvalida);
  });

  it('acepta un factor de 1 (producto que se cuenta por unidad)', () => {
    expect(() => validarFactor(1)).not.toThrow();
  });
});

describe('estadoTrasContar', () => {
  it('el primer conteo saca la hoja de pendiente', () => {
    expect(estadoTrasContar('pendiente')).toBe('en_proceso');
  });

  it('contar de nuevo no la mueve de en_proceso', () => {
    expect(estadoTrasContar('en_proceso')).toBe('en_proceso');
  });

  it('NUNCA finaliza sola: eso es una decision explicita', () => {
    // Que se hayan contado los 50 items no significa que el operario
    // termino de revisar, y finalizar es un punto de no retorno.
    expect(estadoTrasContar('en_proceso')).not.toBe('finalizada');
  });
});

describe('estadoParaElFront', () => {
  it('traduce el enum de Prisma al del dominio del front', () => {
    // Prisma expone el NOMBRE del miembro (en_proceso), no su @map.
    expect(estadoParaElFront('en_proceso')).toBe('en-proceso');
    expect(estadoParaElFront('pendiente')).toBe('pendiente');
    expect(estadoParaElFront('finalizada')).toBe('finalizada');
  });
});
