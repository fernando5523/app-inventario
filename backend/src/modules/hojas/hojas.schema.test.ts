import { describe, expect, it } from 'vitest';
import {
  corregirConteoSchema,
  guardarConteoSchema,
  listarHojasQuerySchema,
  RONDA_MAXIMA_ACEPTADA,
} from './hojas.schema';

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

  /**
   * ANTES ESTE TEST DECIA `it.each([0, 4])('rechaza la ronda %s: el ciclo
   * tiene 3')`. Dejo de ser cierto: el cliente pidio que el Auditor pueda
   * abrir un 4to y un 5to conteo cuando haga falta, asi que la ronda 4 es una
   * ronda posible y listar sus hojas tiene que funcionar. Con el techo viejo,
   * la pantalla de una ronda extra recibia 400.
   */
  it('acepta rondas mas alla de la 3: el Auditor puede abrir conteos extra', () => {
    expect(listarHojasQuerySchema.parse({ inventarioId: 1, ronda: 4 }).ronda).toBe(4);
    expect(listarHojasQuerySchema.parse({ inventarioId: 1, ronda: 12 }).ronda).toBe(12);
  });

  it('sigue rechazando la ronda 0 y las negativas: no hay ronda antes de la 1', () => {
    expect(() => listarHojasQuerySchema.parse({ inventarioId: 1, ronda: 0 })).toThrow();
    expect(() => listarHojasQuerySchema.parse({ inventarioId: 1, ronda: -1 })).toThrow();
  });

  /**
   * El techo es de FORMA, no de negocio: `cerrar()` hace `ronda + 1` sobre un
   * `Int` de Postgres, y sin tope un `ronda=2147483647` desborda al sumarle
   * uno. Que la ronda EXISTA lo decide el service contra la base (404), no
   * este schema.
   */
  it('rechaza una ronda absurda: el Int de numeroConteo desborda al hacer ronda + 1', () => {
    expect(() => listarHojasQuerySchema.parse({ inventarioId: 1, ronda: 2147483647 })).toThrow();
    expect(listarHojasQuerySchema.parse({ inventarioId: 1, ronda: RONDA_MAXIMA_ACEPTADA }).ronda).toBe(
      RONDA_MAXIMA_ACEPTADA,
    );
  });

  it('rechaza un alcance inventado', () => {
    expect(() => listarHojasQuerySchema.parse({ inventarioId: 1, alcance: 'todas-las-sucursales' })).toThrow();
  });

  it('exige inventarioId', () => {
    expect(() => listarHojasQuerySchema.parse({})).toThrow();
  });
});

describe('guardarConteoSchema', () => {
  const base = { empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }], sueltas: 5, contadoEn: '2026-09-03T10:00:00.000Z' };

  it('acepta un conteo valido y deja confirmadoPorEscaner en false', () => {
    const c = guardarConteoSchema.parse(base);
    expect(c.confirmadoPorEscaner).toBe(false);
    expect(c.contadoEn).toBeInstanceOf(Date);
  });

  it('acepta varias lineas de empaques: "2 cajas + 3 packs"', () => {
    const c = guardarConteoSchema.parse({
      ...base,
      empaques: [
        { empaqueNombre: 'Caja', cantidad: 2 },
        { empaqueNombre: 'Pack', cantidad: 3 },
      ],
    });
    expect(c.empaques).toHaveLength(2);
  });

  it('acepta la lista de empaques vacia: solo sueltas, sin empaques cerrados', () => {
    expect(() => guardarConteoSchema.parse({ ...base, empaques: [] })).not.toThrow();
  });

  it('acepta una linea en cero: "conte 0 cajas y 5 sueltas" es un conteo real', () => {
    expect(() => guardarConteoSchema.parse({ ...base, empaques: [{ empaqueNombre: 'Caja', cantidad: 0 }] })).not.toThrow();
  });

  it('rechaza dos lineas con el mismo nombre de empaque', () => {
    expect(() =>
      guardarConteoSchema.parse({
        ...base,
        empaques: [
          { empaqueNombre: 'Caja', cantidad: 2 },
          { empaqueNombre: 'Caja', cantidad: 3 },
        ],
      }),
    ).toThrow();
  });

  it('rechaza sueltas negativo', () => {
    expect(() => guardarConteoSchema.parse({ ...base, sueltas: -1 })).toThrow();
  });

  it('rechaza la cantidad de una linea negativa', () => {
    expect(() => guardarConteoSchema.parse({ ...base, empaques: [{ empaqueNombre: 'Caja', cantidad: -1 }] })).toThrow();
  });

  it('rechaza sueltas decimal: no hay media caja contada', () => {
    expect(() => guardarConteoSchema.parse({ ...base, sueltas: 1.5 })).toThrow();
  });

  it('rechaza la cantidad de una linea decimal', () => {
    expect(() => guardarConteoSchema.parse({ ...base, empaques: [{ empaqueNombre: 'Caja', cantidad: 1.5 }] })).toThrow();
  });

  it('IGNORA un total mandado por el cliente', () => {
    // El total se calcula (ver hojas.calculos.ts#totalUnidades). Aceptarlo
    // del cliente seria guardar un total al lado de sus partes y garantizar
    // que algun dia no coincidan -- y ese es EL numero que se audita.
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

/**
 * EL MOTIVO ES OBLIGATORIO, y no es burocracia: estos numeros descuentan
 * plata del sueldo de la gente y quedan sellados en el lacrado. Un cambio sin
 * motivo es un descuento que nadie puede explicar seis meses despues.
 */
describe('corregirConteoSchema: la correccion lleva motivo', () => {
  const base = { empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }], sueltas: 5 };

  it('acepta una correccion con motivo', () => {
    const c = corregirConteoSchema.parse({ ...base, motivo: 'Conto la caja de 12 como de 6' });
    expect(c.motivo).toBe('Conto la caja de 12 como de 6');
    expect(c.sueltas).toBe(5);
  });

  it('rechaza una correccion SIN motivo', () => {
    expect(corregirConteoSchema.safeParse(base).success).toBe(false);
  });

  it('rechaza un motivo vacio o de puro espacio', () => {
    for (const motivo of ['', '   ', '\n']) {
      expect(corregirConteoSchema.safeParse({ ...base, motivo }).success).toBe(false);
    }
  });

  /**
   * Un "." pasaria un `.min(1)`, y un punto en la columna "motivo" de una
   * auditoria es peor que un hueco: parece que alguien contesto. El piso no
   * juzga la calidad del motivo -- eso no lo puede hacer un schema -- solo
   * frena el campo apretado sin querer.
   */
  it('rechaza un motivo de un caracter: parece contestado y no dice nada', () => {
    expect(corregirConteoSchema.safeParse({ ...base, motivo: '.' }).success).toBe(false);
    expect(corregirConteoSchema.safeParse({ ...base, motivo: 'x' }).success).toBe(false);
  });

  it('recorta los espacios del motivo', () => {
    expect(corregirConteoSchema.parse({ ...base, motivo: '  mal contado  ' }).motivo).toBe('mal contado');
  });

  it('rechaza un motivo mas largo que la celda del reporte', () => {
    expect(corregirConteoSchema.safeParse({ ...base, motivo: 'a'.repeat(201) }).success).toBe(false);
  });

  /**
   * `contadoEn` es CUANDO se conto en la gondola: corregir no cambia eso.
   * `confirmadoPorEscaner` lo baja el service, porque quien corrige teclea un
   * numero y no escanea nada. Aceptarlos seria dejar que quien corrige firme
   * con el escaner o pise la hora de la pasada real.
   */
  it('rechaza contadoEn y confirmadoPorEscaner: no son de quien corrige', () => {
    expect(corregirConteoSchema.safeParse({ ...base, motivo: 'error', contadoEn: new Date() }).success).toBe(false);
    expect(
      corregirConteoSchema.safeParse({ ...base, motivo: 'error', confirmadoPorEscaner: true }).success,
    ).toBe(false);
  });

  it('empaques es opcional (una correccion puede dejar solo sueltas)', () => {
    expect(corregirConteoSchema.parse({ sueltas: 3, motivo: 'solo sueltas' }).empaques).toEqual([]);
  });

  it('no deja repetir el mismo empaque dos veces, igual que al guardar', () => {
    const empaques = [
      { empaqueNombre: 'Caja', cantidad: 1 },
      { empaqueNombre: 'Caja', cantidad: 2 },
    ];
    expect(corregirConteoSchema.safeParse({ empaques, sueltas: 0, motivo: 'duplicado' }).success).toBe(false);
  });
});
