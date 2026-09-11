/**
 * Lógica pura de la pantalla de Clasificación del Auditor:
 *   - el ESTADO de un producto: qué dice Dynamics y qué decidió el Auditor,
 *     y si esa decisión CAMBIA lo de Dynamics (la cerveza) o coincide;
 *   - el PAGINADO (¿hay más por traer del catálogo de ~11.800?);
 *   - aplicar/quitar la clasificación en la lista ya cargada, sin recargar todo.
 */
import { describe, expect, it } from 'vitest';

import type { Clasificacion, ProductoClasificable } from '../puertos/repositorios';
import {
  aplicarClasificacion,
  estadoClasificacion,
  hayMasPorCargar,
  soloConClasificacion,
  textoResponsableDynamics,
} from './clasificacion';

function producto(over: Partial<ProductoClasificable> = {}): ProductoClasificable {
  return {
    codigo: 'CERV-001',
    descripcion: 'Cerveza Pilsen 620ml',
    categoria: 'CERVEZAS',
    responsableDynamics: 'empleado',
    clasificacion: null,
    ...over,
  };
}

function clasif(over: Partial<Clasificacion> = {}): Clasificacion {
  return { codigo: 'CERV-001', esEmpresa: true, nota: null, clasificadoPorId: 103, clasificadoEn: '2026-09-11T12:00:00.000Z', ...over };
}

describe('estadoClasificacion: Dynamics vs Auditor, y si cambia la cuenta', () => {
  it('sin excepción del Auditor: sin-clasificar', () => {
    expect(estadoClasificacion(producto({ clasificacion: null }))).toEqual({ tipo: 'sin-clasificar' });
  });

  it('la cerveza: Dynamics dice empleado, el Auditor la marca empresa -> EXCEPCION (mueve la cuenta)', () => {
    const p = producto({ responsableDynamics: 'empleado', clasificacion: clasif({ esEmpresa: true }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'excepcion', esEmpresa: true });
  });

  it('el Auditor decide lo mismo que Dynamics: coincide (no cambia nada)', () => {
    const p = producto({ responsableDynamics: 'empresa', clasificacion: clasif({ esEmpresa: true }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'coincide', esEmpresa: true });
  });

  it('Dynamics sin dato (null): cualquier decisión del Auditor es excepción', () => {
    const p = producto({ responsableDynamics: null, clasificacion: clasif({ esEmpresa: true }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'excepcion', esEmpresa: true });
  });

  it('marcar del empleado algo que Dynamics ya da del empleado: coincide', () => {
    const p = producto({ responsableDynamics: 'empleado', clasificacion: clasif({ esEmpresa: false }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'coincide', esEmpresa: false });
  });
});

describe('textoResponsableDynamics', () => {
  it('traduce los tres valores', () => {
    expect(textoResponsableDynamics('empresa')).toBe('Empresa');
    expect(textoResponsableDynamics('empleado')).toBe('Empleado');
    expect(textoResponsableDynamics(null)).toBe('Sin dato');
  });
});

describe('hayMasPorCargar: paginado sobre ~11.800', () => {
  it('quedan más si lo cargado es menor que el total', () => {
    expect(hayMasPorCargar(50, 11800)).toBe(true);
  });
  it('no quedan más cuando lo cargado alcanza el total', () => {
    expect(hayMasPorCargar(11800, 11800)).toBe(false);
  });
  it('total 0: no hay más', () => {
    expect(hayMasPorCargar(0, 0)).toBe(false);
  });
});

describe('aplicarClasificacion: actualiza en la lista ya cargada, sin recargar', () => {
  const lista = [producto({ codigo: 'A', clasificacion: null }), producto({ codigo: 'B', clasificacion: null })];

  it('clasificar B: solo B cambia, A queda intacto y el arreglo es nuevo', () => {
    const nueva = clasif({ codigo: 'B', esEmpresa: true });
    const res = aplicarClasificacion(lista, 'B', nueva);
    expect(res).not.toBe(lista); // inmutable
    expect(res.find((p) => p.codigo === 'B')!.clasificacion).toEqual(nueva);
    expect(res.find((p) => p.codigo === 'A')!.clasificacion).toBeNull();
  });

  it('desclasificar (null) deja el producto sin excepción', () => {
    const conB = aplicarClasificacion(lista, 'B', clasif({ codigo: 'B' }));
    const res = aplicarClasificacion(conB, 'B', null);
    expect(res.find((p) => p.codigo === 'B')!.clasificacion).toBeNull();
  });
});

describe('soloConClasificacion: el filtro de la lista de excepciones tras desclasificar', () => {
  it('deja solo los que tienen excepción', () => {
    const lista = [producto({ codigo: 'A', clasificacion: clasif({ codigo: 'A' }) }), producto({ codigo: 'B', clasificacion: null })];
    const res = soloConClasificacion(lista);
    expect(res.map((p) => p.codigo)).toEqual(['A']);
  });
});
