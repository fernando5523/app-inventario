/**
 * La multa de cada persona se calcula sobre estos números. Un día de más o
 * de menos acá es plata descontada de un sueldo, así que los casos que se
 * prueban son los que costarían dinero si se rompieran:
 * el que no marcó nunca, el que marcó dos veces el mismo día, y el
 * denominador cuando todavía no hay ningún día registrado.
 */

import { describe, expect, it } from 'vitest';

import {
  contadoresPresentes,
  diasAsistidosPorColaborador,
  diasFaltados,
  filasDeAsistencia,
  multaPorInasistencia,
  presentesEnElDia,
  textoDiasAsistidos,
  type MarcaDeAsistencia,
} from './asistencia';

/** Market Bolívar, ver adaptadores/sesion-memoria.ts. */
const OSCAR = { id: 301, nombre: 'Óscar Maguiña', rol: 'coordinador' as const };
const SILVIA = { id: 302, nombre: 'Silvia Huerta', rol: 'conteo' as const };
const DELIA = { id: 304, nombre: 'Delia Ocaña', rol: 'conteo' as const };

function marca(colaboradorId: number, dia: string, hora = '08:00'): MarcaDeAsistencia {
  return { colaboradorId, dia, registradoEn: `${dia}T${hora}:00.000Z` };
}

/** El ejemplo canónico del cambio: 3 días, Silvia 3/3, Óscar 3/3, Delia 1/3. */
const DIAS = ['2026-09-14', '2026-09-15', '2026-09-16'];
const MARCAS_CANONICAS: MarcaDeAsistencia[] = [
  ...DIAS.map((d) => marca(SILVIA.id, d)),
  ...DIAS.map((d) => marca(OSCAR.id, d)),
  marca(DELIA.id, DIAS[0]),
];

describe('diasAsistidosPorColaborador', () => {
  it('cuenta los días distintos de cada persona', () => {
    const cuenta = diasAsistidosPorColaborador(MARCAS_CANONICAS);

    expect(cuenta.get(SILVIA.id)).toBe(3);
    expect(cuenta.get(OSCAR.id)).toBe(3);
    expect(cuenta.get(DELIA.id)).toBe(1);
  });

  it('dos marcas del MISMO día son un solo día, no dos', () => {
    const cuenta = diasAsistidosPorColaborador([marca(DELIA.id, DIAS[0], '08:00'), marca(DELIA.id, DIAS[0], '14:30')]);

    expect(cuenta.get(DELIA.id)).toBe(1);
  });

  it('quien no tiene ninguna marca no aparece en el mapa', () => {
    expect(diasAsistidosPorColaborador(MARCAS_CANONICAS).has(999)).toBe(false);
  });
});

describe('filasDeAsistencia', () => {
  const personal = [OSCAR, SILVIA, DELIA];

  it('respeta el orden del padrón y trae a TODOS, marquen o no', () => {
    const filas = filasDeAsistencia(personal, [], DIAS[0]);

    expect(filas.map((f) => f.persona.id)).toEqual([OSCAR.id, SILVIA.id, DELIA.id]);
    expect(filas.every((f) => f.diasAsistidos === 0 && f.marcaDelDia === null)).toBe(true);
  });

  it('cuenta los días de TODO el inventario, no solo los del día mirado', () => {
    const filas = filasDeAsistencia(personal, MARCAS_CANONICAS, DIAS[2]);

    // Delia solo marcó el primer día: en el tercero no entró, pero lleva 1.
    const delia = filas.find((f) => f.persona.id === DELIA.id)!;
    expect(delia.diasAsistidos).toBe(1);
    expect(delia.marcaDelDia).toBeNull();
  });

  it('la marca del día trae su hora: es lo que prueba a qué hora entró', () => {
    const filas = filasDeAsistencia(personal, [marca(SILVIA.id, DIAS[1], '07:42')], DIAS[1]);

    expect(filas.find((f) => f.persona.id === SILVIA.id)!.marcaDelDia!.registradoEn).toBe('2026-09-15T07:42:00.000Z');
  });

  it('una marca de OTRO día no cuenta como presente hoy', () => {
    const filas = filasDeAsistencia(personal, [marca(SILVIA.id, DIAS[0])], DIAS[1]);

    expect(filas.find((f) => f.persona.id === SILVIA.id)!.marcaDelDia).toBeNull();
    expect(presentesEnElDia(filas)).toBe(0);
  });

  it('presentesEnElDia cuenta solo a los que ya entraron ese día', () => {
    const filas = filasDeAsistencia(personal, MARCAS_CANONICAS, DIAS[0]);

    expect(presentesEnElDia(filas)).toBe(3);
    expect(presentesEnElDia(filasDeAsistencia(personal, MARCAS_CANONICAS, DIAS[2]))).toBe(2);
  });
});

describe('textoDiasAsistidos', () => {
  it('muestra numerador y denominador juntos', () => {
    expect(textoDiasAsistidos(1, 3)).toBe('1 de 3 días');
    expect(textoDiasAsistidos(3, 3)).toBe('3 de 3 días');
  });

  it('concuerda el sustantivo con el denominador', () => {
    expect(textoDiasAsistidos(1, 1)).toBe('1 de 1 día');
  });

  it('con un dato que no vino dice "—", nunca 0: un cero inventado afirma que faltó', () => {
    expect(textoDiasAsistidos(null, 3)).toBe('—');
    expect(textoDiasAsistidos(2, null)).toBe('—');
  });

  it('sin ningún día registrado no inventa una fracción', () => {
    expect(textoDiasAsistidos(0, 0)).toBe('Sin días registrados');
  });
});

describe('diasFaltados', () => {
  it('es la resta: los del inventario menos los que marcó', () => {
    expect(diasFaltados(3, 1)).toBe(2);
    expect(diasFaltados(3, 3)).toBe(0);
  });

  it('NUNCA es negativo: un faltado negativo sería una multa a favor de la persona', () => {
    expect(diasFaltados(2, 5)).toBe(0);
  });
});

/**
 * El ejemplo canónico del cambio, tal cual lo fijó el contrato: inventario de
 * 3 días, tarifa S/20 por día. Si esta tabla deja de dar, la planilla le
 * cobra de más (o de menos) a alguien.
 */
describe('multaPorInasistencia', () => {
  const TARIFA = 20;

  it('quien vino todos los días no paga multa: es quien cobra el bono', () => {
    expect(multaPorInasistencia(3, 3, TARIFA)).toBe(0);
  });

  it('quien vino 1 de 3 paga los 2 días que faltó', () => {
    expect(multaPorInasistencia(3, 1, TARIFA)).toBe(40);
  });

  it('quien no vino ningún día paga los 3', () => {
    expect(multaPorInasistencia(3, 0, TARIFA)).toBe(60);
  });

  /** La regla vieja cobraba S/20 fijos por persona ausente: acá se ve la diferencia. */
  it('faltar dos días cuesta el doble que faltar uno', () => {
    expect(multaPorInasistencia(3, 2, TARIFA)).toBe(20);
    expect(multaPorInasistencia(3, 1, TARIFA)).toBe(40);
  });

  it('nunca es negativa, ni con más días asistidos que días de inventario', () => {
    expect(multaPorInasistencia(2, 5, TARIFA)).toBe(0);
  });

  /**
   * Sin días registrados nadie faltó: el fondo queda en 0 y nadie paga. Que
   * ESO no se muestre como una planilla normal lo decide la pantalla con
   * `advertencia.asistenciaSinRegistrar` -- acá la cuenta simplemente no
   * inventa una deuda.
   */
  it('con cero días de inventario no hay multa para nadie', () => {
    expect(multaPorInasistencia(0, 0, TARIFA)).toBe(0);
  });
});

/**
 * A QUIÉNES SE LES REPARTEN LAS HOJAS. El bug que esto cierra: el paso 3 de
 * "Armar" repartía entre todos los `conteo` del padrón y afirmaba "entre los
 * 5 contadores presentes" sin haber mirado la asistencia. Si dos faltaban,
 * igual recibían hojas y esas hojas quedaban sin contar hasta que alguien se
 * daba cuenta a mitad de la jornada.
 */
describe('contadoresPresentes', () => {
  const PADRON = [
    { id: 1, nombre: 'Óscar', rol: 'coordinador' },
    { id: 2, nombre: 'Silvia', rol: 'conteo' },
    { id: 3, nombre: 'Delia', rol: 'conteo' },
    { id: 4, nombre: 'Jorge', rol: 'auditor' },
  ];
  const HOY = '2026-09-21';
  const marca = (colaboradorId: number, dia = HOY): MarcaDeAsistencia => ({
    colaboradorId,
    dia,
    registradoEn: `${dia}T13:00:00.000Z`,
  });

  it('solo los contadores que marcaron HOY', () => {
    const filas = filasDeAsistencia(PADRON, [marca(1), marca(2)], HOY);
    expect(contadoresPresentes(filas).map((p) => p.nombre)).toEqual(['Silvia']);
  });

  it('el coordinador y el auditor NO entran, aunque hayan marcado', () => {
    // Marcan su propia entrada porque la planilla les cobra la multa igual,
    // pero no cuentan hojas. Darles una sería dejarla sin contar.
    const filas = filasDeAsistencia(PADRON, [marca(1), marca(4)], HOY);
    expect(contadoresPresentes(filas)).toEqual([]);
  });

  it('vino AYER y hoy no: no recibe hojas', () => {
    // `diasAsistidos > 0` no alcanza -- diría que vino algún día. La hoja se
    // reparte hoy y la tiene que contar quien está hoy.
    const filas = filasDeAsistencia(PADRON, [marca(2, '2026-09-20')], HOY);
    expect(contadoresPresentes(filas)).toEqual([]);
  });

  it('sin ninguna marca, nadie', () => {
    expect(contadoresPresentes(filasDeAsistencia(PADRON, [], HOY))).toEqual([]);
  });

  it('devuelve las personas enteras: hacen falta los ids para asignar y los nombres para decir quiénes', () => {
    const filas = filasDeAsistencia(PADRON, [marca(2), marca(3)], HOY);
    expect(contadoresPresentes(filas)).toEqual([
      { id: 2, nombre: 'Silvia', rol: 'conteo' },
      { id: 3, nombre: 'Delia', rol: 'conteo' },
    ]);
  });

  it('respeta el orden del padrón, que es el que ve el Coordinador', () => {
    const filas = filasDeAsistencia(PADRON, [marca(3), marca(2)], HOY);
    expect(contadoresPresentes(filas).map((p) => p.id)).toEqual([2, 3]);
  });
});
