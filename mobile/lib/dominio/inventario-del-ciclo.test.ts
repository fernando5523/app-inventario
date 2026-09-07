import { describe, expect, it } from 'vitest';

import { inventarioDelCiclo, type ActivoParaCiclo, type HistoricoParaCiclo } from './inventario-del-ciclo';

const enCurso: ActivoParaCiclo = { inventarioId: 7, items: 1236, tamanoHoja: 50, rondaActiva: 2 };

/** Fila de historial mínima; por defecto un inventario ya cerrado. */
const historico = (over: Partial<HistoricoParaCiclo> = {}): HistoricoParaCiclo => ({
  id: 31,
  estado: 'conteo_cerrado',
  tamanoHoja: 50,
  snapshotItems: 22,
  ...over,
});

describe('inventarioDelCiclo', () => {
  it('con un inventario EN CURSO, ese es el del ciclo -- se conserva su rondaActiva', () => {
    // El historial no se mira siquiera: la ronda activa gobierna el cierre.
    expect(inventarioDelCiclo(enCurso, [historico()])).toEqual({
      inventarioId: 7,
      items: 1236,
      tamanoHoja: 50,
      rondaActiva: 2,
    });
  });

  it('EL CASO DEL CLIENTE: sin inventario en curso, el ciclo es el último CERRADO, rondaActiva null', () => {
    // activo() devuelve null para un conteo_cerrado -> antes la pantalla quedaba
    // en blanco. Ahora el ciclo es ese inventario 31, con su embudo real.
    expect(inventarioDelCiclo(null, [historico({ id: 31, snapshotItems: 22 })])).toEqual({
      inventarioId: 31,
      items: 22,
      tamanoHoja: 50,
      rondaActiva: null, // no hay ronda que cerrar, pero el embudo se muestra igual
    });
  });

  it('liquidado y lacrado también cuentan como ciclo terminado', () => {
    expect(inventarioDelCiclo(null, [historico({ estado: 'liquidado' })])?.inventarioId).toBe(31);
    expect(inventarioDelCiclo(null, [historico({ estado: 'lacrado' })])?.inventarioId).toBe(31);
  });

  it('saltea los que no terminaron de contar (anulado) y toma el primero cerrado', () => {
    const lista = [historico({ id: 40, estado: 'anulado' }), historico({ id: 31, estado: 'conteo_cerrado' })];
    expect(inventarioDelCiclo(null, lista)?.inventarioId).toBe(31);
  });

  it('sin activo y sin ningún inventario terminado, no hay ciclo que mostrar (null)', () => {
    expect(inventarioDelCiclo(null, [])).toBeNull();
    expect(inventarioDelCiclo(null, [historico({ estado: 'anulado' })])).toBeNull();
  });

  it('un tamaño de hoja fuera de la unión (o null) no se inventa: queda null', () => {
    expect(inventarioDelCiclo(null, [historico({ tamanoHoja: 40 })])?.tamanoHoja).toBeNull();
    expect(inventarioDelCiclo(null, [historico({ tamanoHoja: null })])?.tamanoHoja).toBeNull();
    expect(inventarioDelCiclo(null, [historico({ tamanoHoja: 30 })])?.tamanoHoja).toBe(30);
  });
});
