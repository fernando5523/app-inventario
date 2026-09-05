/**
 * La regla del cliente para la asistencia, probada sin base.
 *
 * De acá sale una multa que se le descuenta del sueldo a una persona, así
 * que los cuatro casos de la regla están cubiertos uno por uno -- incluido
 * el que le cuesta plata a alguien que sí fue a trabajar.
 */

import { describe, expect, it } from 'vitest';
import { aHojaParaAsistencia, quienesAsistieron, type HojaParaAsistencia } from './asistencia';

const hoja = (parcial: Partial<HojaParaAsistencia> = {}): HojaParaAsistencia => ({
  asignadoAId: null,
  asignadoA2Id: null,
  tieneConteos: false,
  ...parcial,
});

describe('quienesAsistieron', () => {
  it('contó en la ronda 1: asistió', () => {
    expect(quienesAsistieron([hoja({ asignadoAId: 7, tieneConteos: true })])).toEqual(new Set([7]));
  });

  it('contó SOLO en la ronda 2: asistió igual', () => {
    // El reconteo lo suele hacer OTRA persona, a propósito (las hojas de la
    // ronda 2 nacen sin asignar). Mirar solo la ronda 1 dejaría afuera a
    // quien vino especialmente a recontar.
    //
    // La regla no distingue rondas: la lista que llega ya las incluye todas.
    const hojas = [
      hoja({ asignadoAId: 7, tieneConteos: true }), // ronda 1, otra persona
      hoja({ asignadoAId: 9, tieneConteos: true }), // ronda 2, esta
    ];
    expect(quienesAsistieron(hojas).has(9)).toBe(true);
  });

  /**
   * EL COSTO DE LA REGLA, que el cliente aceptó explícitamente. No es un bug
   * y no hay que "arreglarlo": es el precio de no tener carga manual.
   */
  it('asignado pero SIN ningún conteo: falta', () => {
    expect(quienesAsistieron([hoja({ asignadoAId: 7, tieneConteos: false })])).toEqual(new Set());
  });

  it('nunca asignado: falta', () => {
    // Quien nunca recibió hoja no aparece por ningún lado. En la planilla
    // igual tiene fila, con asistio: false -- eso lo garantiza el universo
    // de `liquidar()`, no esta función.
    expect(quienesAsistieron([hoja({ tieneConteos: true })])).toEqual(new Set());
  });

  it('las DOS personas de una hoja con conteos asistieron', () => {
    // `Conteo` no guarda autor: no se puede saber cuál de las dos cargó cada
    // renglón, y en el conteo de a dos ambas están ahí. Atribuir la hoja a
    // una sola le costaría una multa a la otra.
    expect(quienesAsistieron([hoja({ asignadoAId: 7, asignadoA2Id: 9, tieneConteos: true })])).toEqual(
      new Set([7, 9]),
    );
  });

  it('una hoja sin conteos no salva a NINGUNO de sus dos asignados', () => {
    expect(quienesAsistieron([hoja({ asignadoAId: 7, asignadoA2Id: 9, tieneConteos: false })])).toEqual(new Set());
  });

  it('con varias hojas, alcanza UNA con conteos', () => {
    // Alguien con 3 hojas que solo llegó a cargar la primera vino igual.
    const hojas = [
      hoja({ asignadoAId: 7, tieneConteos: true }),
      hoja({ asignadoAId: 7, tieneConteos: false }),
      hoja({ asignadoAId: 7, tieneConteos: false }),
    ];
    expect(quienesAsistieron(hojas)).toEqual(new Set([7]));
  });

  it('no cuenta dos veces a quien tiene varias hojas', () => {
    const hojas = [hoja({ asignadoAId: 7, tieneConteos: true }), hoja({ asignadoAId: 7, tieneConteos: true })];
    expect(quienesAsistieron(hojas).size).toBe(1);
  });

  it('sin hojas no asistió nadie, y no revienta', () => {
    // Un inventario sin hojas no puede cerrar (rondas.service.ts lo bloquea
    // antes), pero devolver un set vacío es más honesto que asumir algo.
    expect(quienesAsistieron([])).toEqual(new Set());
  });
});

describe('aHojaParaAsistencia', () => {
  it('traduce el _count de Prisma a "tiene conteos"', () => {
    expect(aHojaParaAsistencia({ asignadoAId: 7, asignadoA2Id: null, _count: { conteos: 12 } })).toEqual({
      asignadoAId: 7,
      asignadoA2Id: null,
      tieneConteos: true,
    });
  });

  it('cero conteos es false, no un 0 que se cuela como falsy en otro lado', () => {
    expect(aHojaParaAsistencia({ asignadoAId: 7, asignadoA2Id: null, _count: { conteos: 0 } }).tieneConteos).toBe(
      false,
    );
  });
});
