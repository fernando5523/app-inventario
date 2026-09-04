import { describe, expect, it } from 'vitest';
import { esVigente } from './d365-auth.service';
import type { D365Token } from './d365.types';

function tokenQueExpiraEn(minutos: number, ahora: Date): D365Token {
  return { accessToken: 'x', tokenType: 'Bearer', expiresAt: new Date(ahora.getTime() + minutos * 60 * 1000) };
}

describe('esVigente', () => {
  const ahora = new Date('2026-09-03T12:00:00Z');

  it('es vigente si vence en mas de 5 minutos', () => {
    expect(esVigente(tokenQueExpiraEn(10, ahora), ahora)).toBe(true);
  });

  it('NO es vigente si vence en menos de 5 minutos (margen de renovacion)', () => {
    expect(esVigente(tokenQueExpiraEn(3, ahora), ahora)).toBe(false);
  });

  it('NO es vigente si ya vencio', () => {
    expect(esVigente(tokenQueExpiraEn(-1, ahora), ahora)).toBe(false);
  });

  it('el limite exacto de 5 minutos NO cuenta como vigente (borde estricto)', () => {
    expect(esVigente(tokenQueExpiraEn(5, ahora), ahora)).toBe(false);
  });
});
