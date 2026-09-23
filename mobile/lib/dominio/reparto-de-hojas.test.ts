/**
 * EL CASO QUE ORIGINA ESTE ARCHIVO, y que es el primer test de abajo: la
 * ronda 4 del inventario 8073 (Market Luzuriaga, 2026-09-22) tenía UNA hoja
 * asignada a Carla Depaz y CUATRO contadores presentes desde la mañana. La
 * asistencia no había cambiado y la pantalla pedía repartir de nuevo para
 * siempre.
 *
 * Los tests están escritos con esa forma: pocas hojas y varios presentes es
 * el caso NORMAL de una ronda de reconteo, no el raro. Lo que se fija acá es
 * la frontera entre "repartir de nuevo cambia algo" y "no cambia nada" --
 * porque del lado equivocado de esa frontera el Coordinador reasigna hojas
 * que ya estaban bien, una y otra vez.
 */

import { describe, expect, it } from 'vitest';

import {
  estadoDelReparto,
  textoRepartoDesactualizado,
  textoRepartoHecho,
  type HojaRepartida,
} from './reparto-de-hojas';

const miles = (n: number): string => String(n);

/** Los cuatro contadores de Luzuriaga, los del caso medido. */
const ELENA = 'Elena Ruiz';
const LUIS = 'Luis Paz';
const CARLA = 'Carla Depaz';
const HUGO = 'Hugo Ríos';
const LOS_CUATRO = [ELENA, LUIS, CARLA, HUGO];

/** `hojas('Carla', 'Carla', 'Hugo')` -> tres hojas, dos de Carla y una de Hugo. */
function hojas(...duenos: string[]): HojaRepartida[] {
  return duenos.map((nombre) => ({ asignados: [nombre] }));
}

describe('cuándo NO hay que repartir de nuevo', () => {
  it('una hoja entre cuatro presentes no pide repartir (el bug del inventario 8073)', () => {
    const estado = estadoDelReparto(hojas(CARLA), LOS_CUATRO);
    expect(estado.motivo).toBeNull();
    expect(textoRepartoDesactualizado(estado)).toBeNull();
  });

  it('tres hojas entre cuatro presentes tampoco: no alcanzan, y eso no es un error', () => {
    const estado = estadoDelReparto(hojas(ELENA, LUIS, CARLA), LOS_CUATRO);
    expect(estado.motivo).toBeNull();
    expect(estado.presentesSinHoja).toEqual([HUGO]);
  });

  it('reparto parejo con todos presentes: nada que avisar', () => {
    const estado = estadoDelReparto(hojas(ELENA, ELENA, LUIS, LUIS, CARLA, CARLA, HUGO, HUGO), LOS_CUATRO);
    expect(estado.motivo).toBeNull();
    expect(estado.hojasPorPersona).toEqual([2, 2]);
  });

  it('un solo contador presente con todas las hojas: nada que avisar', () => {
    const estado = estadoDelReparto(hojas(CARLA, CARLA, CARLA), [CARLA]);
    expect(estado.motivo).toBeNull();
  });
});

describe('cuándo SÍ hay que repartir de nuevo', () => {
  it('alguien con hoja ya no figura presente: su hoja no la cuenta nadie', () => {
    const estado = estadoDelReparto(hojas(ELENA, LUIS, CARLA, HUGO), [ELENA, LUIS, CARLA]);
    expect(estado.motivo).toBe('hoja-sin-contador');
    expect(estado.conHojaAusentes).toEqual([HUGO]);
    expect(estado.hojasDeAusentes).toBe(1);
  });

  it('manda la hoja huérfana aunque además falte incluir a alguien', () => {
    // Hugo se fue con sus 2 hojas y encima Elena nunca recibió ninguna.
    const estado = estadoDelReparto(hojas(LUIS, CARLA, HUGO, HUGO), [ELENA, LUIS, CARLA]);
    expect(estado.motivo).toBe('hoja-sin-contador');
  });

  it('llegó alguien más y sobran hojas para darle', () => {
    const estado = estadoDelReparto(hojas(CARLA, CARLA, CARLA, HUGO, HUGO), LOS_CUATRO);
    expect(estado.motivo).toBe('presente-sin-hoja');
    expect(estado.presentesSinHoja).toEqual([ELENA, LUIS]);
  });

  it('con tantas hojas como personas con hoja no se pide repartir, aunque falten presentes', () => {
    // 2 hojas, 2 dueños, 2 presentes sin hoja: repartir de nuevo daría 2
    // hojas a 4 personas, o sea seguiría habiendo presentes sin hoja. Es la
    // frontera exacta del falso positivo.
    const estado = estadoDelReparto(hojas(CARLA, HUGO), LOS_CUATRO);
    expect(estado.motivo).toBeNull();
  });
});

describe('hojas compartidas entre dos personas', () => {
  it('cuentan para los dos asignados', () => {
    const estado = estadoDelReparto([{ asignados: [CARLA, HUGO] }, { asignados: [CARLA, HUGO] }], LOS_CUATRO);
    expect(estado.conHoja).toEqual([CARLA, HUGO]);
    expect(estado.hojasPorPersona).toEqual([2, 2]);
    // 2 hojas y 2 dueños: repartir de nuevo no le daría hoja a nadie más.
    expect(estado.motivo).toBeNull();
  });

  it('si uno de los dos se fue, la hoja queda huérfana igual', () => {
    const estado = estadoDelReparto([{ asignados: [CARLA, HUGO] }], [ELENA, LUIS, CARLA]);
    expect(estado.motivo).toBe('hoja-sin-contador');
    expect(estado.conHojaAusentes).toEqual([HUGO]);
    expect(estado.hojasDeAusentes).toBe(1);
  });
});

describe('el texto del aviso', () => {
  it('nombra a quien se fue y cuántas hojas quedaron sin dueño', () => {
    const estado = estadoDelReparto(hojas(ELENA, LUIS, CARLA, HUGO), [ELENA, LUIS, CARLA]);
    expect(textoRepartoDesactualizado(estado)).toBe(
      'Hugo Ríos tiene 1 hoja asignada y hoy no figura entre los presentes: nadie la va a contar. ' +
        'Vuelve a repartir entre los 3 contadores presentes.',
    );
  });

  it('nombra a quien llegó, sin afirmar que las hojas estén en manos de gente ausente', () => {
    const estado = estadoDelReparto(hojas(CARLA, CARLA, CARLA, HUGO, HUGO), LOS_CUATRO);
    expect(textoRepartoDesactualizado(estado)).toBe(
      'Elena Ruiz y Luis Paz están presentes y todavía no tienen hoja, y las 5 hojas están repartidas ' +
        'entre 2 personas. Vuelve a repartir entre los 4 contadores presentes.',
    );
  });

  it('con muchos nombres recorta, pero solo cuando recortar ahorra algo', () => {
    const seis = ['A', 'B', 'C', 'D', 'E', 'F'];
    const cuatro = ['A', 'B', 'C', 'D'];
    const conSeis = estadoDelReparto(hojas('Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'), ['Z', ...seis]);
    expect(textoRepartoDesactualizado(conSeis)).toContain('A, B, C y 3 más están presentes');
    const conCuatro = estadoDelReparto(hojas('Z', 'Z', 'Z', 'Z', 'Z'), ['Z', ...cuatro]);
    expect(textoRepartoDesactualizado(conCuatro)).toContain('A, B, C y D están presentes');
  });
});

describe('el texto del paso 3 con el reparto hecho', () => {
  it('con todos los presentes servidos dice el reparto, como siempre', () => {
    const estado = estadoDelReparto(hojas(ELENA, ELENA, LUIS, LUIS, CARLA, CARLA, HUGO, HUGO), LOS_CUATRO);
    expect(textoRepartoHecho(estado, miles)).toBe(
      'Las 8 hojas ya están repartidas entre los 4 contadores presentes, en bloques contiguos (2 hojas por persona).',
    );
  });

  it('con un solo contador presente no promete un reparto "entre"', () => {
    const estado = estadoDelReparto(hojas(CARLA, CARLA, CARLA), [CARLA]);
    expect(textoRepartoHecho(estado, miles)).toBe(
      'Las 3 hojas ya están asignadas al contador presente, en bloques contiguos (3 hojas por persona).',
    );
  });

  it('reparto desparejo: el rango va en plural', () => {
    const estado = estadoDelReparto(hojas(CARLA, CARLA, CARLA, HUGO, HUGO), [CARLA, HUGO]);
    expect(textoRepartoHecho(estado, miles)).toContain('(2–3 hojas por persona)');
  });

  it('con menos hojas que presentes nombra a quién quedó asignada (el caso 8073)', () => {
    const estado = estadoDelReparto(hojas(CARLA), LOS_CUATRO);
    expect(textoRepartoHecho(estado, miles)).toBe(
      'La única hoja quedó asignada a Carla Depaz. Hay 4 contadores presentes: no alcanzan las hojas para todos.',
    );
  });

  it('nunca dice "repartida entre los 4 contadores presentes" si no lo está', () => {
    const estado = estadoDelReparto(hojas(CARLA), LOS_CUATRO);
    expect(textoRepartoHecho(estado, miles)).not.toContain('repartida entre los 4');
  });

  it('con hojas de sobra dice que alguien presente todavía no tiene', () => {
    const estado = estadoDelReparto(hojas(CARLA, CARLA, CARLA, HUGO, HUGO), LOS_CUATRO);
    expect(textoRepartoHecho(estado, miles)).toBe(
      'Las 5 hojas quedaron asignadas a Carla Depaz y Hugo Ríos. Elena Ruiz y Luis Paz están presentes y ' +
        'todavía no tienen hoja.',
    );
  });

  it('con una hoja en manos de alguien que se fue, lo dice', () => {
    const estado = estadoDelReparto(hojas(ELENA, LUIS, CARLA, HUGO), [ELENA, LUIS, CARLA]);
    expect(textoRepartoHecho(estado, miles)).toBe(
      'Las 4 hojas quedaron asignadas a Elena Ruiz, Luis Paz, Carla Depaz y Hugo Ríos. ' +
        'Hugo Ríos ya no figura entre los presentes de hoy.',
    );
  });

  it('usa el formato de miles que le pasan', () => {
    const estado = estadoDelReparto(
      Array.from({ length: 1200 }, () => ({ asignados: [CARLA] })),
      [CARLA],
    );
    expect(textoRepartoHecho(estado, (n) => (n === 1200 ? '1.200' : String(n)))).toContain('Las 1.200 hojas');
  });
});
