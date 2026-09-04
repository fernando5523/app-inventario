/**
 * La máquina de estados del anti-duplicados, probada sin cámara.
 *
 * Pedido explícito del cliente tras probar en teléfono real: "veo que
 * captura varias veces el código y muchas veces lo hace bien mal en un
 * segundo". El umbral se subió de 2 a 3 lecturas consecutivas (ver
 * ModalEscaner.tsx#LECTURAS_PARA_CONFIRMAR) y esta suite fija el
 * comportamiento que tiene que sobrevivir a cualquier ajuste futuro de ese
 * número: lecturas CONSECUTIVAS del mismo código, cualquier código
 * distinto — o cualquier lectura fuera del recuadro — reinicia a cero.
 */

import { describe, expect, it } from 'vitest';

import { ConfirmadorDeLecturas } from './escaner-confirmacion';

const UMBRAL = 3;
const MS_ANTIRREBOTE = 1500;

function crear(): ConfirmadorDeLecturas {
  return new ConfirmadorDeLecturas(UMBRAL, MS_ANTIRREBOTE);
}

describe('ConfirmadorDeLecturas', () => {
  it('acepta recién en la lectura número `umbral`, nunca antes', () => {
    const c = crear();
    expect(c.procesar('A', 0)).toBe(false);
    expect(c.procesar('A', 10)).toBe(false);
    expect(c.procesar('A', 20)).toBe(true);
  });

  it('A,B,A NO acepta A: el B intermedio reinicia el contador', () => {
    // El caso de góndola: la cámara alterna entre el código correcto y el
    // del vecino. Si esto se vuelve true, volvió el bug que el cliente
    // reportó en su teléfono.
    const c = crear();
    expect(c.procesar('A', 0)).toBe(false); // A: vistas=1
    expect(c.procesar('B', 10)).toBe(false); // B: vistas=1 (A se pierde)
    expect(c.procesar('A', 20)).toBe(false); // A: vistas=1 de nuevo, NO 2
    expect(c.procesar('A', 30)).toBe(false); // A: vistas=2
    expect(c.procesar('A', 40)).toBe(true); // A: vistas=3 -> recién ahora
  });

  it('una racha larga de códigos distintos nunca acumula: siempre vuelve a 1', () => {
    const c = crear();
    const secuencia = ['A', 'B', 'A', 'C', 'A', 'B', 'A'];
    for (const [i, codigo] of secuencia.entries()) {
      expect(c.procesar(codigo, i * 10)).toBe(false);
    }
  });

  it('el antirrebote no entrega el mismo código dos veces dentro de la ventana', () => {
    const c = crear();
    c.procesar('A', 0);
    c.procesar('A', 10);
    expect(c.procesar('A', 20)).toBe(true); // aceptado en t=20

    // Mismo código, todavía dentro de MS_ANTIRREBOTE desde t=20.
    expect(c.procesar('A', 20 + MS_ANTIRREBOTE - 1)).toBe(false);
  });

  it('pasado el antirrebote, el mismo código se puede volver a aceptar', () => {
    const c = crear();
    c.procesar('A', 0);
    c.procesar('A', 10);
    expect(c.procesar('A', 20)).toBe(true);

    const fueraDeVentana = 20 + MS_ANTIRREBOTE;
    expect(c.procesar('A', fueraDeVentana)).toBe(false);
    expect(c.procesar('A', fueraDeVentana + 10)).toBe(false);
    expect(c.procesar('A', fueraDeVentana + 20)).toBe(true);
  });

  it('descartar() (lectura fuera del recuadro) rompe la racha: no cuenta para el contador', () => {
    const c = crear();
    expect(c.procesar('A', 0)).toBe(false); // vistas=1
    expect(c.procesar('A', 10)).toBe(false); // vistas=2
    c.descartar(); // el código salió del recuadro (o frame sin geometría)
    // Si "A" volviera a entrar, tiene que arrancar de 1 otra vez, no de 3.
    expect(c.procesar('A', 20)).toBe(false); // vistas=1
    expect(c.procesar('A', 30)).toBe(false); // vistas=2
    expect(c.procesar('A', 40)).toBe(true); // vistas=3 -> recién acá
  });

  it('reiniciar() borra candidato Y antirrebote — como al reabrir el modal', () => {
    const c = crear();
    c.procesar('A', 0);
    c.procesar('A', 10);
    expect(c.procesar('A', 20)).toBe(true); // aceptado, antirrebote armado

    c.reiniciar();

    // Sin reiniciar, esto seguiría bloqueado por el antirrebote (t=21 está
    // dentro de la ventana de 1500ms desde t=20).
    expect(c.procesar('A', 21)).toBe(false);
    expect(c.procesar('A', 22)).toBe(false);
    expect(c.procesar('A', 23)).toBe(true);
  });
});
