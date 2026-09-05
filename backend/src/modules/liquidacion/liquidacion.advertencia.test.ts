import { describe, expect, it } from 'vitest';
import { armarAdvertencia } from './liquidacion.service';

/**
 * La advertencia que ve QUIEN FIRMA el descuento a la nómina de otra persona.
 *
 * Un ítem con diferencia y sin precio de venta suma 0 al faltante: no rompe
 * el cálculo y no inventa un precio, pero deja el monto subestimado. Estos
 * tests cubren que eso llegue como texto legible y no como un campo más que
 * nadie mira.
 */
describe('armarAdvertencia', () => {
  it('sin ítems sin precio no advierte nada', () => {
    // `mensaje: null` y no un string vacío: la pantalla decide mostrar el
    // bloque o no con una sola comparación, sin adivinar.
    expect(armarAdvertencia(0)).toEqual({ itemsSinPrecio: 0, mensaje: null });
  });

  it('con ítems sin precio dice CUÁNTOS y QUÉ significa', () => {
    const a = armarAdvertencia(6);
    expect(a.itemsSinPrecio).toBe(6);
    expect(a.mensaje).toContain('6 ítems');
    expect(a.mensaje).toContain('subestimado');
  });

  it('el mensaje nombra el origen del problema: Dynamics', () => {
    // Quien lo lea tiene que saber DÓNDE se arregla, no solo que hay algo mal.
    expect(armarAdvertencia(3).mensaje).toContain('Dynamics');
  });

  it('concuerda en singular con un solo ítem', () => {
    const a = armarAdvertencia(1);
    expect(a.mensaje).toContain('1 ítem ');
    expect(a.mensaje).toContain('no tiene precio');
    expect(a.mensaje).not.toContain('ítems');
  });

  it('usa plural con más de uno', () => {
    expect(armarAdvertencia(2).mensaje).toContain('2 ítems');
    expect(armarAdvertencia(2).mensaje).toContain('no tienen precio');
  });

  it('un negativo se trata como cero, no rompe ni muestra "-1 ítems"', () => {
    expect(armarAdvertencia(-1)).toEqual({ itemsSinPrecio: 0, mensaje: null });
  });

  it('el mensaje es una frase completa, lista para mostrar sin armar nada', () => {
    // La pantalla lo pinta tal cual: si acá viniera un fragmento, cada
    // pantalla tendría que rearmarlo y dirían cosas distintas.
    const mensaje = armarAdvertencia(6).mensaje ?? '';
    expect(mensaje.endsWith('.')).toBe(true);
    expect(mensaje.length).toBeGreaterThan(40);
  });
});
