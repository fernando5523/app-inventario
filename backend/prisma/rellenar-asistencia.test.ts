/**
 * Candado sobre la parte de `rellenar-asistencia.ts` donde se DECIDE algo: el
 * dia de Lima y la reconstruccion de las marcas. El resto del script es leer
 * y escribir.
 *
 * NO TOCA LA BASE (importar el archivo no arranca el runner: ver la guarda
 * `corriendoComoScript` al final de rellenar-asistencia.ts). Vive en prisma/
 * y no en src/ por el mismo motivo que `sincronizar-secuencias.test.ts`:
 * tsconfig.json solo compila los .ts de src/, y vitest lo encuentra igual.
 */

import { describe, expect, it } from 'vitest';
import {
  DESFASE_LIMA_HORAS,
  diaDeLima,
  diasDistintos,
  reconstruirMarcas,
  type ConteoParaReconstruir,
} from './rellenar-asistencia';

/** Un conteo en la hoja de una sola persona. */
function conteo(asignadoAId: number | null, iso: string, asignadoA2Id: number | null = null): ConteoParaReconstruir {
  return { asignadoAId, asignadoA2Id, contadoEn: new Date(iso) };
}

describe('diaDeLima — la jornada, no el instante UTC', () => {
  it('Peru es UTC-5 todo el ano', () => {
    expect(DESFASE_LIMA_HORAS).toBe(-5);
  });

  it('un conteo de la tarde cae en su propio dia', () => {
    // 15:29 de Lima el 16 de septiembre. Es el caso real de los inventarios
    // 8021-8023, que se sembraron a las 20:29 UTC.
    expect(diaDeLima(new Date('2026-09-16T20:29:13.339Z'))).toBe('2026-09-16');
  });

  it('un conteo de la NOCHE no se corre al dia siguiente', () => {
    // 20:00 de Lima es 01:00 UTC del dia siguiente. Tomar la fecha en UTC le
    // pondria a esa persona una marca del 17, y al inventario un segundo dia
    // que nadie trabajo.
    expect(diaDeLima(new Date('2026-09-17T01:00:00.000Z'))).toBe('2026-09-16');
  });

  it('el mediodia UTC de las semillas no se corre al dia anterior', () => {
    // scripts/sembrar-liquidacion-v2.ts siembra a mediodia UTC justamente
    // para que ninguna zona horaria lo mueva de dia. Sigue siendo asi.
    expect(diaDeLima(new Date('2026-10-05T12:00:00.000Z'))).toBe('2026-10-05');
  });
});

describe('reconstruirMarcas — una marca por persona, en su primer conteo', () => {
  it('toma el PRIMER conteo de cada persona, no el ultimo ni uno cualquiera', () => {
    const marcas = reconstruirMarcas([
      conteo(302, '2026-09-16T20:46:38.740Z'),
      conteo(302, '2026-09-16T20:29:13.339Z'),
      conteo(302, '2026-09-16T20:35:00.000Z'),
    ]);

    expect(marcas).toHaveLength(1);
    expect(marcas[0]?.colaboradorId).toBe(302);
    expect(marcas[0]?.primerConteoEn.toISOString()).toBe('2026-09-16T20:29:13.339Z');
    expect(marcas[0]?.dia).toBe('2026-09-16');
  });

  it('el conteo de a dos marca a LAS DOS personas de la hoja', () => {
    // Misma razon que la regla vieja (dominio/asistencia.ts): `Conteo` no
    // guarda autor, y en el conteo de a dos una canta y la otra anota.
    // Atribuirle la hoja a una sola le inventaria una falta a la otra.
    const marcas = reconstruirMarcas([conteo(302, '2026-09-16T20:29:00.000Z', 303)]);

    expect(marcas.map((m) => m.colaboradorId)).toEqual([302, 303]);
  });

  it('una hoja sin asignar no le da asistencia a nadie', () => {
    expect(reconstruirMarcas([conteo(null, '2026-09-16T20:29:00.000Z', null)])).toEqual([]);
  });

  it('UNA sola marca por persona aunque haya contado varios dias', () => {
    // La regla vieja era binaria (asistio o no). Este script reproduce ESA
    // respuesta con una fecha real encima; inventar un segundo dia de
    // asistencia seria afirmar mas de lo que el dato sostiene.
    const marcas = reconstruirMarcas([
      conteo(302, '2026-09-16T15:00:00.000Z'),
      conteo(302, '2026-09-17T15:00:00.000Z'),
    ]);

    expect(marcas).toHaveLength(1);
    expect(marcas[0]?.dia).toBe('2026-09-16');
  });

  it('sale ordenado por colaborador, para que el dry-run sea comparable', () => {
    const marcas = reconstruirMarcas([
      conteo(305, '2026-09-16T15:00:00.000Z'),
      conteo(301, '2026-09-16T16:00:00.000Z'),
      conteo(303, '2026-09-16T17:00:00.000Z'),
    ]);

    expect(marcas.map((m) => m.colaboradorId)).toEqual([301, 303, 305]);
  });
});

describe('diasDistintos — la duracion que dispara la guarda', () => {
  it('un inventario de un solo dia da un dia', () => {
    const marcas = reconstruirMarcas([
      conteo(301, '2026-09-16T15:00:00.000Z'),
      conteo(302, '2026-09-16T21:00:00.000Z'),
    ]);

    expect(diasDistintos(marcas)).toEqual(['2026-09-16']);
  });

  it('dos personas que empezaron dias distintos dan DOS dias (y el script saltea)', () => {
    // Este es el caso que `rellenar-asistencia.ts` se niega a escribir: con
    // una marca por persona, el que empezo el 17 quedaria 1 de 2 dias, o sea
    // con una multa que nunca existio.
    const marcas = reconstruirMarcas([
      conteo(301, '2026-09-16T15:00:00.000Z'),
      conteo(302, '2026-09-17T15:00:00.000Z'),
    ]);

    expect(diasDistintos(marcas)).toEqual(['2026-09-16', '2026-09-17']);
  });

  it('sin marcas no hay dias', () => {
    expect(diasDistintos([])).toEqual([]);
  });
});
