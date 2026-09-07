/**
 * El filtro de la lista de Contar: búsqueda por nombre/código
 * (sin distinguir mayúsculas ni acentos) combinada con categoría.
 * Fija el pedido del cliente (2026-09-07) de que los dos sean
 * combinables y que ninguno reordene la hoja.
 */

import { describe, expect, it } from 'vitest';

import {
  categoriaDe,
  categoriasDeHoja,
  coincideBusqueda,
  ID_TODAS,
  productosVisibles,
  SIN_CATEGORIA,
  textoFiltroActivo,
} from './filtro-productos';
import type { Producto } from './tipos';

function producto(datos: Partial<Producto> & { id: number }): Producto {
  return {
    codigo: '0001',
    codigoBarras: '7750000000001',
    descripcion: 'Producto de prueba',
    empaques: [],
    ...datos,
  };
}

describe('coincideBusqueda', () => {
  it('sin texto, todo coincide', () => {
    expect(coincideBusqueda(producto({ id: 1 }), '')).toBe(true);
    expect(coincideBusqueda(producto({ id: 1 }), '   ')).toBe(true);
  });

  it('matchea por nombre, sin importar mayúsculas', () => {
    expect(coincideBusqueda(producto({ id: 1, descripcion: 'Gaseosa Cola 500ml' }), 'GASEOSA')).toBe(true);
    expect(coincideBusqueda(producto({ id: 1, descripcion: 'Gaseosa Cola 500ml' }), 'cola')).toBe(true);
  });

  it('matchea por nombre sin distinguir acentos, en cualquier sentido', () => {
    expect(coincideBusqueda(producto({ id: 1, descripcion: 'Jabón en Barra' }), 'jabon')).toBe(true);
    expect(coincideBusqueda(producto({ id: 1, descripcion: 'Jabon en Barra' }), 'jabón')).toBe(true);
  });

  it('matchea por código de barras', () => {
    expect(coincideBusqueda(producto({ id: 1, codigoBarras: '7750123456789' }), '123456')).toBe(true);
  });

  it('matchea por código interno de la hoja', () => {
    expect(coincideBusqueda(producto({ id: 1, codigo: '0051' }), '0051')).toBe(true);
  });

  it('no matchea si no aparece en ningún campo', () => {
    expect(coincideBusqueda(producto({ id: 1, descripcion: 'Fideos', codigo: '0002', codigoBarras: '111' }), 'arroz')).toBe(false);
  });
});

describe('categoriaDe / categoriasDeHoja', () => {
  it('sin categoría del ERP, cae en el bucket "Sin categoría"', () => {
    expect(categoriaDe(producto({ id: 1 }))).toBe(SIN_CATEGORIA);
  });

  it('junta las categorías presentes SIN duplicados, en el orden en que aparecen', () => {
    const productos = [
      producto({ id: 1, categoria: 'GALLETAS' }),
      producto({ id: 2, categoria: 'GALLETAS' }),
      producto({ id: 3, categoria: 'WAFERS' }),
      producto({ id: 4 }), // sin categoria
    ];
    expect(categoriasDeHoja(productos)).toEqual(['GALLETAS', 'WAFERS', SIN_CATEGORIA]);
  });
});

describe('productosVisibles', () => {
  const hoja = [
    producto({ id: 1, descripcion: 'Galleta de Vainilla', categoria: 'GALLETAS' }),
    producto({ id: 2, descripcion: 'Wafer de Chocolate', categoria: 'WAFERS' }),
    producto({ id: 3, descripcion: 'Galleta de Chocolate', categoria: 'GALLETAS' }),
  ];

  it('con "todas" las categorías y sin búsqueda, devuelve todo en el mismo orden', () => {
    expect(productosVisibles(hoja, '', ID_TODAS)).toEqual(hoja);
  });

  it('filtra por categoría sola', () => {
    const visibles = productosVisibles(hoja, '', 'WAFERS');
    expect(visibles.map((p) => p.id)).toEqual([2]);
  });

  it('filtra por búsqueda sola, conservando el orden original', () => {
    const visibles = productosVisibles(hoja, 'chocolate', ID_TODAS);
    expect(visibles.map((p) => p.id)).toEqual([2, 3]);
  });

  it('los dos filtros son combinables: tienen que pasar los dos', () => {
    const visibles = productosVisibles(hoja, 'chocolate', 'GALLETAS');
    expect(visibles.map((p) => p.id)).toEqual([3]);
  });

  it('cuando no queda nada, devuelve vacío', () => {
    expect(productosVisibles(hoja, 'no existe', ID_TODAS)).toEqual([]);
  });
});

describe('textoFiltroActivo', () => {
  it('sin ningún filtro puesto, es null', () => {
    expect(textoFiltroActivo('', ID_TODAS)).toBeNull();
    expect(textoFiltroActivo('   ', ID_TODAS)).toBeNull();
  });

  it('con solo categoría', () => {
    expect(textoFiltroActivo('', 'GALLETAS')).toBe('GALLETAS');
  });

  it('con solo búsqueda', () => {
    expect(textoFiltroActivo('cola', ID_TODAS)).toBe('"cola"');
  });

  it('con los dos combinados', () => {
    expect(textoFiltroActivo('cola', 'GASEOSAS')).toBe('GASEOSAS · "cola"');
  });
});
