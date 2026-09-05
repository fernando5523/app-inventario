import { describe, expect, it, vi } from 'vitest';

import { resolverCodigoEnHoja } from './escaneo';
import type { Producto } from './tipos';

function producto(overrides: Partial<Producto>): Producto {
  return {
    id: 1,
    codigo: '0001',
    codigoBarras: '7790000000001',
    descripcion: 'Producto de prueba',
    empaques: [{ nombre: 'Caja', factor: 12 }],
    ...overrides,
  };
}

describe('resolverCodigoEnHoja', () => {
  it('encuentra por el código de la unidad sin llamar a la red', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const p = producto({ id: 1, codigoBarras: '111' });
    const resultado = resolverCodigoEnHoja([p], '111');

    expect(resultado).toEqual({ estado: 'encontrado', coincidencia: { producto: p, presentacion: 'unidad', empaque: null } });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('encuentra por el código de un empaque, sin llamar a la red', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const empaque = { nombre: 'Caja', factor: 12, codigoBarras: '222' };
    const p = producto({ id: 1, codigoBarras: '111', empaques: [empaque] });
    const resultado = resolverCodigoEnHoja([p], '222');

    expect(resultado).toEqual({ estado: 'encontrado', coincidencia: { producto: p, presentacion: 'empaque', empaque } });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('un código ajeno a la hoja no cuenta nada y no llama a la red', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const p = producto({ id: 1, codigoBarras: '111' });
    const resultado = resolverCodigoEnHoja([p], '999');

    expect(resultado).toEqual({ estado: 'no-encontrado' });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('el mismo código en dos productos de la hoja es ambiguo: lista ambas opciones', () => {
    const a = producto({ id: 1, codigoBarras: '111', empaques: [] });
    const b = producto({ id: 2, codigoBarras: '111', descripcion: 'Otro producto', empaques: [] });

    const resultado = resolverCodigoEnHoja([a, b], '111');

    expect(resultado).toEqual({
      estado: 'ambiguo',
      opciones: [
        { producto: a, presentacion: 'unidad', empaque: null },
        { producto: b, presentacion: 'unidad', empaque: null },
      ],
    });
  });

  it('un código de unidad de un producto igual al código de empaque de otro también es ambiguo', () => {
    const empaque = { nombre: 'Pack', factor: 6, codigoBarras: '555' };
    const a = producto({ id: 1, codigoBarras: '555', empaques: [] });
    const b = producto({ id: 2, codigoBarras: '111', descripcion: 'Otro producto', empaques: [empaque] });

    const resultado = resolverCodigoEnHoja([a, b], '555');

    expect(resultado).toEqual({
      estado: 'ambiguo',
      opciones: [
        { producto: a, presentacion: 'unidad', empaque: null },
        { producto: b, presentacion: 'empaque', empaque },
      ],
    });
  });

  it('una hoja sin productos no encuentra nada', () => {
    expect(resolverCodigoEnHoja([], '111')).toEqual({ estado: 'no-encontrado' });
  });
});
