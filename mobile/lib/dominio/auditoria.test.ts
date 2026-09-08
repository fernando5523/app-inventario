import { describe, expect, it } from 'vitest';

import {
  conteoFinal,
  diferenciaUnidades,
  resumirAuditoria,
  rondasNecesarias,
  veredicto,
} from './auditoria';
import type { ItemAuditoria } from './tipos';

let sig = 0;
/** Un ItemAuditoria mínimo; por defecto con ERP y SIN ningún conteo. */
function item(over: Partial<ItemAuditoria> = {}): ItemAuditoria {
  sig += 1;
  return {
    productoId: sig,
    codigo: `C${sig}`,
    descripcion: `Producto ${sig}`,
    zona: 'A',
    precioVenta: 2,
    stockErp: 10,
    conteo1: null,
    conteo2: null,
    conteo3: null,
    esEmpresa: false,
    ...over,
  };
}

describe('veredicto — "no sé" no es "cero"', () => {
  it('sin ningún conteo NO es cuadrado: es sin_contar (el bug del cliente)', () => {
    // Un ítem del catálogo con stock del ERP pero que nadie contó todavía.
    expect(veredicto(item({ stockErp: 10 }))).toBe('sin_contar');
  });

  it('sin stock del ERP es sin_erp, aunque esté contado', () => {
    expect(veredicto(item({ stockErp: null, conteo1: 5 }))).toBe('sin_erp');
  });

  it('sin_erp gana a sin_contar cuando faltan los dos lados', () => {
    expect(veredicto(item({ stockErp: null }))).toBe('sin_erp');
  });

  it('cuadrado solo cuando el conteo final coincide de verdad con el ERP', () => {
    expect(veredicto(item({ stockErp: 10, conteo1: 10 }))).toBe('cuadrado');
    expect(veredicto(item({ stockErp: 10, conteo1: 10, conteo2: 9, conteo3: 10 }))).toBe('cuadrado');
  });

  it('con diferencia: falta, o empresa si la asume gerencia', () => {
    expect(veredicto(item({ stockErp: 10, conteo3: 8 }))).toBe('falta');
    expect(veredicto(item({ stockErp: 10, conteo3: 13 }))).toBe('falta'); // sobrante también es "falta"
    expect(veredicto(item({ stockErp: 10, conteo3: 8, esEmpresa: true }))).toBe('empresa');
  });
});

describe('diferenciaUnidades — null cuando falta un lado, nunca 0', () => {
  it('sin conteo devuelve null (no 0)', () => {
    expect(diferenciaUnidades(item({ stockErp: 10 }))).toBeNull();
  });
  it('sin ERP devuelve null', () => {
    expect(diferenciaUnidades(item({ stockErp: null, conteo1: 5 }))).toBeNull();
  });
  it('con ambos lados, es conteoFinal - stockErp', () => {
    expect(diferenciaUnidades(item({ stockErp: 10, conteo3: 7 }))).toBe(-3);
    expect(diferenciaUnidades(item({ stockErp: 10, conteo3: 13 }))).toBe(3);
  });
});

describe('rondasNecesarias — la ronda REAL, nunca un default a la 3ra', () => {
  it('sin contar es 0, no 3', () => {
    expect(rondasNecesarias(item())).toBe(0);
  });
  it('la última ronda con conteo', () => {
    expect(rondasNecesarias(item({ conteo1: 10 }))).toBe(1);
    expect(rondasNecesarias(item({ conteo1: 9, conteo2: 10 }))).toBe(2);
    expect(rondasNecesarias(item({ conteo1: 9, conteo2: 9, conteo3: 10 }))).toBe(3);
  });
  it('conteoFinal acompaña a rondasNecesarias', () => {
    expect(conteoFinal(item({ conteo1: 9, conteo2: 10 }))).toBe(10);
    expect(conteoFinal(item())).toBeNull();
  });
});

describe('resumirAuditoria — resumen honesto', () => {
  it('EL CASO DEL CLIENTE: 10 ítems de catálogo, CERO conteos -> ningún cuadrado', () => {
    const items = Array.from({ length: 10 }, () => item({ stockErp: 5 }));
    const r = resumirAuditoria(items);

    expect(r.total).toBe(10);
    expect(r.contados).toBe(0);
    expect(r.sinContar).toBe(10); // los 10 sin contar
    expect(r.sinDatoErp).toBe(0);
    expect(r.auditables).toBe(0); // nada auditable todavía
    expect(r.cuadrados).toBe(0); // NADIE cuadró — el vacío ya no se lee como éxito
    expect(r.conDiferencia).toBe(0);
    expect(r.faltanteNeto).toBe(0);
    expect(r.sobranteNeto).toBe(0);
    // Y ni un solo ítem con veredicto 'cuadrado'.
    expect([...r.veredictoPorId.values()].every((v) => v === 'sin_contar')).toBe(true);
  });

  it('MIXTO: algunos contados y otros no -> cada cifra cuenta lo suyo', () => {
    const items = [
      item({ productoId: 1, stockErp: 10, conteo3: 10 }), // cuadrado
      item({ productoId: 2, stockErp: 10, conteo3: 7 }), //  falta (-3)
      item({ productoId: 3, stockErp: 10, conteo3: 13 }), // sobrante (+3)
      item({ productoId: 4, stockErp: 10, conteo3: 6, esEmpresa: true }), // empresa (-4)
      item({ productoId: 5, stockErp: 10 }), //               sin_contar
      item({ productoId: 6, stockErp: null, conteo3: 5 }), //  sin_erp (pero contado)
      item({ productoId: 7, stockErp: 10, conteo3: 10, precioVenta: 3 }), // cuadrado
    ];
    const r = resumirAuditoria(items);

    expect(r.total).toBe(7);
    expect(r.contados).toBe(6); // todos menos el #5
    expect(r.sinContar).toBe(1); // #5
    expect(r.sinDatoErp).toBe(1); // #6
    expect(r.auditables).toBe(5); // #1,2,3,4,7
    expect(r.cuadrados).toBe(2); // #1, #7
    expect(r.conFalta).toBe(2); // #2, #3
    expect(r.deEmpresa).toBe(1); // #4
    expect(r.conDiferencia).toBe(3); // #2,3,4
    expect(r.faltanteNeto).toBe(-6); // #2: -3 * 2
    expect(r.sobranteNeto).toBe(6); // #3: +3 * 2
    expect(r.asumidoEmpresa).toBe(-8); // #4: -4 * 2
    expect(r.sinPrecio).toBe(0);
  });

  it('cuenta sinPrecio cuando una diferencia real no se puede valorizar', () => {
    const r = resumirAuditoria([item({ stockErp: 10, conteo3: 7, precioVenta: null })]);
    expect(r.conFalta).toBe(1);
    expect(r.sinPrecio).toBe(1);
    expect(r.faltanteNeto).toBe(0); // no se pudo valorizar: no se inventa un monto
  });
});
