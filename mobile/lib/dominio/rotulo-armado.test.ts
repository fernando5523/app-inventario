/**
 * BUG B (caso end-to-end): el rótulo "hecho" del paso 2 "Crear hojas" mostraba
 * durante las rondas 2 y 3 las cifras de la RONDA 1 -- "1 hojas creadas de 10
 * ítems (10 ítems en total)" -- cuando la hoja nueva del reconteo tenía 3 ítems
 * primero y 1 después. Dos números prestados de otra ronda (el total del
 * snapshot y el tamaño NOMINAL del lote). Un número sin apellido fue la familia
 * de bugs que más costó: acá se cuenta lo REAL y se nombra la ronda.
 */
import { describe, expect, it } from 'vitest';

import { formatoMiles } from '../../components/ui/formato';
import { rotuloHojasCreadas } from './rotulo-armado';
import type { HojaConteo, Producto } from './tipos';

/** Una hoja con `cantidad` productos reales -- lo único que mira el rótulo. */
function hoja(cantidad: number): Pick<HojaConteo, 'productos'> {
  return { productos: Array.from({ length: cantidad }, () => ({}) as Producto) };
}

describe('rotuloHojasCreadas: cuenta lo REAL de la ronda y le pone apellido', () => {
  it('ronda 2: la hoja nueva del reconteo tiene 3 ítems, no los 10 de la ronda 1', () => {
    expect(rotuloHojasCreadas([hoja(3)], 2, formatoMiles)).toBe('Ronda 2: 1 hoja creada · 3 ítems en total.');
  });

  it('ronda 3: 1 solo ítem -- singular, y nombra la ronda', () => {
    expect(rotuloHojasCreadas([hoja(1)], 3, formatoMiles)).toBe('Ronda 3: 1 hoja creada · 1 ítem en total.');
  });

  it('ronda 1: varias hojas, total real con separador de miles', () => {
    const hojas = Array.from({ length: 160 }, () => hoja(50));
    expect(rotuloHojasCreadas(hojas, 1, formatoMiles)).toBe('Ronda 1: 160 hojas creadas · 8.000 ítems en total.');
  });

  it('cuenta los PRODUCTOS reales, nunca el tamaño nominal del lote', () => {
    // Dos hojas con 3 y 1 productos reales -> 4, aunque el lote nominal fuera 50.
    expect(rotuloHojasCreadas([hoja(3), hoja(1)], 2, formatoMiles)).toBe('Ronda 2: 2 hojas creadas · 4 ítems en total.');
  });
});
