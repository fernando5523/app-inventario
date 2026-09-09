import { describe, expect, it } from 'vitest';

import { formatearCaida } from './registro-caidas';

describe('formatearCaida', () => {
  it('arma una línea con timestamp ISO, tipo y detalle, y termina en salto de línea', () => {
    const ahora = new Date('2026-09-09T14:52:00.000Z');
    expect(formatearCaida('SALIDA', 'code=1', ahora)).toBe('2026-09-09T14:52:00.000Z [caida] SALIDA — code=1\n');
  });

  it('conserva un detalle multilínea (un stack) entero y termina en salto de línea', () => {
    const ahora = new Date('2026-09-09T00:00:00.000Z');
    const linea = formatearCaida('EXCEPCION_NO_CAPTURADA', 'Error: boom\n    at foo (x.ts:1:1)', ahora);
    expect(linea).toContain('EXCEPCION_NO_CAPTURADA — Error: boom\n    at foo (x.ts:1:1)');
    expect(linea.endsWith('\n')).toBe(true);
  });
});
