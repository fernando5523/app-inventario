/**
 * Lo que ve el Coordinador durante los 90 segundos que tarda el catálogo.
 *
 * El bug que originó esto: "0 ítems traídos…" inmóvil todo ese tiempo, al
 * lado del cartel "puede tardar varios minutos, no te vayas de la pantalla".
 * Se lee como "se colgó" y se cancela un snapshot que estaba andando bien.
 */

import { describe, expect, it } from 'vitest';
import { avanceParaMostrar } from './avance-snapshot';

/**
 * Formateador determinista, NO `toLocaleString`: Node sin ICU completo
 * ignora el locale y devuelve "8,000" en vez de "8.000". El separador no es
 * lo que se prueba acá, así que se fija a mano en vez de atar el test a cómo
 * esté compilado el runtime.
 */
const miles = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

describe('avanceParaMostrar', () => {
  it('sin ningún reporte todavía: conectando, y sin barra', () => {
    const r = avanceParaMostrar(null, miles);
    expect(r.texto).toMatch(/conectando/i);
    expect(r.porcentaje).toBeUndefined();
  });

  it('con total conocido dice CUÁNTOS de CUÁNTOS', () => {
    const r = avanceParaMostrar({ traidos: 3200, total: 8000 }, miles);
    expect(r.texto).toContain('3.200');
    expect(r.texto).toContain('8.000');
    expect(r.porcentaje).toBe(40);
  });

  /**
   * EL CASO QUE MOTIVÓ SACAR EL 4%: sin total no hay denominador, y
   * cualquier ancho de barra es inventado. El número que sube ya dice que
   * está vivo.
   */
  it('sin total NO dibuja barra, y el texto dice que está trayendo', () => {
    const r = avanceParaMostrar({ traidos: 1200, total: null }, miles);
    expect(r.texto).toContain('1.200');
    expect(r.texto).toMatch(/trayendo/i);
    expect(r.porcentaje).toBeUndefined();
  });

  it('un total en 0 se trata como desconocido, no como división por cero', () => {
    const r = avanceParaMostrar({ traidos: 0, total: 0 }, miles);
    expect(r.porcentaje).toBeUndefined();
    expect(Number.isNaN(r.porcentaje ?? 0)).toBe(false);
  });

  it('arranca en 0% cuando todavía no llegó ninguna página, pero YA con barra', () => {
    // El backend avisa `(0, total)` apenas responde el $count, antes de la
    // primera página: desde ese momento hay denominador y la barra puede
    // dibujarse honestamente en cero.
    const r = avanceParaMostrar({ traidos: 0, total: 8000 }, miles);
    expect(r.porcentaje).toBe(0);
    expect(r.texto).toContain('8.000');
  });

  it('al terminar llega al 100%', () => {
    expect(avanceParaMostrar({ traidos: 8000, total: 8000 }, miles).porcentaje).toBe(100);
  });

  it('un traidos mayor que el total no se pasa del riel', () => {
    // El `$count` de Dynamics se calcula aparte de la página y puede quedar
    // desactualizado. El snapshot está bien; la barra no puede romperse.
    expect(avanceParaMostrar({ traidos: 8100, total: 8000 }, miles).porcentaje).toBe(100);
  });

  it('nunca devuelve un porcentaje negativo', () => {
    expect(avanceParaMostrar({ traidos: -5, total: 8000 }, miles).porcentaje).toBe(0);
  });

  it('NO existe un mínimo visible inventado: 0 traídos es 0%', () => {
    // La regla del cambio, explícita. Antes se dibujaba un 4% fijo para que
    // "no pareciera trabada" -- una barra que avanza sola sin que avance el
    // trabajo miente sobre lo único que hay que saber.
    expect(avanceParaMostrar({ traidos: 0, total: 8000 }, miles).porcentaje).not.toBe(4);
  });

  it('usa el formateador que le pasan, no uno propio', () => {
    const r = avanceParaMostrar({ traidos: 1000, total: 2000 }, () => 'XX');
    expect(r.texto).toBe('XX de XX ítems traídos');
  });
});
