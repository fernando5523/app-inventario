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
import { formatoFecha, formatoFechaHora, formatoMiles, formatoPct } from './formato';

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
