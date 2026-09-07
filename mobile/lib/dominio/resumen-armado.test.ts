import { describe, expect, it } from 'vitest';

import { textoResumenArmado } from './resumen-armado';

// Formateador trivial: lo que se prueba acá es el TEXTO, no el formato de
// miles -- ese ya tiene su propio test (ver formatoMiles).
const fmt = (n: number) => String(n);

describe('textoResumenArmado: la línea cuando el armado ya terminó (catálogo + hojas + reparto)', () => {
  it('plural en ítems y hojas', () => {
    expect(textoResumenArmado(1192, 24, fmt)).toBe('1192 ítems · 24 hojas · repartidas');
  });

  it('singular en ítems y hojas (caso límite, pero el texto no debe leerse mal)', () => {
    expect(textoResumenArmado(1, 1, fmt)).toBe('1 ítem · 1 hoja · repartidas');
  });

  it('usa el formateador inyectado, no Number#toString', () => {
    const miles = (n: number) => n.toLocaleString('es');
    expect(textoResumenArmado(1192, 24, miles)).toContain(miles(1192));
  });
});
