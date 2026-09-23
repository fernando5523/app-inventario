import { describe, expect, it } from 'vitest';

import { puedeConsultarHistorial, inventarioDelCiclo, type ActivoParaCiclo, type HistoricoParaCiclo } from './inventario-del-ciclo';

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

/**
 * QUIÉN PUEDE PEDIR EL HISTÓRICO, y por qué la pantalla de Ciclo tiene que
 * preguntarlo antes de pedirlo.
 *
 * BUG REAL (2026-09-22, encontrado en el emulador): el Coordinador entraba a
 * Ciclo en una tienda sin inventario y leía *"Tu rol no tiene acceso a esta
 * acción"*. Era un 403 de verdad -- Ciclo cae al histórico cuando no hay
 * inventario en curso, y el histórico no es suyo. El mensaje es verdad sobre
 * el pedido y mentira sobre la pantalla, y lo mandaba a pedir permisos que
 * nadie le va a dar.
 *
 * Sin inventario en curso es el estado de CADA tienda al empezar el mes, así
 * que era lo primero que veía. Con inventario abierto la rama ni se ejecuta,
 * y por eso no había aparecido antes.
 */
describe('puedeConsultarHistorial', () => {
  it('el auditor y el administrador sí: ese camino les sirve y no se les saca', () => {
    expect(puedeConsultarHistorial('auditor')).toBe(true);
    expect(puedeConsultarHistorial('administrador')).toBe(true);
  });

  it('el coordinador NO: es la decisión del cliente, y no se cambia por este arreglo', () => {
    // El arreglo es dejar de PEDIRLO, no abrirle el histórico.
    expect(puedeConsultarHistorial('coordinador')).toBe(false);
  });

  it('el rol conteo tampoco', () => {
    expect(puedeConsultarHistorial('conteo')).toBe(false);
  });

  /**
   * Espeja `historial.permisos.ts#ROLES_CON_ACCESO_AL_HISTORICO` del backend.
   * Si allá se agrega un rol y acá no, la app vuelve a pedir un 403 -- o deja
   * de ofrecer algo que el servidor sí permite.
   */
  it('son exactamente dos roles: si el backend cambia, este test tiene que cambiar con él', () => {
    const conAcceso = (['administrador', 'coordinador', 'conteo', 'auditor'] as const).filter(puedeConsultarHistorial);
    expect(conAcceso).toEqual(['administrador', 'auditor']);
  });
});
