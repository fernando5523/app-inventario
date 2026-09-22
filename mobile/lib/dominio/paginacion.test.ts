import { describe, expect, it } from 'vitest';

import { limiteParaRefrescar, MAXIMO_POR_PEDIDO } from './paginacion';

describe('cuántas filas pedir al refrescar una lista paginada', () => {
  it('una lista recién abierta pide una página, como siempre', () => {
    expect(limiteParaRefrescar(0, 40)).toBe(40);
  });

  /** EL CASO QUE ARREGLA: 120 cargadas no pueden volver a ser 40. */
  it('con varias páginas cargadas pide todas de nuevo, no la primera', () => {
    expect(limiteParaRefrescar(120, 40)).toBe(100);
    expect(limiteParaRefrescar(60, 20)).toBe(60);
  });

  it('nunca pide menos de una página', () => {
    expect(limiteParaRefrescar(3, 40)).toBe(40);
  });

  /** El backend rechaza con 400 lo que pase de 100 (verificado en los schemas). */
  it('nunca pide más de lo que el backend acepta', () => {
    expect(limiteParaRefrescar(5000, 40)).toBe(MAXIMO_POR_PEDIDO);
    expect(MAXIMO_POR_PEDIDO).toBe(100);
  });
});
