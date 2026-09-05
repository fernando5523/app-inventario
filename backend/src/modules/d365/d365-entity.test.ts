import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calcularPaginas, D365EntityService } from './d365-entity.service';
import { d365AuthService } from './d365-auth.service';

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

/**
 * El progreso por pagina: lo unico que permite mostrar avance real mientras
 * la bajada tarda minutos. Ver d365.progreso.ts para el bug que lo motivo.
 *
 * `contar` y `get` mockeados: no se levanta Dynamics para probar que el
 * callback se llama en el momento correcto.
 */
describe('obtenerTodos: progreso por pagina', () => {
  /** Un servicio con la red simulada: `total` registros en paginas de `lote`. */
  function servicioFalso(total: number, lote: number) {
    const servicio = new D365EntityService();
    vi.spyOn(servicio, 'contar').mockResolvedValue(total);
    vi.spyOn(d365AuthService, 'getODataBaseUrl').mockResolvedValue('https://x/data');
    let entregados = 0;
    vi.spyOn(servicio, 'get').mockImplementation(async () => {
      const enEstaPagina = Math.min(lote, total - entregados);
      entregados += enEstaPagina;
      return { value: Array.from({ length: enEstaPagina }, (_, i) => ({ id: i })) } as never;
    });
    return servicio;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('avisa el total ANTES de la primera pagina, con 0 traidos', async () => {
    // Sin esto, quien sondea ve `total: null` hasta que llega la primera
    // pagina -- que con lotes grandes puede tardar bastante. El total se sabe
    // apenas responde el $count: se dice enseguida.
    const avances: Array<[number, number]> = [];
    await servicioFalso(1000, 500).obtenerTodos('E', undefined, 500, (t, tot) => avances.push([t, tot]));

    expect(avances[0]).toEqual([0, 1000]);
  });

  it('avisa despues de cada pagina, acumulando', async () => {
    const avances: Array<[number, number]> = [];
    await servicioFalso(1000, 500).obtenerTodos('E', undefined, 500, (t, tot) => avances.push([t, tot]));

    expect(avances).toEqual([
      [0, 1000],
      [500, 1000],
      [1000, 1000],
    ]);
  });

  it('el ultimo aviso coincide con la cantidad realmente traida', async () => {
    // La invariante: si el ultimo avance dijera un numero distinto del que
    // devuelve la funcion, la barra terminaria en un punto que no es el final.
    const avances: number[] = [];
    const filas = await servicioFalso(950, 400).obtenerTodos('E', undefined, 400, (t) => avances.push(t));

    expect(avances[avances.length - 1]).toBe(filas.length);
    expect(filas).toHaveLength(950);
  });

  it('sin callback funciona igual: el progreso es opcional', async () => {
    const filas = await servicioFalso(300, 500).obtenerTodos('E');
    expect(filas).toHaveLength(300);
  });

  /**
   * El progreso es accesorio. Perder un snapshot de 8.000 items porque
   * reventó un contador seria cambiar algo que importa por algo que no.
   */
  it('si el callback revienta, la bajada NO se cae', async () => {
    const filas = await servicioFalso(1000, 500).obtenerTodos('E', undefined, 500, () => {
      throw new Error('el registro de progreso explotó');
    });

    expect(filas).toHaveLength(1000);
  });

  it('con total 0 no se llama al callback ni una vez', async () => {
    const avances: number[] = [];
    const filas = await servicioFalso(0, 500).obtenerTodos('E', undefined, 500, (t) => avances.push(t));

    expect(filas).toEqual([]);
    expect(avances).toEqual([]);
  });
});
