import { describe, expect, it } from 'vitest';
import { comparativoDeRonda, type ResumenParaMostrar } from './comparativo-ronda';

const num = (n: number) => new Intl.NumberFormat('es-PE').format(n);
const pct = (n: number) => n.toFixed(1);

const resumen = (p: Partial<ResumenParaMostrar> = {}): ResumenParaMostrar => ({
  total: 1236,
  cuadrados: 1100,
  aRecontar: 136,
  sinContar: 0,
  sinDatoErp: 0,
  ...p,
});

describe('comparativoDeRonda', () => {
  it('devuelve null cuando la ronda todavía NO EXISTE', () => {
    // Es el caso de los Pasos 2 y 3 mientras se cuenta el 1ero. El llamador
    // muestra "todavía no empezó" — que es la verdad, no una limitación.
    expect(comparativoDeRonda(null, num, pct)).toBeNull();
  });

  it('devuelve null si la ronda existe pero no entró ningún ítem', () => {
    expect(comparativoDeRonda(resumen({ total: 0, cuadrados: 0, aRecontar: 0 }), num, pct)).toBeNull();
  });

  it('arma el detalle con las cifras del embudo', () => {
    const c = comparativoDeRonda(resumen(), num, pct);
    expect(c?.detalle).toContain('cuadraron contra Dynamics');
    expect(c?.detalle).toContain('pasan al siguiente conteo');
  });

  it('NO nombra las cifras que están en cero', () => {
    // "0 sin contar" es ruido que compite con las cifras que sí importan.
    const c = comparativoDeRonda(resumen({ sinContar: 0, sinDatoErp: 0 }), num, pct);
    expect(c?.detalle).not.toContain('sin contar');
    expect(c?.detalle).not.toContain('sin stock');
  });

  it('sí las nombra cuando existen', () => {
    const c = comparativoDeRonda(resumen({ sinContar: 12, sinDatoErp: 4 }), num, pct);
    expect(c?.detalle).toContain('12 sin contar');
    expect(c?.detalle).toContain('4 sin stock en el ERP');
  });

  it('el porcentaje se calcula sobre los AUDITABLES, no sobre el total', () => {
    // 50 cuadrados de 100 items, 50 sin stock del ERP -> 50/50 = 100%, no 50%.
    // Un item que el ERP no reporta no puede cuadrar ni dejar de cuadrar:
    // meterlo en el denominador haría ver el ciclo peor de lo que está.
    const c = comparativoDeRonda(
      { total: 100, cuadrados: 50, aRecontar: 0, sinContar: 0, sinDatoErp: 50 },
      num,
      pct,
    );
    expect(c?.avance.pct).toBe(100);
    expect(c?.avance.texto).toContain('50 de 50');
  });

  it('no divide por cero cuando NINGÚN ítem tiene stock del ERP', () => {
    const c = comparativoDeRonda(
      { total: 10, cuadrados: 0, aRecontar: 0, sinContar: 0, sinDatoErp: 10 },
      num,
      pct,
    );
    expect(c?.avance.pct).toBe(0);
  });

  it('una ronda con todo cuadrado da 100%: el ciclo puede cerrarse', () => {
    const c = comparativoDeRonda(resumen({ cuadrados: 1236, aRecontar: 0 }), num, pct);
    expect(c?.avance.pct).toBe(100);
    expect(c?.detalle).not.toContain('pasan al siguiente');
  });

  it('una ronda recién abierta, sin contar nada, no dice que cuadró algo', () => {
    const c = comparativoDeRonda({ total: 136, cuadrados: 0, aRecontar: 136, sinContar: 136, sinDatoErp: 0 }, num, pct);
    expect(c?.avance.pct).toBe(0);
    expect(c?.detalle).toContain('136 sin contar');
  });
});
