import { describe, expect, it } from 'vitest';

import { sucursalEnFoco } from './sucursal-en-foco';

describe('sucursalEnFoco: qué sucursal opera una pantalla de inventario único', () => {
  it('coordinador: SIEMPRE la de su sesión, ignora cualquier elegida (sigue atado a su tienda)', () => {
    expect(sucursalEnFoco({ rol: 'coordinador', sucursalDeSesion: 2, elegida: 5 })).toBe(2);
    expect(sucursalEnFoco({ rol: 'coordinador', sucursalDeSesion: 2, elegida: null })).toBe(2);
  });

  it('conteo: igual que el coordinador, la de su sesión', () => {
    expect(sucursalEnFoco({ rol: 'conteo', sucursalDeSesion: 3, elegida: 9 })).toBe(3);
  });

  it('auditor: la que ELIGIÓ manda sobre la de su ficha', () => {
    expect(sucursalEnFoco({ rol: 'auditor', sucursalDeSesion: 31, elegida: 5 })).toBe(5);
  });

  it('auditor sin elegir todavía: arranca en la de su sesión (default inicial, cambiable)', () => {
    expect(sucursalEnFoco({ rol: 'auditor', sucursalDeSesion: 31, elegida: null })).toBe(31);
  });

  it('auditor sin sucursal en la ficha y sin elegir: null (no hay foco, la pantalla pide elegir)', () => {
    expect(sucursalEnFoco({ rol: 'auditor', sucursalDeSesion: null, elegida: null })).toBeNull();
  });

  it('LACRADO: el auditor con ficha Bolívar (31) elige Carhuaz (2) -> el foco es 2, no su ficha', () => {
    // Es la decisión que usa lacrado.tsx para saber qué inventario mostrar:
    // el de la tienda elegida en el contexto compartido, no el de la ficha.
    expect(sucursalEnFoco({ rol: 'auditor', sucursalDeSesion: 31, elegida: 2 })).toBe(2);
  });
});
