/**
 * Los ajustes del mes en la Liquidación del Auditor.
 *
 * YA NO HAY FORMULARIO DE MONTOS: los ajustes a favor del personal entran por
 * el Excel de Dynamics (backend e39b370) y el faltante de empresa lo calcula la
 * clasificación de productos (48899bc). Lo que queda para probar es qué dice
 * la pantalla sobre esos dos datos -- y ahí manda la regla de siempre: `null`
 * y `0` son dos cosas distintas.
 */

import { describe, expect, it } from 'vitest';
import { estadoAjustesNegativos, notaFaltanteEmpresa } from './ajustes-formulario';

const soles = (n: number) => `S/ ${n.toFixed(2)}`;

describe('estadoAjustesNegativos: la entrada al Excel de ajustes dice el estado real', () => {
  it('sin importar (null): lo dice, y bloquea liquidar', () => {
    const e = estadoAjustesNegativos(null, soles);
    expect(e.texto).toBe('Todavía no se importó el Excel de ajustes (bloquea liquidar)');
    expect(e.bloqueaLiquidacion).toBe(true);
  });

  it('importado: dice el total a favor del personal, y no bloquea', () => {
    const e = estadoAjustesNegativos(380, soles);
    expect(e.texto).toBe('Importado: S/ 380.00');
    expect(e.bloqueaLiquidacion).toBe(false);
  });

  /** EL CASO DE SIEMPRE: 0 es "se importó y no había", no "nadie importó". */
  it('0 importado es un DATO: no bloquea, y su cartel no es el de null', () => {
    const cero = estadoAjustesNegativos(0, soles);
    expect(cero.texto).toBe('Importado: S/ 0.00');
    expect(cero.bloqueaLiquidacion).toBe(false);
    expect(cero.texto).not.toBe(estadoAjustesNegativos(null, soles).texto);
  });

  it('el botón dice qué hace: importar si falta, ver si ya está', () => {
    expect(estadoAjustesNegativos(null, soles).boton).toBe('Importar el Excel de ajustes');
    expect(estadoAjustesNegativos(0, soles).boton).toBe('Ver el Excel importado');
  });

  it('ningún texto en voseo: la pantalla va en español neutro (pedido del cliente)', () => {
    for (const e of [estadoAjustesNegativos(null, soles), estadoAjustesNegativos(10, soles)]) {
      expect(`${e.texto} ${e.boton}`).not.toMatch(/(cargá|importá|tenés|podés|elegí|revisá|acá)/);
    }
  });
});

describe('notaFaltanteEmpresa: el faltante de empresa se muestra, no se tipea', () => {
  it('antes de liquidar: lo calcula la clasificación y el definitivo queda fijo al liquidar', () => {
    expect(notaFaltanteEmpresa(true)).toMatch(/clasificación de productos/);
    expect(notaFaltanteEmpresa(true)).toMatch(/queda fijo al liquidar/);
  });

  it('ya liquidado: es el que calculó la clasificación al liquidar', () => {
    expect(notaFaltanteEmpresa(false)).toMatch(/clasificación de productos/);
    expect(notaFaltanteEmpresa(false)).toMatch(/calculó/);
  });
});
