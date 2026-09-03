import { describe, expect, it } from 'vitest';
import { conteoFinal, diferenciaUnidades, diferenciaValor, veredicto } from './auditoria';
import type { ItemAuditoria } from './tipos';

function item(parciales: Partial<ItemAuditoria> = {}): ItemAuditoria {
  return {
    productoId: 1,
    codigo: '0182',
    descripcion: 'Producto de prueba',
    zona: 'Abarrotes',
    precioVenta: 3.2,
    stockErp: 80,
    conteo1: null,
    conteo2: null,
    conteo3: null,
    esEmpresa: false,
    ...parciales,
  };
}

describe('conteoFinal', () => {
  it('toma conteo3 cuando existe', () => {
    expect(conteoFinal(item({ conteo1: 74, conteo2: 80, conteo3: 91 }))).toBe(91);
  });

  it('cuadró en el 2do conteo: no hay 3ro, toma conteo2 (caso Fideos de la maqueta)', () => {
    expect(conteoFinal(item({ conteo1: 74, conteo2: 80, conteo3: null }))).toBe(80);
  });

  it('cuadró en el 1er conteo: no hay ni 2do ni 3ro', () => {
    expect(conteoFinal(item({ conteo1: 80, conteo2: null, conteo3: null }))).toBe(80);
  });

  it('sin ningún conteo todavía, devuelve null', () => {
    expect(conteoFinal(item())).toBeNull();
  });
});

describe('diferenciaUnidades', () => {
  it('caso Leche de la maqueta: erp 96, final 91 -> -5', () => {
    expect(diferenciaUnidades(item({ stockErp: 96, conteo1: 88, conteo2: 90, conteo3: 91 }))).toBe(-5);
  });

  it('caso Cerveza de la maqueta: erp 54, final 47 -> -7', () => {
    expect(diferenciaUnidades(item({ stockErp: 54, conteo1: 45, conteo2: 46, conteo3: 47, esEmpresa: true }))).toBe(-7);
  });

  it('caso Fideos de la maqueta: erp 80, final 80 -> 0 (cuadrado)', () => {
    expect(diferenciaUnidades(item({ stockErp: 80, conteo1: 74, conteo2: 80, conteo3: null }))).toBe(0);
  });

  it('sin ningún conteo, la diferencia es 0 (no hay nada que comparar todavía)', () => {
    expect(diferenciaUnidades(item({ stockErp: 80 }))).toBe(0);
  });

  it('sobrante: el conteo final puede superar al ERP', () => {
    expect(diferenciaUnidades(item({ stockErp: 50, conteo1: 53 }))).toBe(3);
  });
});

describe('diferenciaValor', () => {
  it('caso Leche de la maqueta: -5 unid × S/4.80 = -S/24.00', () => {
    expect(diferenciaValor(item({ stockErp: 96, conteo1: 88, conteo2: 90, conteo3: 91, precioVenta: 4.8 }))).toBeCloseTo(-24);
  });

  it('caso Cerveza de la maqueta: -7 unid × S/5.20 = -S/36.40', () => {
    expect(
      diferenciaValor(item({ stockErp: 54, conteo1: 45, conteo2: 46, conteo3: 47, precioVenta: 5.2, esEmpresa: true })),
    ).toBeCloseTo(-36.4);
  });

  it('cuadrado: la diferencia en valor es 0, no importa el precio', () => {
    expect(diferenciaValor(item({ stockErp: 80, conteo1: 74, conteo2: 80, precioVenta: 99 }))).toBe(0);
  });
});

describe('veredicto', () => {
  it('cuadrado cuando el conteo final coincide con el ERP', () => {
    expect(veredicto(item({ stockErp: 80, conteo1: 74, conteo2: 80 }))).toBe('cuadrado');
  });

  it('falta cuando no coincide y no es una categoría de empresa', () => {
    expect(veredicto(item({ stockErp: 96, conteo1: 88, conteo2: 90, conteo3: 91, esEmpresa: false }))).toBe('falta');
  });

  it('empresa cuando no coincide pero la categoría la asume la empresa (ej. cervezas)', () => {
    expect(veredicto(item({ stockErp: 54, conteo1: 45, conteo2: 46, conteo3: 47, esEmpresa: true }))).toBe('empresa');
  });

  it('un sobrante (diferencia positiva) que no es de empresa también cae en falta: la maqueta no separa un cuarto filtro', () => {
    expect(veredicto(item({ stockErp: 50, conteo1: 53, esEmpresa: false }))).toBe('falta');
  });
});
