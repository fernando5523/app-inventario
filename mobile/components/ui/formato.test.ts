/**
 * Los formateadores que ve toda la app.
 *
 * El bug que motivó estos tests (visto en la app el 2026-09-05): la tarjeta
 * de ajustes decía "Registrado por Nancy Quispe el 05/09/2026 10:38" cuando
 * en Lima eran las 05:38. El servidor manda ISO en UTC y los helpers usaban
 * `getHours()` —la zona del DISPOSITIVO—, y el emulador corre en UTC.
 *
 * En un teléfono de la tienda habría dado bien por casualidad, no por
 * diseño: basta un equipo con la zona mal puesta para que la hora de una
 * firma contable quede mal. Ahora el offset de Lima es explícito, así que
 * estos tests valen igual corran donde corran.
 */

import { describe, expect, it } from 'vitest';
import {
  diaEnLima,
  formatoDiaJornada,
  formatoDiaJornadaLargo,
  formatoFecha,
  formatoFechaHora,
  formatoHora,
  formatoMiles,
  formatoPct,
} from './formato';

describe('fechas: SIEMPRE en hora de Lima, no en la del dispositivo', () => {
  /** El caso exacto del bug. */
  it('10:38 UTC se muestra como 05:38, que es la hora en Lima', () => {
    expect(formatoFechaHora('2026-09-05T10:38:00.000Z')).toBe('05/09/2026 05:38');
  });

  it('el formato es dd/mm/aaaa, no el inglés', () => {
    // "06/29/2026" a un usuario peruano es un dato mal leído, no un detalle.
    expect(formatoFecha('2026-06-29T16:00:00.000Z')).toBe('29/06/2026');
  });

  /**
   * EL BORDE QUE MÁS DUELE: entre las 00:00 y las 05:00 UTC, en Lima
   * todavía es el DÍA ANTERIOR. Un lacrado firmado el 1° a las 02:00 UTC
   * pasó el 31 a las 21:00 en la tienda — y el mes al que pertenece cambia.
   */
  it('02:00 UTC del día 1 es el día ANTERIOR en Lima', () => {
    expect(formatoFechaHora('2026-09-01T02:00:00.000Z')).toBe('31/08/2026 21:00');
  });

  it('cruza el año igual de bien', () => {
    expect(formatoFechaHora('2027-01-01T03:00:00.000Z')).toBe('31/12/2026 22:00');
  });

  it('05:00 UTC es exactamente medianoche en Lima', () => {
    expect(formatoFechaHora('2026-09-05T05:00:00.000Z')).toBe('05/09/2026 00:00');
  });

  it('04:59 UTC todavía es el día anterior, 23:59', () => {
    expect(formatoFechaHora('2026-09-05T04:59:00.000Z')).toBe('04/09/2026 23:59');
  });

  it('rellena con cero a la izquierda: 09:05, no 9:5', () => {
    expect(formatoFechaHora('2026-09-05T14:05:00.000Z')).toBe('05/09/2026 09:05');
  });

  /**
   * Perú NO tiene horario de verano desde 1994, así que el offset es -5 todo
   * el año. Si algún día lo reinstauraran, este test empieza a fallar en una
   * de las dos fechas — que es exactamente lo que uno quiere que pase.
   */
  it('el offset es -5 en enero y en julio: Perú no cambia de hora', () => {
    expect(formatoFechaHora('2026-01-15T12:00:00.000Z')).toBe('15/01/2026 07:00');
    expect(formatoFechaHora('2026-07-15T12:00:00.000Z')).toBe('15/07/2026 07:00');
  });
});

describe('números', () => {
  it('separa los miles con punto, como se lee en Perú', () => {
    expect(formatoMiles(8000)).toBe('8.000');
  });

  it('con menos de mil no mete separador', () => {
    expect(formatoMiles(951)).toBe('951');
  });

  it('el porcentaje lleva coma decimal', () => {
    expect(formatoPct(2.7)).toContain(',');
  });
});

/**
 * El día de la jornada decide CONTRA QUÉ DÍA se guarda una marca de
 * asistencia, y los días distintos con marcas son la duración del
 * inventario: el denominador de la multa de todo el personal. Un día corrido
 * por la zona del dispositivo le agrega un día al inventario y una falta a
 * cada persona que sí vino.
 */
describe('el día de la jornada, en hora de Lima', () => {
  it('a las 19:05 de Lima todavía es el mismo día, aunque en UTC ya sea el siguiente', () => {
    // 2026-09-16T00:05Z = 2026-09-15 19:05 en Lima.
    expect(diaEnLima(new Date('2026-09-16T00:05:00.000Z'))).toBe('2026-09-15');
  });

  it('a las 05:00 de Lima es el día que corresponde, no el anterior', () => {
    expect(diaEnLima(new Date('2026-09-15T10:00:00.000Z'))).toBe('2026-09-15');
  });

  it('cruza el fin de mes sin inventar un día 00', () => {
    expect(diaEnLima(new Date('2026-10-01T02:00:00.000Z'))).toBe('2026-09-30');
  });

  it('la hora sola sale en Lima igual que la completa: no es otro cálculo', () => {
    expect(formatoHora('2026-09-05T10:38:00.000Z')).toBe('05:38');
    expect(formatoFechaHora('2026-09-05T10:38:00.000Z')).toContain('05:38');
  });

  it('mismo offset en enero y en julio: Perú no cambia de hora', () => {
    expect(diaEnLima(new Date('2026-01-15T03:00:00.000Z'))).toBe('2026-01-14');
    expect(diaEnLima(new Date('2026-07-15T03:00:00.000Z'))).toBe('2026-07-14');
  });

  /**
   * Un día YA es una fecha sin hora: correrlo a Lima le restaría 5 horas a
   * algo que no las tiene y devolvería el día anterior en la tira de días.
   */
  it('un día ya guardado se muestra tal cual, sin correrlo otra vez', () => {
    expect(formatoDiaJornada('2026-09-15')).toBe('Mar 15/09');
    expect(formatoDiaJornada('2026-09-14')).toBe('Lun 14/09');
    expect(formatoDiaJornadaLargo('2026-09-15')).toBe('martes 15/09/2026');
  });

  it('el domingo no se cae del índice de la semana', () => {
    expect(formatoDiaJornada('2026-09-13')).toBe('Dom 13/09');
    expect(formatoDiaJornadaLargo('2026-09-13')).toBe('domingo 13/09/2026');
  });
});
