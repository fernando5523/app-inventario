import { describe, expect, it } from 'vitest';
import { guardarConteoSchema, listarHojasQuerySchema } from './hojas.schema';

describe('listarHojasQuerySchema', () => {
  it('el default de alcance es el RESTRICTIVO', () => {
    // Si alguien olvida el parametro, la respuesta segura es "solo las mias",
    // nunca el lote entero: el default no puede filtrar el conteo ciego.
    const q = listarHojasQuerySchema.parse({ inventarioId: '3' });
    expect(q.alcance).toBe('mias');
  });

  it('la ronda por defecto es la 1 (el front todavia no habla de rondas)', () => {
    expect(listarHojasQuerySchema.parse({ inventarioId: '3' }).ronda).toBe(1);
  });

  it('coerciona los numeros que llegan como texto en el query string', () => {
    const q = listarHojasQuerySchema.parse({ inventarioId: '3', ronda: '2' });
    expect(q).toMatchObject({ inventarioId: 3, ronda: 2 });
  });

  it.each([0, 4])('rechaza la ronda %s: el ciclo tiene 3', (ronda) => {
    expect(() => listarHojasQuerySchema.parse({ inventarioId: 1, ronda })).toThrow();
  });

  it('rechaza un alcance inventado', () => {
    expect(() => listarHojasQuerySchema.parse({ inventarioId: 1, alcance: 'todas-las-sucursales' })).toThrow();
  });

  it('exige inventarioId', () => {
    expect(() => listarHojasQuerySchema.parse({})).toThrow();
  });
});

describe('guardarConteoSchema', () => {
  const base = { empaques: 2, sueltas: 5, contadoEn: '2026-09-03T10:00:00.000Z' };

  it('acepta un conteo valido y deja confirmadoPorEscaner en false', () => {
    const c = guardarConteoSchema.parse(base);
    expect(c.confirmadoPorEscaner).toBe(false);
    expect(c.contadoEn).toBeInstanceOf(Date);
  });

  it('acepta cero empaques: "conte 0 cajas y 5 sueltas" es un conteo real', () => {
    expect(() => guardarConteoSchema.parse({ ...base, empaques: 0 })).not.toThrow();
  });

  it.each(['empaques', 'sueltas'])('rechaza %s negativo', (campo) => {
    expect(() => guardarConteoSchema.parse({ ...base, [campo]: -1 })).toThrow();
  });

  it.each(['empaques', 'sueltas'])('rechaza %s decimal: no hay media caja contada', (campo) => {
    expect(() => guardarConteoSchema.parse({ ...base, [campo]: 1.5 })).toThrow();
  });

  it('IGNORA un total mandado por el cliente', () => {
    // El total se calcula (empaques x factor + sueltas). Aceptarlo del
    // cliente seria guardar un total al lado de sus partes y garantizar que
    // algun dia no coincidan -- y ese es EL numero que se audita.
    const c = guardarConteoSchema.parse({ ...base, total: 999 });
    expect(c).not.toHaveProperty('total');
  });

  it('exige contadoEn: es la hora del telefono, no la del servidor', () => {
    // La cola offline manda esto horas despues; usar la hora del servidor
    // perderia cuando se conto de verdad.
    const { contadoEn: _omitido, ...sinFecha } = base;
    expect(() => guardarConteoSchema.parse(sinFecha)).toThrow();
  });
});
