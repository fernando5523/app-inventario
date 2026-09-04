import { describe, expect, it } from 'vitest';
import { calcularPaginas } from './d365-entity.service';

describe('calcularPaginas', () => {
  it('un solo lote cuando el total entra en el tamano de lote', () => {
    expect(calcularPaginas(300, 500)).toEqual([{ skip: 0, top: 300 }]);
  });

  it('particiona exacto cuando el total es multiplo del lote', () => {
    expect(calcularPaginas(1000, 500)).toEqual([
      { skip: 0, top: 500 },
      { skip: 500, top: 500 },
    ]);
  });

  it('la ultima pagina queda parcial cuando no es multiplo exacto (8.000 items, como el pedido real)', () => {
    expect(calcularPaginas(8000, 3000)).toEqual([
      { skip: 0, top: 3000 },
      { skip: 3000, top: 3000 },
      { skip: 6000, top: 2000 },
    ]);
  });

  it('total 0 no genera paginas', () => {
    expect(calcularPaginas(0, 500)).toEqual([]);
  });

  it('la suma de los `top` de todas las paginas da el total exacto', () => {
    const paginas = calcularPaginas(8000, 777);
    const suma = paginas.reduce((acc, p) => acc + p.top, 0);
    expect(suma).toBe(8000);
  });
});
