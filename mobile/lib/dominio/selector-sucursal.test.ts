/**
 * Lógica pura del selector de sucursal del Auditor. El componente
 * (SelectorSucursal + SelectBuscable) trabaja con NOMBRES; estas funciones
 * ordenan la lista ascendente (regla de la skill trujillo-ui, sección Filtros)
 * y mapean nombre <-> id, para no reordenar ni buscar a mano en cada pantalla.
 */
import { describe, expect, it } from 'vitest';

import { idDeSucursal, nombreDeSucursal, nombresSucursalesOrdenados } from './selector-sucursal';
import type { Sucursal } from './tipos';

const suc = (id: number, nombre: string): Sucursal => ({ id, nombre, colaboradores: 0 });

// Iniciales distintas (B < C < H) a propósito: el orden sale igual en cualquier
// intercalado, sin depender de la colación ICU (que en Hermes puede faltar).
const SUCURSALES = [suc(1, 'Market Huaraz'), suc(2, 'Market Bolívar'), suc(3, 'Market Carhuaz')];

describe('nombresSucursalesOrdenados: ascendente, no el orden del endpoint', () => {
  it('ordena por nombre ascendente', () => {
    expect(nombresSucursalesOrdenados(SUCURSALES)).toEqual(['Market Bolívar', 'Market Carhuaz', 'Market Huaraz']);
  });

  it('lista vacía -> []', () => {
    expect(nombresSucursalesOrdenados([])).toEqual([]);
  });
});

describe('nombreDeSucursal: el nombre de la enfocada', () => {
  it('devuelve el nombre del id dado', () => {
    expect(nombreDeSucursal(SUCURSALES, 2)).toBe('Market Bolívar');
  });

  it('id null -> null (todavía no eligió)', () => {
    expect(nombreDeSucursal(SUCURSALES, null)).toBeNull();
  });

  it('id desconocido -> null', () => {
    expect(nombreDeSucursal(SUCURSALES, 99)).toBeNull();
  });
});

describe('idDeSucursal: del nombre elegido de vuelta al id', () => {
  it('devuelve el id del nombre exacto', () => {
    expect(idDeSucursal(SUCURSALES, 'Market Carhuaz')).toBe(3);
  });

  it('nombre desconocido -> null', () => {
    expect(idDeSucursal(SUCURSALES, 'Market Inexistente')).toBeNull();
  });
});
