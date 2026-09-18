/**
 * La regla del cliente para la asistencia, probada sin base.
 *
 * De acá sale una multa que se le descuenta del sueldo a una persona, así que
 * cada regla está cubierta una por una -- incluidas las degeneradas, que son
 * las que nadie prueba a mano y las que terminan multando a alguien.
 *
 * OJO al cambio de régimen: hasta este cambio la asistencia se DEDUCIA de las
 * hojas y la multa era un monto fijo por persona ausente. Ahora la registra el
 * coordinador, día por día, y la multa es por día faltado. Los tests viejos
 * (hoja con conteos = asistió) ya no describen ninguna regla vigente. Ver la
 * cabecera de `asistencia.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  aMarcaAsistencia,
  diasAsistidosPorColaborador,
  diasDelInventario,
  multaPorInasistencia,
  quienesAsistieronTodo,
  type MarcaAsistencia,
} from './asistencia';

/** Atajo: `marca(7, '2026-09-01')`. */
const marca = (colaboradorId: number, dia: string): MarcaAsistencia => ({ colaboradorId, dia });

/** El escenario canónico del brief: 3 días, Silvia y Óscar 3/3, Delia 1/3. */
const SILVIA = 1;
const OSCAR = 2;
const DELIA = 3;
const TRES_DIAS: MarcaAsistencia[] = [
  marca(SILVIA, '2026-09-01'),
  marca(OSCAR, '2026-09-01'),
  marca(DELIA, '2026-09-01'),
  marca(SILVIA, '2026-09-02'),
  marca(OSCAR, '2026-09-02'),
  marca(SILVIA, '2026-09-03'),
  marca(OSCAR, '2026-09-03'),
];

describe('diasDelInventario', () => {
  it('cuenta días DISTINTOS, no marcas', () => {
    // 7 marcas, 3 días. Si contara marcas, el denominador de todas las multas
    // del inventario sería la cantidad de gente que fue.
    expect(diasDelInventario(TRES_DIAS)).toBe(3);
  });

  it('un solo día con toda la tienda marcada sigue siendo un día', () => {
    expect(diasDelInventario([marca(SILVIA, '2026-09-01'), marca(OSCAR, '2026-09-01')])).toBe(1);
  });

  it('días no consecutivos cuentan igual: no es "del primero al último"', () => {
    // Un inventario que se corta el sábado y sigue el lunes duró 2 días, no 3.
    expect(diasDelInventario([marca(SILVIA, '2026-09-04'), marca(SILVIA, '2026-09-06')])).toBe(2);
  });

  it('sin marcas, cero días', () => {
    // Un inventario sin una sola marca no dura 0 por error: nadie fue, o nadie
    // cargó. El cierre de la planilla lo corta antes de multar a alguien.
    expect(diasDelInventario([])).toBe(0);
  });
});

describe('diasAsistidosPorColaborador', () => {
  it('cuenta los días de cada uno', () => {
    const dias = diasAsistidosPorColaborador(TRES_DIAS);
    expect(dias.get(SILVIA)).toBe(3);
    expect(dias.get(OSCAR)).toBe(3);
    expect(dias.get(DELIA)).toBe(1);
  });

  it('dos marcas del MISMO día cuentan como un día', () => {
    // El @@unique lo impide en la base, pero esta función es pura y no puede
    // apoyarse en eso: una fila repetida le regalaría un día a alguien, y con
    // eso podría pasar a cobrar bono sin haber venido todos los días.
    expect(diasAsistidosPorColaborador([marca(SILVIA, '2026-09-01'), marca(SILVIA, '2026-09-01')]).get(SILVIA)).toBe(1);
  });

  it('quien no tiene marcas NO aparece en el Map', () => {
    // No se devuelve con 0: esta función no conoce el personal alcanzado. Lo
    // resuelve la planilla, que recorre a todos y usa `?? 0`.
    expect(diasAsistidosPorColaborador(TRES_DIAS).has(99)).toBe(false);
  });

  it('sin marcas devuelve un Map vacío, y no revienta', () => {
    expect(diasAsistidosPorColaborador([]).size).toBe(0);
  });
});

describe('multaPorInasistencia', () => {
  it('faltó 2 de 3 días a S/20: S/40', () => {
    // El caso de Delia en el ejemplo canónico del brief.
    expect(multaPorInasistencia(3, 1, 20)).toBe(40);
  });

  it('vino todos los días: no paga nada', () => {
    expect(multaPorInasistencia(3, 3, 20)).toBe(0);
  });

  it('no vino ningún día: paga el inventario completo', () => {
    expect(multaPorInasistencia(3, 0, 20)).toBe(60);
  });

  it('EL CAMBIO DE REGLA: faltar un día ya no cuesta lo mismo que no venir nunca', () => {
    // Con la regla vieja (monto fijo por ausente) los dos pagaban S/20. Este
    // test existe para que se note si alguien vuelve al monto fijo.
    expect(multaPorInasistencia(3, 2, 20)).toBe(20);
    expect(multaPorInasistencia(3, 0, 20)).toBe(60);
  });

  it('NUNCA negativa: más días asistidos que días de inventario da 0', () => {
    // `diasInventario` viene congelado del cierre y los días asistidos de las
    // marcas de hoy. Una multa negativa sería un PAGO al colaborador que nadie
    // autorizó.
    expect(multaPorInasistencia(3, 5, 20)).toBe(0);
  });

  it('inventario de 0 días no multa a nadie', () => {
    expect(multaPorInasistencia(0, 0, 20)).toBe(0);
  });

  it('tarifa con centavos: exacta, sin el arrastre del punto flotante', () => {
    // 20.10 * 3 da 60.300000000000004 con decimales. Este número entra directo
    // a la suma que tiene que cerrar contra el fondo de multas.
    expect(multaPorInasistencia(3, 0, 20.1)).toBe(60.3);
    expect(multaPorInasistencia(10, 0, 0.1)).toBe(1);
  });

  it('tarifa en 0: no hay multa aunque haya faltado todo', () => {
    // Una tarifa en cero es una decisión válida del cliente, no un dato que
    // falta -- y si fuera un dato que falta, no se arregla multando.
    expect(multaPorInasistencia(3, 0, 0)).toBe(0);
  });
});

describe('quienesAsistieronTodo', () => {
  it('los del ejemplo canónico: Silvia y Óscar sí, Delia no', () => {
    expect(quienesAsistieronTodo(TRES_DIAS, 3)).toEqual(new Set([SILVIA, OSCAR]));
  });

  it('es EXACTAMENTE el conjunto de los que no pagan multa', () => {
    // La invariante que hace cerrar el fondo: nadie puede cobrar bono Y pagar
    // multa. Si se rompiera, se repartiría entre gente que además aportó.
    const dias = diasAsistidosPorColaborador(TRES_DIAS);
    const conBono = quienesAsistieronTodo(TRES_DIAS, 3);
    for (const id of [SILVIA, OSCAR, DELIA, 99]) {
      const multa = multaPorInasistencia(3, dias.get(id) ?? 0, 20);
      expect(conBono.has(id)).toBe(multa === 0);
    }
  });

  it('usa el denominador CONGELADO que le pasan, no el que deduciría de las marcas', () => {
    // Las marcas dicen 3 días; el resultado congelado dice 4 (el coordinador
    // borró la última marca de un día después de cerrar). Con 4, nadie vino
    // todos los días -- y nadie cobra bono. Si esta función dedujera el
    // denominador de las marcas, Silvia y Óscar cobrarían bono por un día que
    // el inventario firmado dice que existió y ellos no hicieron.
    expect(quienesAsistieronTodo(TRES_DIAS, 4)).toEqual(new Set());
  });

  it('cero días de inventario: no cobra bono nadie', () => {
    // No hubo inventario que asistir. Sin este corte, `dias >= 0` metería a
    // todo el mundo -- incluso a quien no tiene una sola marca.
    expect(quienesAsistieronTodo(TRES_DIAS, 0)).toEqual(new Set());
  });

  it('sin marcas no cobra nadie, y no revienta', () => {
    expect(quienesAsistieronTodo([], 3)).toEqual(new Set());
  });
});

describe('aMarcaAsistencia', () => {
  it('traduce la fila de Prisma a YYYY-MM-DD', () => {
    expect(aMarcaAsistencia({ colaboradorId: 7, dia: new Date('2026-09-03T00:00:00.000Z') })).toEqual({
      colaboradorId: 7,
      dia: '2026-09-03',
    });
  });

  it('usa UTC, NO la hora local: en Lima (UTC−5) el día se correría para atrás', () => {
    // `@db.Date` vuelve de Prisma como medianoche UTC. Con los getters locales,
    // en Lima el 3 se lee como el 2: todas las marcas se corren un día, los
    // días del inventario se pueden duplicar y alguien paga una multa por un
    // día que no existió.
    const medianocheUtc = new Date(Date.UTC(2026, 8, 3));
    expect(aMarcaAsistencia({ colaboradorId: 7, dia: medianocheUtc }).dia).toBe('2026-09-03');
  });
});
