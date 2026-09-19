import { describe, expect, it } from 'vitest';
import { RONDA_MAXIMA_ACEPTADA } from '../hojas/hojas.schema';
import {
  ajustarConteoSchema,
  asignarHojasSchema,
  crearHojasSchema,
  parametrosAjusteSchema,
  parametrosRondaSchema,
} from './inventarios.schema';

/**
 * ESTE SCHEMA VALIDABA `ronda` DE 1 A 3 Y ESO DEJO DE SER CIERTO.
 *
 * El cliente pidio que el Auditor pueda abrir mas conteos de los 3 definidos
 * -- un 4to, un 5to -- cuando haga falta, inventario por inventario. Con el
 * techo viejo, `POST /inventarios/8039/rondas/4/cerrar` moria en el
 * middleware de validacion con un 400 antes de llegar al service: la ronda
 * existia en la base y la URL decia que no.
 */
describe('parametrosRondaSchema: la ronda ya no termina en 3', () => {
  it('acepta las rondas del ciclo clasico', () => {
    for (const ronda of [1, 2, 3]) {
      expect(parametrosRondaSchema.parse({ inventarioId: '8039', ronda: String(ronda) }).ronda).toBe(ronda);
    }
  });

  it('acepta las rondas extra que abre el Auditor', () => {
    expect(parametrosRondaSchema.parse({ inventarioId: '8039', ronda: '4' }).ronda).toBe(4);
    expect(parametrosRondaSchema.parse({ inventarioId: '8039', ronda: '7' }).ronda).toBe(7);
  });

  it('coerciona lo que llega como texto en la URL', () => {
    expect(parametrosRondaSchema.parse({ inventarioId: '8039', ronda: '2' })).toEqual({
      inventarioId: 8039,
      ronda: 2,
    });
  });

  it('sigue rechazando la ronda 0, las negativas y los decimales', () => {
    for (const ronda of ['0', '-1', '1.5']) {
      expect(parametrosRondaSchema.safeParse({ inventarioId: '8039', ronda }).success).toBe(false);
    }
  });

  /**
   * El unico techo que queda es mecanico: `rondas.service.ts#cerrar` calcula
   * `ronda + 1` y `HojaConteo.numeroConteo` es un `Int` de Postgres. Si la
   * ronda EXISTE lo decide la base (404 del service), no este schema.
   */
  it('rechaza una ronda absurda: ronda + 1 desbordaria el Int de numeroConteo', () => {
    expect(parametrosRondaSchema.safeParse({ inventarioId: '8039', ronda: '2147483647' }).success).toBe(false);
    expect(
      parametrosRondaSchema.parse({ inventarioId: '8039', ronda: String(RONDA_MAXIMA_ACEPTADA) }).ronda,
    ).toBe(RONDA_MAXIMA_ACEPTADA);
  });
});

describe('parametrosAjusteSchema: el producto que ajusta el Auditor', () => {
  it('coerciona los dos ids de la URL', () => {
    expect(parametrosAjusteSchema.parse({ inventarioId: '8039', productoId: '512' })).toEqual({
      inventarioId: 8039,
      productoId: 512,
    });
  });

  it('rechaza ids que no son ids', () => {
    expect(parametrosAjusteSchema.safeParse({ inventarioId: '8039', productoId: '0' }).success).toBe(false);
    expect(parametrosAjusteSchema.safeParse({ inventarioId: '8039', productoId: 'abc' }).success).toBe(false);
  });
});

/**
 * El ajuste del Auditor y la correccion del Coordinador mandan EL MISMO
 * cuerpo: son la misma operacion (reemplazar un conteo dejando dicho por
 * que) vista desde dos roles. Lo que las separa es quien puede y cuando, y
 * eso vive en los permisos, no en el schema.
 */
describe('ajustarConteoSchema: el mismo cuerpo que la correccion', () => {
  it('exige motivo, igual que la correccion del Coordinador', () => {
    expect(ajustarConteoSchema.safeParse({ sueltas: 3 }).success).toBe(false);
    expect(ajustarConteoSchema.parse({ sueltas: 3, motivo: 'stock real 3' }).motivo).toBe('stock real 3');
  });
});

/** Los schemas que ya existian siguen igual: el cambio de ronda no los toca. */
describe('lo que no cambio', () => {
  it('crearHojasSchema sigue aceptando solo 20, 30 o 50', () => {
    expect(crearHojasSchema.parse({ tamano: 30 }).tamano).toBe(30);
    expect(crearHojasSchema.safeParse({ tamano: 37 }).success).toBe(false);
  });

  it('asignarHojasSchema sigue exigiendo al menos una persona', () => {
    expect(asignarHojasSchema.safeParse({ colaboradorIds: [] }).success).toBe(false);
    expect(asignarHojasSchema.parse({ colaboradorIds: [301, 302] }).colaboradorIds).toEqual([301, 302]);
  });
});
