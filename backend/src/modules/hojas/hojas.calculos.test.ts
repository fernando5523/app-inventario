import { describe, expect, it } from 'vitest';
import { SolicitudInvalida } from '../../shared/errores';
import { estadoParaElFront, estadoTrasContar, totalUnidades, validarFactores } from './hojas.calculos';

const CAJA_12 = [{ nombre: 'Caja', factor: 12 }];
const PACK_6 = [{ nombre: 'Pack', factor: 6 }];
const PLANCHA_24 = [{ nombre: 'Plancha', factor: 24 }];

describe('totalUnidades: el total se calcula, no se guarda', () => {
  // Los mismos casos que mobile/lib/dominio/empaque.test.ts y que la maqueta
  // conteo.html ya validada por el cliente: la cuenta tiene que dar igual de
  // los dos lados del puente.
  it('2 cajas x12 + 0 sueltas = 24', () => {
    expect(totalUnidades({ empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }], sueltas: 0 }, CAJA_12)).toBe(24);
  });

  it('5 packs x6 + 2 sueltas = 32', () => {
    expect(totalUnidades({ empaques: [{ empaqueNombre: 'Pack', cantidad: 5 }], sueltas: 2 }, PACK_6)).toBe(32);
  });

  it('2 planchas x24 + 5 sueltas = 53', () => {
    expect(totalUnidades({ empaques: [{ empaqueNombre: 'Plancha', cantidad: 2 }], sueltas: 5 }, PLANCHA_24)).toBe(53);
  });

  it('cero y cero da cero', () => {
    expect(totalUnidades({ empaques: [{ empaqueNombre: 'Caja', cantidad: 0 }], sueltas: 0 }, CAJA_12)).toBe(0);
  });

  it('solo sueltas, sin ninguna linea de empaque', () => {
    expect(totalUnidades({ empaques: [], sueltas: 7 }, CAJA_12)).toBe(7);
  });

  it('el ejemplo del cliente: 2 cajas x12 + 3 packs x6 + 5 sueltas = 47', () => {
    const empaques = [
      { empaqueNombre: 'Caja', cantidad: 2 },
      { empaqueNombre: 'Pack', cantidad: 3 },
    ];
    const disponibles = [...CAJA_12, ...PACK_6];
    expect(totalUnidades({ empaques, sueltas: 5 }, disponibles)).toBe(47);
  });

  it('tira si una linea referencia un empaque que el producto no tiene', () => {
    const conteo = { empaques: [{ empaqueNombre: 'Fardo', cantidad: 1 }], sueltas: 0 };
    expect(() => totalUnidades(conteo, CAJA_12)).toThrow(SolicitudInvalida);
  });
});

describe('validarFactores', () => {
  it.each([0, -1, 1.5])('rechaza un empaque con factor %s: daria un total absurdo', (factor) => {
    expect(() => validarFactores([{ nombre: 'Caja', factor }])).toThrow(SolicitudInvalida);
  });

  it('acepta un factor de 1 (producto que se cuenta por unidad)', () => {
    expect(() => validarFactores([{ nombre: 'Unidad', factor: 1 }])).not.toThrow();
  });

  it('rechaza si CUALQUIERA de varios empaques tiene un factor invalido', () => {
    expect(() => validarFactores([{ nombre: 'Caja', factor: 12 }, { nombre: 'Pack', factor: 0 }])).toThrow(SolicitudInvalida);
  });

  it('acepta una lista vacia (no hay nada que validar)', () => {
    expect(() => validarFactores([])).not.toThrow();
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
