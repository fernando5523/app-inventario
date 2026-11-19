import { describe, expect, it } from 'vitest';
import { textoPlanillaCerrada } from './planilla-cerrada';

const fecha = (iso: string) => `F(${iso})`;
const soles = (n: number) => `S/ ${n.toFixed(2)}`;
const planilla = [{ monto: -0.75 }, { monto: -0.75 }] as never;

describe('textoPlanillaCerrada (2026-11-19)', () => {
  it('dice cuándo y quién liquidó según el servidor, no el reloj ni la sesión', () => {
    const t = textoPlanillaCerrada(
      { liquidadoEn: '2026-11-19T20:57:00.000Z', liquidadoPor: 'Auditor Raymondi', lacrado: false, planilla },
      fecha,
      soles,
    );
    expect(t.resumen).toBe(
      'Liquidado el F(2026-11-19T20:57:00.000Z) por Auditor Raymondi. Los descuentos de 2 colaboradores quedaron firmes por S/ -1.50 en total.',
    );
    expect(t.boton).toBe('Ir a aprobación y lacrado');
  });

  it('lacrado: no dice que el paso que sigue es el lacrado', () => {
    const t = textoPlanillaCerrada({ liquidadoEn: null, liquidadoPor: null, lacrado: true, planilla }, fecha, soles);
    expect(t.resumen.startsWith('Planilla liquidada.')).toBe(true);
    expect(t.siguiente).toContain('ya está lacrado');
    expect(t.boton).toBe('Ver el lacrado');
  });
});
