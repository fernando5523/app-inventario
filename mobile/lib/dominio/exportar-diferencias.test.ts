import { describe, expect, it } from 'vitest';
import { nombreArchivoDiferencias } from './exportar-diferencias';

describe('nombreArchivoDiferencias: identifica tienda + período + inventario, sin espacios ni acentos', () => {
  it('caso normal', () => {
    expect(nombreArchivoDiferencias('Market Bolívar', 2026, 9, 30)).toBe('diferencias-market-bolivar-2026-09-inv30.xlsx');
  });

  it('mes de un dígito queda con cero adelante', () => {
    expect(nombreArchivoDiferencias('Market Carhuaz', 2026, 3, 12)).toBe('diferencias-market-carhuaz-2026-03-inv12.xlsx');
  });

  it('sin tildes ni eñes en el resultado, aunque el nombre las tenga', () => {
    const nombre = nombreArchivoDiferencias('Cañón Ñuñoa Álamos', 2026, 12, 1);
    expect(nombre).not.toMatch(/[áéíóúñÁÉÍÓÚÑ]/);
  });

  it('sin espacios en el resultado', () => {
    expect(nombreArchivoDiferencias('Market Bolívar', 2026, 9, 30)).not.toContain(' ');
  });

  it('sucursal vacía o solo símbolos no deja un nombre roto', () => {
    expect(nombreArchivoDiferencias('---', 2026, 9, 30)).toBe('diferencias-sucursal-2026-09-inv30.xlsx');
  });
});
