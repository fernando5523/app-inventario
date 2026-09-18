import { describe, expect, it } from 'vitest';
import {
  aDia,
  aFechaUtc,
  borrarMarcaQuerySchema,
  diaSchema,
  marcarAsistenciaSchema,
  parametrosMarcaSchema,
} from './asistencia.schema';

describe('diaSchema: el día de la jornada', () => {
  it('acepta un AAAA-MM-DD real', () => {
    expect(diaSchema.safeParse('2026-09-18').success).toBe(true);
  });

  it('acepta un 29 de febrero bisiesto -- existe', () => {
    expect(diaSchema.safeParse('2024-02-29').success).toBe(true);
  });

  it('rechaza la forma suelta (sin ceros, con hora, vacío)', () => {
    expect(diaSchema.safeParse('2026-9-8').success).toBe(false);
    expect(diaSchema.safeParse('2026-09-18T10:00:00Z').success).toBe(false);
    expect(diaSchema.safeParse('').success).toBe(false);
  });

  /**
   * EL CASO QUE JUSTIFICA EL `refine`. La regex sola deja pasar `2026-02-31`
   * y JavaScript lo convierte en 3 de marzo sin chistar: se guardaría un día
   * que nadie trabajó, la duración del inventario subiría en uno y todo el
   * personal se comería una tarifa de multa por un día que no existió.
   */
  it('rechaza un día que no existe en el calendario, aunque tenga la forma correcta', () => {
    expect(diaSchema.safeParse('2026-02-31').success).toBe(false);
    expect(diaSchema.safeParse('2026-02-29').success).toBe(false); // 2026 no es bisiesto
    expect(diaSchema.safeParse('2026-13-01').success).toBe(false);
    expect(diaSchema.safeParse('2026-04-31').success).toBe(false);
  });
});

describe('marcarAsistenciaSchema: el cuerpo del POST', () => {
  it('exige colaboradorId y día', () => {
    expect(marcarAsistenciaSchema.safeParse({ colaboradorId: 101, dia: '2026-09-18' }).success).toBe(true);
    expect(marcarAsistenciaSchema.safeParse({ colaboradorId: 101 }).success).toBe(false);
    expect(marcarAsistenciaSchema.safeParse({ dia: '2026-09-18' }).success).toBe(false);
  });

  it('rechaza un colaboradorId que no es un id (0, negativo, decimal, texto)', () => {
    for (const colaboradorId of [0, -1, 1.5, '101']) {
      expect(marcarAsistenciaSchema.safeParse({ colaboradorId, dia: '2026-09-18' }).success).toBe(false);
    }
  });

  /**
   * `.strict()`: un campo de más es un malentendido entre la app y el
   * servidor, no algo para ignorar en silencio. Si mañana alguien manda
   * `{ ..., hora: '08:15' }` creyendo que registra la hora de entrada, tiene
   * que enterarse de que no -- la hora la pone el servidor (`registradoEn`).
   */
  it('rechaza campos que no existen', () => {
    expect(
      marcarAsistenciaSchema.safeParse({ colaboradorId: 101, dia: '2026-09-18', hora: '08:15' }).success,
    ).toBe(false);
  });
});

describe('parametrosMarcaSchema / borrarMarcaQuerySchema: el DELETE', () => {
  it('convierte los ids de la URL a número', () => {
    expect(parametrosMarcaSchema.parse({ inventarioId: '8021', colaboradorId: '101' })).toEqual({
      inventarioId: 8021,
      colaboradorId: 101,
    });
  });

  it('exige el día: borrar sin decir cuál borraría la asistencia entera de esa persona', () => {
    expect(borrarMarcaQuerySchema.safeParse({}).success).toBe(false);
    expect(borrarMarcaQuerySchema.safeParse({ dia: '2026-09-18' }).success).toBe(true);
  });
});

describe('aFechaUtc / aDia: el día entre el cable y la base', () => {
  it('construye SIEMPRE medianoche UTC, no la hora local del servidor', () => {
    expect(aFechaUtc('2026-09-18').toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('ida y vuelta sin corrimiento', () => {
    for (const dia of ['2026-01-01', '2026-09-18', '2026-12-31', '2024-02-29']) {
      expect(aDia(aFechaUtc(dia))).toBe(dia);
    }
  });

  it('aDia recorta la hora que Prisma devuelva pegada a la columna date', () => {
    expect(aDia(new Date('2026-09-18T13:45:12.000Z'))).toBe('2026-09-18');
  });

  it('aDia no explota con una fecha inválida: devuelve algo que no coincide con nada', () => {
    expect(aDia(new Date('no es una fecha'))).toBe('');
  });
});
