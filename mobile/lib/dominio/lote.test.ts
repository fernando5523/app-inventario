import { describe, expect, it } from 'vitest';
import { partirEnHojas, repartir } from './lote';

function suma(nums: number[]): number {
  return nums.reduce((acc, n) => acc + n, 0);
}

describe('partirEnHojas', () => {
  it('8000 / 50 = 160 hojas exactas', () => {
    const hojas = partirEnHojas(8000, 50);
    expect(hojas).toHaveLength(160);
    expect(hojas.every((tamano) => tamano === 50)).toBe(true);
    expect(suma(hojas)).toBe(8000);
  });

  it('8000 / 30 = 267 hojas: 266 de 30 y la ultima de 20 (parcial)', () => {
    const hojas = partirEnHojas(8000, 30);
    expect(hojas).toHaveLength(267);
    expect(hojas.slice(0, 266).every((tamano) => tamano === 30)).toBe(true);
    expect(hojas[266]).toBe(20);
    expect(suma(hojas)).toBe(8000);
  });

  it('8000 / 20 = 400 hojas exactas', () => {
    const hojas = partirEnHojas(8000, 20);
    expect(hojas).toHaveLength(400);
    expect(hojas.every((tamano) => tamano === 20)).toBe(true);
    expect(suma(hojas)).toBe(8000);
  });

  it('cero items: no hay hojas que crear', () => {
    expect(partirEnHojas(0, 50)).toEqual([]);
  });

  it('menos items que el tamano de hoja: una sola hoja parcial', () => {
    expect(partirEnHojas(15, 20)).toEqual([15]);
  });

  it('exactamente un tamano de hoja: una sola hoja completa', () => {
    expect(partirEnHojas(20, 20)).toEqual([20]);
  });

  it('rechaza totalItems negativo en vez de devolver algo raro en silencio', () => {
    expect(() => partirEnHojas(-1, 20)).toThrow();
  });

  it('rechaza un tamano de hoja invalido', () => {
    expect(() => partirEnHojas(100, 0 as unknown as 20)).toThrow();
  });
});

describe('repartir', () => {
  it('reparte en bloques contiguos, no salteados', () => {
    const hojas = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10'];
    const personas = ['Ana', 'Beto', 'Carla'];

    const resultado = repartir(hojas, personas);

    expect(resultado).toEqual([
      { persona: 'Ana', hojas: ['H1', 'H2', 'H3', 'H4'] },
      { persona: 'Beto', hojas: ['H5', 'H6', 'H7'] },
      { persona: 'Carla', hojas: ['H8', 'H9', 'H10'] },
    ]);
  });

  it('division exacta: todos los bloques del mismo tamano', () => {
    const hojas = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9'];
    const personas = ['Ana', 'Beto', 'Carla'];

    const resultado = repartir(hojas, personas);

    expect(resultado.map((a) => a.hojas.length)).toEqual([3, 3, 3]);
  });

  it('menos hojas que personas: las que sobran quedan sin asignar, no se reparte fraccionado', () => {
    const hojas = ['H1', 'H2'];
    const personas = ['Ana', 'Beto', 'Carla', 'Dario', 'Elena'];

    const resultado = repartir(hojas, personas);

    expect(resultado).toEqual([
      { persona: 'Ana', hojas: ['H1'] },
      { persona: 'Beto', hojas: ['H2'] },
      { persona: 'Carla', hojas: [] },
      { persona: 'Dario', hojas: [] },
      { persona: 'Elena', hojas: [] },
    ]);
  });

  it('cero hojas: todas las personas quedan con el arreglo vacio', () => {
    const resultado = repartir([], ['Ana', 'Beto']);
    expect(resultado).toEqual([
      { persona: 'Ana', hojas: [] },
      { persona: 'Beto', hojas: [] },
    ]);
  });

  it('cero personas: no hay a quien asignar, no revienta', () => {
    expect(repartir(['H1', 'H2'], [])).toEqual([]);
  });

  it('nunca deja hojas afuera ni las repite entre personas', () => {
    const hojas = Array.from({ length: 23 }, (_, i) => `H${i + 1}`);
    const personas = ['Ana', 'Beto', 'Carla', 'Dario'];

    const resultado = repartir(hojas, personas);
    const todasLasAsignadas = resultado.flatMap((a) => a.hojas);

    expect(todasLasAsignadas).toEqual(hojas);
  });
});
