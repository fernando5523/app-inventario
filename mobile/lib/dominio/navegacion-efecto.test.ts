/**
 * Lo que esta función evita es que alguien apague una tarjeta sin darse
 * cuenta de a quién deja sin ella. Los tests cubren el caso del brief --
 * "el Coordinador va a pasar de 4 accesos a 3, deja de ver Asistencia del
 * inventario" -- y los bordes donde un resumen mal hecho diría que no pasa
 * nada.
 */

import { describe, expect, it } from 'vitest';
import { calcularEfecto, mover, type ElementoConfigurable } from './navegacion-efecto';

const el = (clave: string, nombre: string, visible = true): ElementoConfigurable => ({ clave, nombre, visible });

const COORDINADOR: ElementoConfigurable[] = [
  el('/coordinador/asistencia', 'Asistencia del inventario'),
  el('/coordinador/hojas', 'Gestión de hojas'),
  el('/coordinador/ciclo', 'Ciclo de conteos'),
  el('/coordinador/mi-cuenta', 'Mi cuenta'),
];

describe('calcularEfecto: el caso del pedido', () => {
  it('apagar Asistencia: 4 pasan a 3, y DICE cuál deja de verse', () => {
    const despues = COORDINADOR.map((e) =>
      e.clave === '/coordinador/asistencia' ? { ...e, visible: false } : e,
    );
    const efecto = calcularEfecto(COORDINADOR, despues);

    expect(efecto.cambia).toBe(true);
    expect(efecto.visiblesAntes).toBe(4);
    expect(efecto.visiblesDespues).toBe(3);
    // El nombre, no la ruta: es lo que la persona ve en el teléfono.
    expect(efecto.seApagan).toEqual(['Asistencia del inventario']);
    expect(efecto.sePrenden).toEqual([]);
  });

  it('volver a prenderlo lo cuenta del otro lado', () => {
    const apagado = COORDINADOR.map((e) => (e.clave === '/coordinador/hojas' ? { ...e, visible: false } : e));
    const efecto = calcularEfecto(apagado, COORDINADOR);
    expect(efecto.sePrenden).toEqual(['Gestión de hojas']);
    expect(efecto.visiblesDespues).toBe(4);
  });
});

describe('calcularEfecto: sin cambios', () => {
  it('la misma lista no cambia nada: el botón de guardar tiene que quedar apagado', () => {
    expect(calcularEfecto(COORDINADOR, COORDINADOR).cambia).toBe(false);
  });

  it('mover un APAGADO no cambia nada de lo que alguien ve', () => {
    // Avisarlo sería ruido: nadie nota que un elemento invisible se movió.
    const conApagado = [...COORDINADOR.slice(0, 3), el('/coordinador/mi-cuenta', 'Mi cuenta', false)];
    const movido = [conApagado[3]!, ...conApagado.slice(0, 3)];
    expect(calcularEfecto(conApagado, movido).cambia).toBe(false);
  });
});

describe('calcularEfecto: el orden', () => {
  it('reordenar los prendidos SI es un cambio', () => {
    const movido = mover(COORDINADOR, 0, 3);
    const efecto = calcularEfecto(COORDINADOR, movido);
    expect(efecto.cambiaElOrden).toBe(true);
    expect(efecto.cambia).toBe(true);
    // Nadie deja de ver nada: es solo el orden.
    expect(efecto.seApagan).toEqual([]);
    expect(efecto.visiblesDespues).toBe(4);
  });
});

describe('calcularEfecto: el caso que hay que frenar', () => {
  it('apagar TODO avisa que queda vacío', () => {
    // Un rol sin un solo acceso es una persona que abre la app y no tiene por
    // dónde empezar. La pantalla lo usa para bloquear el guardado, no solo
    // para avisar.
    const todoApagado = COORDINADOR.map((e) => ({ ...e, visible: false }));
    const efecto = calcularEfecto(COORDINADOR, todoApagado);
    expect(efecto.quedaVacio).toBe(true);
    expect(efecto.visiblesDespues).toBe(0);
    expect(efecto.seApagan).toHaveLength(4);
  });

  it('con uno solo prendido NO queda vacío', () => {
    const casiTodo = COORDINADOR.map((e, i) => ({ ...e, visible: i === 0 }));
    expect(calcularEfecto(COORDINADOR, casiTodo).quedaVacio).toBe(false);
  });
});

describe('mover', () => {
  it('mueve un elemento y corre el resto', () => {
    expect(mover(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(mover(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('no muta la lista original', () => {
    const original = ['a', 'b', 'c'];
    mover(original, 0, 2);
    expect(original).toEqual(['a', 'b', 'c']);
  });

  it('fuera de rango devuelve una copia, no revienta', () => {
    // El primer elemento tiene una flecha "subir" y el último una "bajar";
    // si alguna se habilitara por error, esto es lo que impide el crash.
    expect(mover(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
    expect(mover(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(mover(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
