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
 *
 * Y el segundo cambio, más chico pero del mismo tipo: el AUDITOR puede
 * justificar una falta, y ese día deja de cobrarse. Los tests de abajo cubren
 * las dos mitades de la decisión del cliente ("si cobra el bono de
 * distribución, es como si hubiera asistido"): no paga multa Y cobra bono. Y
 * sobre todo cubren lo que NO pasa -- que `diasAsistidos` no se infle, que es
 * lo que el sello del lacrado afirma.
 */

import { describe, expect, it } from 'vitest';
import {
  aJustificacionAsistencia,
  aMarcaAsistencia,
  diasAsistidosPorColaborador,
  diasDelInventario,
  diasFaltadosCobrables,
  diasJustificadosPorColaborador,
  multaPorInasistencia,
  quienesCobranBono,
  type JustificacionAsistencia,
  type MarcaAsistencia,
} from './asistencia';

/** Atajo: `marca(7, '2026-09-01')`. */
const marca = (colaboradorId: number, dia: string): MarcaAsistencia => ({ colaboradorId, dia });

/** Atajo para una falta perdonada: `perdon(3, '2026-09-02')`. */
const perdon = (colaboradorId: number, dia: string): JustificacionAsistencia => ({
  colaboradorId,
  dia,
  justificada: true,
});

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
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 1, diasJustificados: 0 }, 20)).toBe(40);
  });

  it('vino todos los días: no paga nada', () => {
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 3, diasJustificados: 0 }, 20)).toBe(0);
  });

  it('no vino ningún día: paga el inventario completo', () => {
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 0, diasJustificados: 0 }, 20)).toBe(60);
  });

  it('EL CAMBIO DE REGLA: faltar un día ya no cuesta lo mismo que no venir nunca', () => {
    // Con la regla vieja (monto fijo por ausente) los dos pagaban S/20. Este
    // test existe para que se note si alguien vuelve al monto fijo.
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 2, diasJustificados: 0 }, 20)).toBe(20);
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 0, diasJustificados: 0 }, 20)).toBe(60);
  });

  it('NUNCA negativa: más días asistidos que días de inventario da 0', () => {
    // `diasInventario` viene congelado del cierre y los días asistidos de las
    // marcas de hoy. Una multa negativa sería un PAGO al colaborador que nadie
    // autorizó.
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 5, diasJustificados: 0 }, 20)).toBe(0);
  });

  it('inventario de 0 días no multa a nadie', () => {
    expect(multaPorInasistencia({ diasInventario: 0, diasAsistidos: 0, diasJustificados: 0 }, 20)).toBe(0);
  });

  it('tarifa con centavos: exacta, sin el arrastre del punto flotante', () => {
    // 20.10 * 3 da 60.300000000000004 con decimales. Este número entra directo
    // a la suma que tiene que cerrar contra el fondo de multas.
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 0, diasJustificados: 0 }, 20.1)).toBe(60.3);
    expect(multaPorInasistencia({ diasInventario: 10, diasAsistidos: 0, diasJustificados: 0 }, 0.1)).toBe(1);
  });

  it('tarifa en 0: no hay multa aunque haya faltado todo', () => {
    // Una tarifa en cero es una decisión válida del cliente, no un dato que
    // falta -- y si fuera un dato que falta, no se arregla multando.
    expect(multaPorInasistencia({ diasInventario: 3, diasAsistidos: 0, diasJustificados: 0 }, 0)).toBe(0);
  });
});

describe('quienesCobranBono', () => {
  it('los del ejemplo canónico: Silvia y Óscar sí, Delia no', () => {
    expect(quienesCobranBono({ marcas: TRES_DIAS, justificaciones: [], diasInventario: 3 })).toEqual(new Set([SILVIA, OSCAR]));
  });

  it('es EXACTAMENTE el conjunto de los que no pagan multa', () => {
    // La invariante que hace cerrar el fondo: nadie puede cobrar bono Y pagar
    // multa. Si se rompiera, se repartiría entre gente que además aportó.
    const dias = diasAsistidosPorColaborador(TRES_DIAS);
    const conBono = quienesCobranBono({ marcas: TRES_DIAS, justificaciones: [], diasInventario: 3 });
    for (const id of [SILVIA, OSCAR, DELIA, 99]) {
      const multa = multaPorInasistencia(
        { diasInventario: 3, diasAsistidos: dias.get(id) ?? 0, diasJustificados: 0 },
        20,
      );
      expect(conBono.has(id)).toBe(multa === 0);
    }
  });

  it('usa el denominador CONGELADO que le pasan, no el que deduciría de las marcas', () => {
    // Las marcas dicen 3 días; el resultado congelado dice 4 (el coordinador
    // borró la última marca de un día después de cerrar). Con 4, nadie vino
    // todos los días -- y nadie cobra bono. Si esta función dedujera el
    // denominador de las marcas, Silvia y Óscar cobrarían bono por un día que
    // el inventario firmado dice que existió y ellos no hicieron.
    expect(quienesCobranBono({ marcas: TRES_DIAS, justificaciones: [], diasInventario: 4 })).toEqual(new Set());
  });

  it('cero días de inventario: no cobra bono nadie', () => {
    // No hubo inventario que asistir. Sin este corte, `dias >= 0` metería a
    // todo el mundo -- incluso a quien no tiene una sola marca.
    expect(quienesCobranBono({ marcas: TRES_DIAS, justificaciones: [], diasInventario: 0 })).toEqual(new Set());
  });

  it('sin marcas no cobra nadie, y no revienta', () => {
    expect(quienesCobranBono({ marcas: [], justificaciones: [], diasInventario: 3 })).toEqual(new Set());
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

/**
 * LAS JUSTIFICACIONES. La decisión del cliente, textual: *"si cobra el bono de
 * distribución, es como si hubiera asistido"*.
 *
 * Son dos efectos y los dos tienen que pasar juntos. Media medida -- perdonar
 * la multa pero no dar el bono, o al revés -- sería otra regla, y además
 * rompería la invariante que hace cerrar la planilla: nadie cobra bono Y paga
 * multa.
 */
describe('diasJustificadosPorColaborador', () => {
  it('cuenta los días perdonados de cada uno', () => {
    const dias = diasJustificadosPorColaborador([
      perdon(DELIA, '2026-09-02'),
      perdon(DELIA, '2026-09-03'),
      perdon(OSCAR, '2026-09-03'),
    ]);
    expect(dias.get(DELIA)).toBe(2);
    expect(dias.get(OSCAR)).toBe(1);
  });

  it('dos perdones del MISMO día cuentan como uno', () => {
    // El @@unique lo impide en la base; acá no puede apoyarse en eso. Si
    // contara filas, dos perdones del mismo día le descontarían DOS días de
    // multa a alguien que faltó uno solo.
    const dias = diasJustificadosPorColaborador([perdon(DELIA, '2026-09-02'), perdon(DELIA, '2026-09-02')]);
    expect(dias.get(DELIA)).toBe(1);
  });

  it('sin justificaciones, Map vacío', () => {
    expect(diasJustificadosPorColaborador([]).size).toBe(0);
  });
});

describe('multaPorInasistencia con faltas justificadas', () => {
  it('EL CASO DEL CLIENTE: Delia hizo 1 de 3 y le perdonan los otros 2 -> no paga nada', () => {
    // Sin el perdón pagaría S/40 (el ejemplo canónico del brief).
    expect(
      multaPorInasistencia({ diasInventario: 3, diasAsistidos: 1, diasJustificados: 2 }, 20),
    ).toBe(0);
  });

  it('perdón PARCIAL: 1 de 3 con un solo día justificado paga un día', () => {
    expect(
      multaPorInasistencia({ diasInventario: 3, diasAsistidos: 1, diasJustificados: 1 }, 20),
    ).toBe(20);
  });

  it('no vino NINGUN día y le perdonan todo: no paga nada', () => {
    // Es un caso real -- una licencia que cubre el inventario entero -- y el
    // que más incomoda: la persona no estuvo y cobra bono igual. Es
    // exactamente lo que el cliente pidió.
    expect(
      multaPorInasistencia({ diasInventario: 3, diasAsistidos: 0, diasJustificados: 3 }, 20),
    ).toBe(0);
  });

  it('NUNCA negativa: asistidos + justificados por encima de los días da 0', () => {
    // Pasa de verdad: se justifica un día en el que además había marca. Una
    // multa negativa sería un PAGO al colaborador que nadie autorizó.
    expect(
      multaPorInasistencia({ diasInventario: 3, diasAsistidos: 3, diasJustificados: 2 }, 20),
    ).toBe(0);
  });

  it('el día justificado vale EXACTAMENTE lo mismo que uno asistido', () => {
    // La forma más directa de decir la regla: para la plata, los dos números
    // son intercambiables. Lo que no es intercambiable es lo que afirman, y
    // eso lo cuida el sello (ver historial.lacrado.ts).
    const tarifa = 20;
    for (const [asistidos, justificados] of [[3, 0], [2, 1], [1, 2], [0, 3]]) {
      expect(
        multaPorInasistencia(
          { diasInventario: 3, diasAsistidos: asistidos!, diasJustificados: justificados! },
          tarifa,
        ),
      ).toBe(0);
    }
  });
});

describe('quienesCobranBono con faltas justificadas', () => {
  it('Delia cobra bono si le perdonan los dos días que faltó', () => {
    const conBono = quienesCobranBono({
      marcas: TRES_DIAS,
      justificaciones: [perdon(DELIA, '2026-09-02'), perdon(DELIA, '2026-09-03')],
      diasInventario: 3,
    });
    expect(conBono).toEqual(new Set([SILVIA, OSCAR, DELIA]));
  });

  it('con UN día perdonado de dos que faltó, sigue sin cobrar bono', () => {
    const conBono = quienesCobranBono({
      marcas: TRES_DIAS,
      justificaciones: [perdon(DELIA, '2026-09-02')],
      diasInventario: 3,
    });
    expect(conBono.has(DELIA)).toBe(false);
  });

  it('quien NO tiene una sola marca pero tiene todo perdonado, cobra bono', () => {
    // El caso que obliga a que el universo sean las dos listas juntas: esta
    // persona no aparece en las marcas. Si se recorrieran sólo las marcas,
    // quedaría afuera del bono aunque no pague multa -- y ahí se rompe la
    // equivalencia "no paga multa === cobra bono", que es lo que hace cerrar
    // el fondo.
    const conBono = quienesCobranBono({
      marcas: TRES_DIAS,
      justificaciones: [perdon(99, '2026-09-01'), perdon(99, '2026-09-02'), perdon(99, '2026-09-03')],
      diasInventario: 3,
    });
    expect(conBono.has(99)).toBe(true);
  });

  it('sigue siendo EXACTAMENTE el conjunto de los que no pagan multa, con perdones de por medio', () => {
    // La invariante del fondo, ahora con justificaciones mezcladas. Es el
    // test que hay que mirar si alguna vez la planilla deja de sumar el neto.
    const justificaciones = [perdon(DELIA, '2026-09-02'), perdon(99, '2026-09-01')];
    const asistidos = diasAsistidosPorColaborador(TRES_DIAS);
    const justificados = diasJustificadosPorColaborador(justificaciones);
    const conBono = quienesCobranBono({ marcas: TRES_DIAS, justificaciones, diasInventario: 3 });

    for (const id of [SILVIA, OSCAR, DELIA, 99, 1234]) {
      const multa = multaPorInasistencia(
        {
          diasInventario: 3,
          diasAsistidos: asistidos.get(id) ?? 0,
          diasJustificados: justificados.get(id) ?? 0,
        },
        20,
      );
      expect(conBono.has(id)).toBe(multa === 0);
    }
  });

  it('cero días de inventario: no cobra nadie, ni con perdones', () => {
    expect(
      quienesCobranBono({ marcas: [], justificaciones: [perdon(DELIA, '2026-09-01')], diasInventario: 0 }),
    ).toEqual(new Set());
  });
});

describe('diasFaltadosCobrables', () => {
  it('es la MISMA resta que usa la multa y que decide el bono', () => {
    // Existe para que "no paga multa" y "cobra bono" no puedan divergir: son
    // un solo cálculo. Si alguna vez se escriben dos, el fondo se reparte
    // entre gente que además aportó.
    expect(diasFaltadosCobrables({ diasInventario: 3, diasAsistidos: 1, diasJustificados: 0 })).toBe(2);
    expect(diasFaltadosCobrables({ diasInventario: 3, diasAsistidos: 1, diasJustificados: 2 })).toBe(0);
    expect(diasFaltadosCobrables({ diasInventario: 3, diasAsistidos: 9, diasJustificados: 9 })).toBe(0);
  });
});

describe('aJustificacionAsistencia', () => {
  it('traduce la fila de Prisma y la marca como justificación', () => {
    // El `justificada: true` no es decorativo: es lo que impide pasar una
    // lista de marcas donde se esperan perdones (y al revés).
    expect(aJustificacionAsistencia({ colaboradorId: 7, dia: new Date('2026-09-03T00:00:00.000Z') })).toEqual({
      colaboradorId: 7,
      dia: '2026-09-03',
      justificada: true,
    });
  });

  it('no corre el día por el huso horario, igual que las marcas', () => {
    // Medianoche UTC formateada en hora local (Lima, UTC−5) daría el día
    // anterior: el perdón caería en un día distinto del que se pidió y no
    // taparía la falta que tenía que tapar.
    expect(
      aJustificacionAsistencia({ colaboradorId: 7, dia: new Date('2026-09-01T00:00:00.000Z') }).dia,
    ).toBe('2026-09-01');
  });
});
