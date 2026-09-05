/**
 * `interpretarCantidad` es todo el contrato de validación del campo
 * numérico de ModalConteo: enteros >= 0, nada más. Fija acá lo que el
 * cliente pidió explícitamente (5 sep 2026) — rechazar letras, coma y
 * negativos, aceptar cero como valor legítimo.
 */

import { describe, expect, it } from 'vitest';

import { interpretarCantidad } from './cantidad-numerica';

describe('interpretarCantidad', () => {
  it('acepta enteros positivos', () => {
    expect(interpretarCantidad('5')).toEqual({ ok: true, valor: 5 });
    expect(interpretarCantidad('120')).toEqual({ ok: true, valor: 120 });
  });

  it('acepta cero como valor válido, no como error', () => {
    expect(interpretarCantidad('0')).toEqual({ ok: true, valor: 0 });
  });

  it('el campo vacío se interpreta como 0, no como error', () => {
    // Pasa mientras la persona borra todo para volver a tipear.
    expect(interpretarCantidad('')).toEqual({ ok: true, valor: 0 });
    expect(interpretarCantidad('   ')).toEqual({ ok: true, valor: 0 });
  });

  it('rechaza letras', () => {
    const r = interpretarCantidad('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(/entero/);
  });

  it('rechaza un número con letras mezcladas', () => {
    expect(interpretarCantidad('12a').ok).toBe(false);
  });

  it('rechaza coma decimal', () => {
    expect(interpretarCantidad('1,5').ok).toBe(false);
  });

  it('rechaza punto decimal', () => {
    expect(interpretarCantidad('1.5').ok).toBe(false);
  });

  it('rechaza negativos', () => {
    expect(interpretarCantidad('-5').ok).toBe(false);
  });

  it('rechaza un número demasiado grande para ser un conteo real', () => {
    expect(interpretarCantidad('99999999999999999999').ok).toBe(false);
  });

  it('ignora espacios alrededor de un número válido', () => {
    expect(interpretarCantidad('  7  ')).toEqual({ ok: true, valor: 7 });
  });
});
