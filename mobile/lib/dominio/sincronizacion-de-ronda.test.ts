import { describe, expect, it } from 'vitest';

import {
  sincronizacionConfirmada,
  sincronizacionDeRonda,
  type DatosDeSincronizacion,
} from './sincronizacion-de-ronda';

const miles = (n: number): string => String(n);
const fechaHora = (iso: string): string => iso;

function datos(parcial: Partial<DatosDeSincronizacion> = {}): DatosDeSincronizacion {
  return { ronda: 1, inventarioId: 8078, items: 985, tomadoEn: '2026-09-22T08:00:00Z', ...parcial };
}

const estado = (d: DatosDeSincronizacion) => sincronizacionDeRonda(d, miles, fechaHora);

describe('la ronda 1 sincroniza el catálogo entero', () => {
  it('con el inventario creado, el paso está hecho', () => {
    const r = estado(datos());
    expect(r.hecho).toBe(true);
    expect(r.alcance).toBe('catalogo');
    expect(r.titulo).toBe('Catálogo de Dynamics');
    expect(r.texto).toContain('985');
  });

  it('sin inventario todavía, el paso está pendiente y el texto dice qué trae', () => {
    const r = estado(datos({ inventarioId: null, items: null, tomadoEn: null }));
    expect(r.hecho).toBe(false);
    expect(r.texto).toContain('primer conteo');
  });

  /**
   * SIN RED hay inventario local pero todavía no llegaron `items`/`tomadoEn`.
   * El paso sigue HECHO -- el botón tiene que mandar a crear hojas, no a traer
   * el catálogo de nuevo -- pero NO confirmado: no se pinta el check verde sin
   * poder decir con qué datos.
   */
  it('con inventario local y sin los datos del snapshot: hecho pero sin confirmar', () => {
    const d = datos({ items: null, tomadoEn: null });
    const r = estado(d);
    expect(r.hecho).toBe(true);
    expect(sincronizacionConfirmada(r, d)).toBe(false);
  });

  it('sin ronda todavía se trata como la ronda 1', () => {
    expect(estado(datos({ ronda: null })).alcance).toBe('catalogo');
  });
});

describe('un reconteo sincroniza solo lo que arrastra', () => {
  /**
   * EL CAMBIO que motivó este archivo: antes el paso 1 quedaba hecho para
   * siempre en cuanto existía el inventario, y un reconteo se armaba contra el
   * stock del primer conteo sin que nadie se enterara.
   */
  it('con el inventario creado pero sin stock propio, el paso VUELVE a estar pendiente', () => {
    const r = estado(datos({ ronda: 2, items: null, tomadoEn: null }));
    expect(r.hecho).toBe(false);
    expect(r.alcance).toBe('arrastre');
    expect(r.titulo).toContain('ronda 2');
    expect(r.texto).toContain('faltantes y sobrantes');
  });

  it('con su stock bajado, el paso está hecho y dice contra qué se compara', () => {
    const d = datos({ ronda: 2, items: 6, tomadoEn: '2026-09-23T08:00:00Z' });
    const r = estado(d);
    expect(r.hecho).toBe(true);
    expect(sincronizacionConfirmada(r, d)).toBe(true);
    expect(r.texto).toContain('no contra el del primer conteo');
  });

  /**
   * CERO ÍTEMS ARRASTRADOS NO ES "no sincronizó". Con `null` en `tomadoEn`
   * como única señal, una ronda que arrastró cero productos y sincronizó igual
   * dejaría la pantalla trabada pidiendo una descarga que ya ocurrió.
   */
  it('una ronda que arrastró cero ítems y sincronizó igual cuenta como hecha', () => {
    const d = datos({ ronda: 3, items: 0, tomadoEn: '2026-09-24T08:00:00Z' });
    const r = estado(d);
    expect(r.hecho).toBe(true);
    expect(sincronizacionConfirmada(r, d)).toBe(true);
    expect(r.texto).toContain('0 ítems');
  });

  it('el título nombra la ronda que se está armando', () => {
    expect(estado(datos({ ronda: 4, items: null, tomadoEn: null })).titulo).toContain('ronda 4');
  });

  /** Un solo ítem no dice "1 ítems". */
  it('concuerda el plural con la cantidad', () => {
    expect(estado(datos({ ronda: 2, items: 1, tomadoEn: '2026-09-23T08:00:00Z' })).texto).toContain('1 ítem con');
  });
});
