import { describe, expect, it } from 'vitest';
import { armarAdvertencia } from './liquidacion.service';

/** Input sin nada que advertir. */
const SIN_NADA = { itemsSinPrecio: 0, asistenciaSinRegistrar: false, ajustesSinRegistrar: false };
/** El output esperado para ese mismo input. */
const SIN_NADA_QUE_ADVERTIR = { ...SIN_NADA, mensaje: null };

/**
 * La advertencia que ve QUIEN FIRMA el descuento a la nómina de otra persona.
 *
 * Un ítem con diferencia y sin precio de venta suma 0 al faltante: no rompe
 * el cálculo y no inventa un precio, pero deja el monto subestimado. Estos
 * tests cubren que eso llegue como texto legible y no como un campo más que
 * nadie mira.
 *
 * Mismo criterio para `asistenciaSinRegistrar`/`ajustesSinRegistrar`: un 0
 * en `ResultadoInventario.colaboradoresAsistieron`/`montoNegativos` puede
 * significar "no capturado" o "cero real" -- son cosas OPUESTAS (ver el
 * comentario de AdvertenciaLiquidacion), y quien firma tiene que poder
 * distinguirlas antes de firmar, no después.
 */
describe('armarAdvertencia', () => {
  it('sin nada que advertir no dice nada', () => {
    // `mensaje: null` y no un string vacío: la pantalla decide mostrar el
    // bloque o no con una sola comparación, sin adivinar.
    expect(armarAdvertencia(SIN_NADA)).toEqual(SIN_NADA_QUE_ADVERTIR);
  });

  it('con ítems sin precio dice CUÁNTOS y QUÉ significa', () => {
    const a = armarAdvertencia({ ...SIN_NADA, itemsSinPrecio: 6 });
    expect(a.itemsSinPrecio).toBe(6);
    expect(a.mensaje).toContain('6 ítems');
    expect(a.mensaje).toContain('subestimado');
  });

  it('el mensaje de precio nombra el origen del problema: Dynamics', () => {
    // Quien lo lea tiene que saber DÓNDE se arregla, no solo que hay algo mal.
    expect(armarAdvertencia({ ...SIN_NADA, itemsSinPrecio: 3 }).mensaje).toContain('Dynamics');
  });

  it('concuerda en singular con un solo ítem', () => {
    const a = armarAdvertencia({ ...SIN_NADA, itemsSinPrecio: 1 });
    expect(a.mensaje).toContain('1 ítem ');
    expect(a.mensaje).toContain('no tiene precio');
    expect(a.mensaje).not.toContain('ítems');
  });

  it('usa plural con más de uno', () => {
    const a = armarAdvertencia({ ...SIN_NADA, itemsSinPrecio: 2 });
    expect(a.mensaje).toContain('2 ítems');
    expect(a.mensaje).toContain('no tienen precio');
  });

  it('un negativo se trata como cero, no rompe ni muestra "-1 ítems"', () => {
    expect(armarAdvertencia({ ...SIN_NADA, itemsSinPrecio: -1 })).toEqual(SIN_NADA_QUE_ADVERTIR);
  });

  it('el mensaje de precio es una frase completa, lista para mostrar sin armar nada', () => {
    const mensaje = armarAdvertencia({ ...SIN_NADA, itemsSinPrecio: 6 }).mensaje ?? '';
    expect(mensaje.endsWith('.')).toBe(true);
    expect(mensaje.length).toBeGreaterThan(40);
  });

  /**
   * EL 0 QUE NO ES 0. `colaboradoresAsistieron: null` en la base significa
   * "no se registró", no "faltaron todos" ni "no faltó nadie" -- y la
   * planilla igual necesita un número para calcular, así que usa 0 como
   * placeholder. Esta advertencia es lo único que distingue ese placeholder
   * de un dato real para quien firma.
   */
  describe('asistencia sin registrar', () => {
    it('avisa que la multa y el bono no reflejan asistencia real', () => {
      const a = armarAdvertencia({ ...SIN_NADA, asistenciaSinRegistrar: true });
      expect(a.asistenciaSinRegistrar).toBe(true);
      expect(a.mensaje).toContain('asistencia');
      expect(a.mensaje).toContain('0 faltas');
    });

    it('sin el flag no aparece en el mensaje', () => {
      expect(armarAdvertencia(SIN_NADA).mensaje).toBeNull();
    });
  });

  /** Mismo criterio, para `ResultadoInventario.montoNegativos`. */
  describe('ajustes del mes sin registrar', () => {
    it('avisa que el faltante neto no los descuenta', () => {
      const a = armarAdvertencia({ ...SIN_NADA, ajustesSinRegistrar: true });
      expect(a.ajustesSinRegistrar).toBe(true);
      expect(a.mensaje).toContain('ajustes del mes');
    });
  });

  it('con varias razones a la vez, el mensaje las combina todas', () => {
    const a = armarAdvertencia({ itemsSinPrecio: 2, asistenciaSinRegistrar: true, ajustesSinRegistrar: true });
    expect(a.mensaje).toContain('2 ítems');
    expect(a.mensaje).toContain('asistencia');
    expect(a.mensaje).toContain('ajustes del mes');
  });
});
