import { describe, expect, it } from 'vitest';

import { resumirAuditoria } from './auditoria';
import {
  aplicarFiltroMatriz,
  categoriaDe,
  contarFiltrosActivos,
  elegirCampo,
  esDelCuadro,
  FILTRO_MATRIZ_VACIO,
  filtrarOpciones,
  hojaDe,
  opcionesEnCascada,
  SIN_CATEGORIA,
  SIN_HOJA,
  textoFiltroActivo,
  type FiltroMatriz,
} from './filtro-matriz';
import type { AtribucionItem, ItemAuditoria } from './tipos';

const atribucionVacia: AtribucionItem = {
  clase: 'unidad',
  empaqueUsado: null,
  empaqueSimbolo: null,
  empaqueEsCorregido: false,
  razon: null,
  unidadesAlPersonal: 0,
  unidadesAPaquetes: 0,
  unidadesAEmpresa: 0,
};

let sig = 0;
function item(over: Partial<ItemAuditoria> = {}): ItemAuditoria {
  sig += 1;
  return {
    productoId: sig,
    codigo: `C${sig}`,
    descripcion: `Producto ${sig}`,
    zona: 'ABARROTES',
    hoja: '001',
    precioVenta: 10,
    stockErp: 100,
    conteos: [100],
    atribucion: atribucionVacia,
    esEmpresa: false,
    ...over,
  };
}

/** El mapa de veredictos sale del mismo resumen que usa la pantalla. */
const veredictos = (items: ItemAuditoria[]) => resumirAuditoria(items).veredictoPorId;

describe('el valor de cada campo', () => {
  it('una hoja vacía se nombra por lo que es, no con un número inventado', () => {
    expect(hojaDe({ hoja: '' })).toBe(SIN_HOJA);
    expect(hojaDe({ hoja: '003' })).toBe('003');
  });

  it('la categoría de la matriz es la zona, que es lo que muestra la tarjeta', () => {
    expect(categoriaDe({ zona: 'LICOR - VINO TINTO SECO' })).toBe('LICOR - VINO TINTO SECO');
    expect(categoriaDe({ zona: '' })).toBe(SIN_CATEGORIA);
  });
});

describe('aplicarFiltroMatriz: los campos se combinan con Y', () => {
  const items = [
    item({ hoja: '001', zona: 'ABARROTES', codigo: '100', descripcion: 'ACEITE' }),
    item({ hoja: '001', zona: 'LACTEOS', codigo: '200', descripcion: 'LECHE' }),
    item({ hoja: '002', zona: 'ABARROTES', codigo: '300', descripcion: 'ARROZ' }),
  ];
  const v = veredictos(items);

  it('sin nada puesto no filtra', () => {
    expect(aplicarFiltroMatriz(items, FILTRO_MATRIZ_VACIO, v)).toHaveLength(3);
  });

  it('por hoja', () => {
    const r = aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, hoja: '001' }, v);
    expect(r.map((i) => i.codigo)).toEqual(['100', '200']);
  });

  it('hoja Y categoría juntas dejan uno solo', () => {
    const r = aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, hoja: '001', categoria: 'ABARROTES' }, v);
    expect(r.map((i) => i.codigo)).toEqual(['100']);
  });

  /** Filtrar no es reordenar: el orden que trae el servidor se respeta. */
  it('conserva el orden de la matriz', () => {
    const r = aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, categoria: 'ABARROTES' }, v);
    expect(r.map((i) => i.codigo)).toEqual(['100', '300']);
  });

  it('exige coincidencia exacta, no un pedazo: sale de una lista, no se tipea', () => {
    expect(aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, descripcion: 'ACE' }, v)).toHaveLength(0);
    expect(aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, descripcion: 'ACEITE' }, v)).toHaveLength(1);
  });
});

describe('el campo cuadro: es el eje que antes eran los chips', () => {
  const cuadrado = item({ stockErp: 100, conteos: [100] });
  const sinContar = item({ stockErp: 100, conteos: [null] });
  const sinErp = item({ stockErp: null, conteos: [50] });
  const alPersonal = item({
    stockErp: 100,
    conteos: [98],
    atribucion: { ...atribucionVacia, unidadesAlPersonal: -2 },
  });
  const items = [cuadrado, sinContar, sinErp, alPersonal];
  const v = veredictos(items);

  it('"Cuadrados" son los del veredicto, no los del reparto', () => {
    const r = aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, cuadro: 'cuadrado' }, v);
    expect(r).toEqual([cuadrado]);
  });

  it('"Sin dato" junta los que no se pueden auditar: sin contar y sin ERP', () => {
    const r = aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, cuadro: 'sin_dato' }, v);
    expect(r.map((i) => i.productoId).sort()).toEqual([sinContar.productoId, sinErp.productoId].sort());
  });

  it('"Al personal" sale del REPARTO del servidor', () => {
    const r = aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, cuadro: 'personal' }, v);
    expect(r).toEqual([alPersonal]);
  });

  /**
   * Un ítem sin veredicto no se puede afirmar en qué cuadro cayó. Meterlo
   * igual sería decir que cayó en el que se eligió.
   */
  it('sin veredicto no pasa el filtro de cuadro', () => {
    const vacio = new Map();
    expect(aplicarFiltroMatriz(items, { ...FILTRO_MATRIZ_VACIO, cuadro: 'cuadrado' }, vacio)).toHaveLength(0);
  });

  it('`esDelCuadro` distingue los dos ejes sobre el mismo ítem', () => {
    expect(esDelCuadro(alPersonal, 'falta', 'personal')).toBe(true);
    expect(esDelCuadro(alPersonal, 'falta', 'paquetes')).toBe(false);
  });
});

describe('las opciones van en cascada y ordenadas', () => {
  const items = [
    item({ hoja: '010', zona: 'LACTEOS', codigo: '900', descripcion: 'LECHE' }),
    item({ hoja: '002', zona: 'ABARROTES', codigo: '100010', descripcion: 'ARROZ' }),
    item({ hoja: '002', zona: 'LACTEOS', codigo: '9', descripcion: 'YOGUR' }),
  ];
  const v = veredictos(items);

  /** "que 100010 no quede antes que 9" — pedido del cliente, ya en Contar. */
  it('hoja y código se ordenan por VALOR, no letra por letra', () => {
    const o = opcionesEnCascada(items, FILTRO_MATRIZ_VACIO, v);
    expect(o.hoja).toEqual(['002', '010']);
    // 9 < 900 < 100010 por VALOR. Letra por letra darían '100010', '9', '900'.
    expect(o.codigo).toEqual(['9', '900', '100010']);
  });

  it('categoría y descripción, alfabético en español', () => {
    const o = opcionesEnCascada(items, FILTRO_MATRIZ_VACIO, v);
    expect(o.categoria).toEqual(['ABARROTES', 'LACTEOS']);
    expect(o.descripcion).toEqual(['ARROZ', 'LECHE', 'YOGUR']);
  });

  /**
   * LA CASCADA: elegir la hoja 002 deja Descripción ofreciendo SUS productos,
   * no los del inventario entero.
   */
  it('un campo acota a los otros', () => {
    const o = opcionesEnCascada(items, { ...FILTRO_MATRIZ_VACIO, hoja: '002' }, v);
    expect(o.descripcion).toEqual(['ARROZ', 'YOGUR']);
  });

  /**
   * Y el PROPIO campo sigue ofreciendo todo: si se calculara sobre el filtro
   * completo, Hoja se quedaría viendo solo la que ya tiene puesta y no se
   * podría cambiar sin limpiar primero.
   */
  it('el campo elegido sigue ofreciendo sus otras opciones', () => {
    const o = opcionesEnCascada(items, { ...FILTRO_MATRIZ_VACIO, hoja: '002' }, v);
    expect(o.hoja).toEqual(['002', '010']);
  });

  it('solo se ofrecen los cuadros que tienen algún ítem', () => {
    const o = opcionesEnCascada(items, FILTRO_MATRIZ_VACIO, v);
    expect(o.cuadro).toEqual(['cuadrado']);
  });
});

describe('elegir un campo limpia los que dejaron de tener sentido', () => {
  const items = [
    item({ hoja: '001', zona: 'ABARROTES', descripcion: 'ARROZ' }),
    item({ hoja: '002', zona: 'LACTEOS', descripcion: 'LECHE' }),
  ];
  const v = veredictos(items);

  it('el campo elegido se pone tal cual', () => {
    const r = elegirCampo(items, FILTRO_MATRIZ_VACIO, 'hoja', '001', v);
    expect(r.hoja).toBe('001');
  });

  it('un valor de otro campo que ya no combina se limpia solo', () => {
    const conLacteos: FiltroMatriz = { ...FILTRO_MATRIZ_VACIO, categoria: 'LACTEOS' };
    const r = elegirCampo(items, conLacteos, 'hoja', '001', v);
    expect(r.hoja).toBe('001');
    // En la hoja 001 no hay LACTEOS: dejarlo puesto mostraría cero filas con
    // dos filtros que la persona no puso juntos a propósito.
    expect(r.categoria).toBeNull();
  });

  it('uno que SÍ combina se queda', () => {
    const conAbarrotes: FiltroMatriz = { ...FILTRO_MATRIZ_VACIO, categoria: 'ABARROTES' };
    const r = elegirCampo(items, conAbarrotes, 'hoja', '001', v);
    expect(r.categoria).toBe('ABARROTES');
  });

  it('poner un campo en null no limpia nada más: es quitar, no elegir', () => {
    const puesto: FiltroMatriz = { ...FILTRO_MATRIZ_VACIO, hoja: '001', categoria: 'ABARROTES' };
    const r = elegirCampo(items, puesto, 'hoja', null, v);
    expect(r).toEqual({ ...FILTRO_MATRIZ_VACIO, categoria: 'ABARROTES' });
  });
});

describe('lo que ve la persona', () => {
  it('cuenta los campos puestos', () => {
    expect(contarFiltrosActivos(FILTRO_MATRIZ_VACIO)).toBe(0);
    expect(contarFiltrosActivos({ ...FILTRO_MATRIZ_VACIO, hoja: '001', cuadro: 'personal' })).toBe(2);
  });

  it('sin filtros no dice "filtro:" sin nada detrás', () => {
    expect(textoFiltroActivo(FILTRO_MATRIZ_VACIO)).toBeNull();
  });

  /** "Hoja 003" y no un número suelto: un 003 solo no dice de qué es. */
  it('nombra la hoja, y el cuadro con su etiqueta', () => {
    expect(textoFiltroActivo({ ...FILTRO_MATRIZ_VACIO, hoja: '003', cuadro: 'personal' })).toBe(
      'Hoja 003 · Al personal',
    );
  });

  it('la hoja vacía ya se llama por su nombre: no se le antepone "Hoja"', () => {
    expect(textoFiltroActivo({ ...FILTRO_MATRIZ_VACIO, hoja: SIN_HOJA })).toBe(SIN_HOJA);
  });

  it('el código va con # para que no se confunda con una cantidad', () => {
    expect(textoFiltroActivo({ ...FILTRO_MATRIZ_VACIO, codigo: '100150' })).toBe('#100150');
  });
});

describe('la búsqueda dentro de un campo', () => {
  const opciones = ['ACEITE VEGETAL', 'LECHE', 'AZÚCAR RUBIA'];

  it('vacío devuelve todas', () => {
    expect(filtrarOpciones(opciones, '  ')).toEqual(opciones);
  });

  it('busca por pedazo, sin mayúsculas ni tildes', () => {
    expect(filtrarOpciones(opciones, 'azucar')).toEqual(['AZÚCAR RUBIA']);
    expect(filtrarOpciones(opciones, 'veget')).toEqual(['ACEITE VEGETAL']);
  });
});
