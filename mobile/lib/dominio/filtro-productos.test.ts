import { describe, expect, it } from 'vitest';

import {
  aplicarFiltro,
  categoriasDeHoja,
  codigosDeHoja,
  contarFiltrosActivos,
  elegirCampo,
  filtrarOpciones,
  FILTRO_VACIO,
  nombresDeHoja,
  opcionesEnCascada,
  SIN_CATEGORIA,
  textoFiltroActivo,
  type FiltroProductos,
} from './filtro-productos';
import type { Producto } from './tipos';

function prod(parcial: Partial<Producto> & { id: number }): Producto {
  return {
    id: parcial.id,
    codigo: parcial.codigo ?? `C${parcial.id}`,
    codigoBarras: parcial.codigoBarras ?? `77${parcial.id}`,
    descripcion: parcial.descripcion ?? `Producto ${parcial.id}`,
    categoria: parcial.categoria,
    empaques: parcial.empaques ?? [{ nombre: 'Unidad', factor: 1 }],
  } as Producto;
}

// #4 a propósito SIN categoría — cae en el bucket "Sin categoría".
const HOJA: Producto[] = [
  prod({ id: 1, descripcion: 'Yogur Frutilla', codigo: '0001', categoria: 'Lácteos' }),
  prod({ id: 2, descripcion: 'Yogur Natural', codigo: '0002', categoria: 'Lácteos' }),
  prod({ id: 3, descripcion: 'Galleta de Agua', codigo: '0003', categoria: 'Galletas' }),
  prod({ id: 4, descripcion: 'Detergente', codigo: '0004' }),
];

const filtro = (p: Partial<FiltroProductos> = {}): FiltroProductos => ({ ...FILTRO_VACIO, ...p });
const ids = (ps: Producto[]): number[] => ps.map((p) => p.id);

describe('opciones de cada campo: distintas y en el orden de la hoja', () => {
  it('categorías: sin duplicados, en orden, con "Sin categoría" para las que el ERP no clasificó', () => {
    expect(categoriasDeHoja(HOJA)).toEqual(['Lácteos', 'Galletas', SIN_CATEGORIA]);
  });

  it('nombres y códigos: en el orden en que aparecen', () => {
    expect(nombresDeHoja(HOJA)).toEqual(['Yogur Frutilla', 'Yogur Natural', 'Galleta de Agua', 'Detergente']);
    expect(codigosDeHoja(HOJA)).toEqual(['0001', '0002', '0003', '0004']);
  });
});

describe('filtrarOpciones: la búsqueda dentro del select (estilo select2)', () => {
  it('vacío devuelve todas', () => {
    expect(filtrarOpciones(['Lácteos', 'Galletas'], '  ')).toEqual(['Lácteos', 'Galletas']);
  });

  it('deja las que CONTIENEN el texto, sin distinguir acentos ni mayúsculas', () => {
    expect(filtrarOpciones(['Lácteos', 'Galletas', 'Bebidas'], 'lac')).toEqual(['Lácteos']);
    expect(filtrarOpciones(['Yogur Frutilla', 'Yogur Natural', 'Galleta'], 'YOGUR')).toEqual([
      'Yogur Frutilla',
      'Yogur Natural',
    ]);
  });

  it('sin coincidencias devuelve lista vacía', () => {
    expect(filtrarOpciones(['Lácteos', 'Galletas'], 'zzz')).toEqual([]);
  });
});

describe('aplicarFiltro: los tres campos combinables, conservando el orden', () => {
  it('sin filtros: la hoja entera, en su orden', () => {
    expect(ids(aplicarFiltro(HOJA, FILTRO_VACIO))).toEqual([1, 2, 3, 4]);
  });

  it('solo categoría', () => {
    expect(ids(aplicarFiltro(HOJA, filtro({ categoria: 'Lácteos' })))).toEqual([1, 2]);
  });

  it('categoría "Sin categoría" agarra los que el ERP no clasificó', () => {
    expect(ids(aplicarFiltro(HOJA, filtro({ categoria: SIN_CATEGORIA })))).toEqual([4]);
  });

  it('solo nombre (coincidencia exacta, lo que se eligió de la lista)', () => {
    expect(ids(aplicarFiltro(HOJA, filtro({ nombre: 'Yogur Natural' })))).toEqual([2]);
  });

  it('solo código', () => {
    expect(ids(aplicarFiltro(HOJA, filtro({ codigo: '0003' })))).toEqual([3]);
  });

  it('combinados con Y: categoría + nombre', () => {
    expect(ids(aplicarFiltro(HOJA, filtro({ categoria: 'Lácteos', nombre: 'Yogur Frutilla' })))).toEqual([1]);
  });

  it('una combinación imposible (categoría de otro) no devuelve nada', () => {
    expect(aplicarFiltro(HOJA, filtro({ categoria: 'Galletas', nombre: 'Yogur Frutilla' }))).toEqual([]);
  });

  it('conserva el orden de la hoja, nunca reordena', () => {
    const alReves = [...HOJA].reverse();
    expect(ids(aplicarFiltro(alReves, filtro({ categoria: 'Lácteos' })))).toEqual([2, 1]);
  });
});

describe('contarFiltrosActivos: el número del botón "Filtros"', () => {
  it('cuenta solo los campos puestos', () => {
    expect(contarFiltrosActivos(FILTRO_VACIO)).toBe(0);
    expect(contarFiltrosActivos(filtro({ categoria: 'Lácteos' }))).toBe(1);
    expect(contarFiltrosActivos(filtro({ categoria: 'Lácteos', codigo: '0001' }))).toBe(2);
    expect(contarFiltrosActivos(filtro({ categoria: 'x', nombre: 'y', codigo: 'z' }))).toBe(3);
  });
});

describe('opcionesEnCascada: cada selector se recorta con lo que ya eligieron los otros dos', () => {
  it('sin nada elegido: las tres listas completas de la hoja', () => {
    const op = opcionesEnCascada(HOJA, FILTRO_VACIO);
    expect(op.categoria).toEqual(['Lácteos', 'Galletas', SIN_CATEGORIA]);
    expect(op.nombre).toEqual(['Yogur Frutilla', 'Yogur Natural', 'Galleta de Agua', 'Detergente']);
    expect(op.codigo).toEqual(['0001', '0002', '0003', '0004']);
  });

  it('elegir categoría reduce nombre y código a esa categoría', () => {
    const op = opcionesEnCascada(HOJA, filtro({ categoria: 'Lácteos' }));
    expect(op.nombre).toEqual(['Yogur Frutilla', 'Yogur Natural']);
    expect(op.codigo).toEqual(['0001', '0002']);
  });

  it('categoría NO se recorta a sí misma -- si no, quedaría viendo una sola opción: la que ya tiene puesta', () => {
    const op = opcionesEnCascada(HOJA, filtro({ categoria: 'Lácteos' }));
    expect(op.categoria).toEqual(['Lácteos', 'Galletas', SIN_CATEGORIA]);
  });

  it('elegir nombre deja la categoría en la suya', () => {
    const op = opcionesEnCascada(HOJA, filtro({ nombre: 'Yogur Natural' }));
    expect(op.categoria).toEqual(['Lácteos']);
    expect(op.codigo).toEqual(['0002']);
  });

  it('categoría + nombre juntos: código queda en uno solo', () => {
    const op = opcionesEnCascada(HOJA, filtro({ categoria: 'Lácteos', nombre: 'Yogur Frutilla' }));
    expect(op.codigo).toEqual(['0001']);
  });
});

describe('elegirCampo: un valor que deja de tener sentido con el cambio se limpia solo', () => {
  it('cambiar la categoría descarta el nombre que ya no pertenece a ella', () => {
    const conNombre = filtro({ categoria: 'Lácteos', nombre: 'Yogur Frutilla' });
    expect(elegirCampo(HOJA, conNombre, 'categoria', 'Galletas')).toEqual(filtro({ categoria: 'Galletas', nombre: null, codigo: null }));
  });

  it('cambiar la categoría descarta también el código, si tampoco corresponde', () => {
    const completo = filtro({ categoria: 'Lácteos', nombre: 'Yogur Frutilla', codigo: '0001' });
    expect(elegirCampo(HOJA, completo, 'categoria', 'Galletas')).toEqual(filtro({ categoria: 'Galletas', nombre: null, codigo: null }));
  });

  it('un valor que sigue siendo compatible no se toca', () => {
    const conCategoria = filtro({ categoria: 'Lácteos' });
    expect(elegirCampo(HOJA, conCategoria, 'nombre', 'Yogur Natural')).toEqual(filtro({ categoria: 'Lácteos', nombre: 'Yogur Natural' }));
  });

  it('elegir un nombre no toca un código que sigue siendo el mismo producto', () => {
    const conNombreYCodigo = filtro({ nombre: 'Yogur Frutilla', codigo: '0001' });
    expect(elegirCampo(HOJA, conNombreYCodigo, 'categoria', 'Lácteos')).toEqual(
      filtro({ categoria: 'Lácteos', nombre: 'Yogur Frutilla', codigo: '0001' }),
    );
  });

  it('limpiar UN campo (valor null) nunca borra los otros', () => {
    const completo = filtro({ categoria: 'Lácteos', nombre: 'Yogur Frutilla', codigo: '0001' });
    expect(elegirCampo(HOJA, completo, 'nombre', null)).toEqual(filtro({ categoria: 'Lácteos', nombre: null, codigo: '0001' }));
  });

  it('"Limpiar todo" (FILTRO_VACIO) vuelve a las opciones completas de la hoja', () => {
    expect(opcionesEnCascada(HOJA, FILTRO_VACIO)).toEqual({
      categoria: ['Lácteos', 'Galletas', SIN_CATEGORIA],
      nombre: ['Yogur Frutilla', 'Yogur Natural', 'Galleta de Agua', 'Detergente'],
      codigo: ['0001', '0002', '0003', '0004'],
    });
  });
});

describe('textoFiltroActivo: el resumen del pie de la lista', () => {
  it('null cuando no hay ninguno', () => {
    expect(textoFiltroActivo(FILTRO_VACIO)).toBeNull();
  });

  it('junta los campos puestos; el código va con #', () => {
    expect(textoFiltroActivo(filtro({ categoria: 'Lácteos', codigo: '0001' }))).toBe('Lácteos · #0001');
    expect(textoFiltroActivo(filtro({ nombre: 'Yogur Natural' }))).toBe('Yogur Natural');
  });
});
