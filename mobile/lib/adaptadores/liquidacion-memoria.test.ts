/**
 * LA INVARIANTE QUE NO SE PUEDE ROMPER: la planilla suma exactamente el
 * faltante neto.
 *
 *   Σ(cuota) + Σ(multa) − Σ(bono) = neto + fondo − fondo = neto
 *
 * Lo que se recauda de quienes faltaron es exactamente lo que se reparte
 * entre quienes vinieron todos los días. Si el fondo deja de cerrar, la
 * diferencia aparece como un descuadre en la nómina tres meses después, y
 * para entonces ya nadie sabe de dónde salió.
 *
 * Estos tests corren sobre el dataset de demo (Luzuriaga), pero lo que
 * prueban es la forma del cálculo, no los montos: el mismo reparto que hace
 * el backend. Se escribieron al pasar la multa de "monto fijo por persona
 * ausente" a "tarifa x día faltado", que es donde el fondo se podía dejar de
 * cerrar sin que ningún test lo viera.
 */

import { describe, expect, it } from 'vitest';

import { liquidacionMemoria } from './liquidacion-memoria';

const LUZURIAGA = 1;

/** Ver sesion-memoria.ts + ASISTENCIA_LUZURIAGA en el adaptador. */
const LUIS = 107; // 1 de 3 días -> faltó 2
const MANUEL = 109; // 2 de 3 días -> faltó 1
const YENI = 110; // 0 de 3 días -> faltó 3
const MARIA = 102; // 3 de 3 días

const redondear = (n: number): number => Math.round(n * 100) / 100;

describe('liquidacionMemoria.deSucursal — la multa se cobra POR DÍA', () => {
  it('la planilla suma exactamente el faltante neto: el fondo de multas cierra', async () => {
    const liquidacion = (await liquidacionMemoria.deSucursal(LUZURIAGA))!;

    const suma = redondear(liquidacion.planilla.reduce((total, p) => total + p.monto, 0));
    expect(suma).toBe(redondear(liquidacion.faltanteNeto!));
  });

  /**
   * Con la regla vieja los tres pagaban lo mismo (S/20 por ausente). Este
   * test es la diferencia entre las dos reglas, en plata.
   */
  it('faltar dos días cuesta el doble que faltar uno, y tres el triple', async () => {
    const { planilla, cuotaBase, multaInasistencia } = (await liquidacionMemoria.deSucursal(LUZURIAGA))!;
    const multaDe = (id: number): number => redondear(planilla.find((p) => p.colaboradorId === id)!.monto - cuotaBase!);

    expect(multaDe(MANUEL)).toBe(multaInasistencia); // faltó 1 día
    expect(multaDe(LUIS)).toBe(multaInasistencia * 2); // faltó 2
    expect(multaDe(YENI)).toBe(multaInasistencia * 3); // faltó 3
  });

  it('cada fila trae sus días asistidos sobre los días del inventario', async () => {
    const liquidacion = (await liquidacionMemoria.deSucursal(LUZURIAGA))!;
    const dias = (id: number): number | null => liquidacion.planilla.find((p) => p.colaboradorId === id)!.diasAsistidos;

    expect(liquidacion.diasDelInventario).toBe(3);
    expect(dias(LUIS)).toBe(1);
    expect(dias(MANUEL)).toBe(2);
    expect(dias(YENI)).toBe(0);
    expect(dias(MARIA)).toBe(3);
  });

  /** `asistio` es asistencia COMPLETA: quien vino 2 de 3 no cobra bono. */
  it('solo cobra bono quien vino TODOS los días', async () => {
    const { planilla } = (await liquidacionMemoria.deSucursal(LUZURIAGA))!;
    const asistio = (id: number): boolean => planilla.find((p) => p.colaboradorId === id)!.asistio;

    expect(asistio(MARIA)).toBe(true);
    expect(asistio(MANUEL)).toBe(false); // vino 2 de 3: trabajó, pero no completo
    expect(asistio(YENI)).toBe(false);
  });

  /**
   * EL BUG DE INTEGRACIÓN, congelado en un test.
   *
   * `totalFaltas` son PERSONAS y `diasFaltadosEnTotal` son DÍAS: son dos
   * cifras distintas y con la multa por día ya no coinciden. Multiplicar
   * `totalFaltas × multaInasistencia` (que es la tarifa POR DÍA) da de menos
   * en cuanto alguien falte más de una jornada -- acá, S/60 en vez de S/120:
   * la mitad del fondo, con toda la pinta de estar bien porque la cuenta
   * cierra contra sus propios factores.
   *
   * Las dos tienen que seguir viniendo, y tienen que seguir siendo distintas.
   */
  it('totalFaltas son PERSONAS y diasFaltadosEnTotal son DÍAS: no son la misma cifra', async () => {
    const { totalFaltas, diasFaltadosEnTotal, planilla } = (await liquidacionMemoria.deSucursal(LUZURIAGA))!;

    expect(totalFaltas).toBe(3); // Luis, Manuel y Yeni
    expect(diasFaltadosEnTotal).toBe(6); // 2 + 1 + 3
    expect(planilla.filter((p) => !p.asistio)).toHaveLength(totalFaltas!);
  });

  it('el fondo viene calculado y sale de los DÍAS, no de las personas', async () => {
    const { fondoMultas, diasFaltadosEnTotal, totalFaltas, multaInasistencia } = (await liquidacionMemoria.deSucursal(
      LUZURIAGA,
    ))!;

    expect(fondoMultas).toBe(diasFaltadosEnTotal! * multaInasistencia);
    // La cuenta equivocada, explícita, para que se vea cuánto se perdía.
    expect(fondoMultas).not.toBe(totalFaltas! * multaInasistencia);
  });

  /** El bono sale del fondo REAL: si el fondo fuera la mitad, cada asistente cobraría la mitad. */
  it('el bono reparte el fondo entero entre quienes vinieron todos los días', async () => {
    const { fondoMultas, bonoAsistencia, planilla } = (await liquidacionMemoria.deSucursal(LUZURIAGA))!;
    const completos = planilla.filter((p) => p.asistio).length;

    expect(redondear(bonoAsistencia! * completos)).toBe(redondear(fondoMultas!));
  });
});

describe('liquidacionMemoria.conciliacion', () => {
  it('el fondo recaudado es igual al repartido: no queda nada sin repartir', async () => {
    const conciliacion = (await liquidacionMemoria.conciliacion(LUZURIAGA))!;

    expect(conciliacion.calculable).toBe(true);
    if (!conciliacion.calculable) return;
    expect(conciliacion.fondoDeMultas.recaudado).toBe(conciliacion.fondoDeMultas.repartido);
    expect(conciliacion.fondoDeMultas.cierra).toBe(true);
  });

  /**
   * La invariante que ya se rompió una vez en producción: el "redistribuido
   * entre los -2 colaboradores" del 2026-09-05. Los dos son PERSONAS y suman
   * el padrón entero, siempre.
   */
  it('asistieron/faltaron cuentan personas, y suman el padrón entero', async () => {
    const conciliacion = (await liquidacionMemoria.conciliacion(LUZURIAGA))!;

    if (!conciliacion.calculable) throw new Error('El dataset de demo tiene que ser calculable.');
    expect(conciliacion.asistieron + conciliacion.faltaron).toBe(conciliacion.colaboradores);
    expect(conciliacion.faltaron).toBe(3);
  });

  /** Lo recaudado es el fondo tal cual, no una multiplicación rearmada acá. */
  it('lo recaudado es el fondo que informa la liquidación', async () => {
    const liquidacion = (await liquidacionMemoria.deSucursal(LUZURIAGA))!;
    const conciliacion = (await liquidacionMemoria.conciliacion(LUZURIAGA))!;

    if (!conciliacion.calculable) throw new Error('El dataset de demo tiene que ser calculable.');
    expect(conciliacion.fondoDeMultas.recaudado).toBe(redondear(liquidacion.fondoMultas!));
  });
});
