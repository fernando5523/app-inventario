import { describe, expect, it } from 'vitest';

import { armarFilasCorregibles } from './corregir-filas';
import type { Conteo, HojaConteo, ItemAuditoria, Producto } from './tipos';

/**
 * ---------------------------------------------------------------------------
 * EL CRUCE QUE MENTÍA EN SILENCIO
 * ---------------------------------------------------------------------------
 * Los números son los del inventario 8078 medidos contra la base: el código
 * 100150 es el producto 7045 en la ronda 1 y 8030 en la 2. La matriz entrega
 * siempre el 7045 -- el de la ronda 1 --, y las hojas de la ronda 2 traen el
 * 8030.
 *
 * Cruzando por `productoId`, corregir la ronda 2 o cualquier posterior dejaba
 * `item` en `null` para TODAS las filas: sin stock del ERP, sin diferencia y
 * con el filtro "Sin cuadrar" vacío. Sin ningún error a la vista -- la tabla
 * se dibujaba igual. Estos casos fallan si alguien vuelve a cruzar por id.
 */

function producto(id: number, codigo: string): Producto {
  return { id, codigo, codigoBarras: `775${codigo}`, descripcion: `Producto ${codigo}`, empaques: [] };
}

function conteo(productoId: number, sueltas: number): Conteo {
  return { productoId, empaques: [], sueltas, confirmadoPorEscaner: false, contadoEn: '2026-09-29T12:00:00.000Z' };
}

function hoja(over: Partial<HojaConteo> & Pick<HojaConteo, 'id' | 'numero' | 'productos' | 'conteos'>): HojaConteo {
  return {
    inventarioId: 8078,
    zona: 'Abarrotes',
    gondola: 'A1',
    tamano: 50,
    estado: 'finalizada',
    sync: 'sincronizado',
    asignados: [],
    ...over,
  };
}

/** El ítem tal como lo devuelve la matriz: su `productoId` es el de la RONDA 1. */
function enLaMatriz(productoId: number, codigo: string, stockErp: number | null): ItemAuditoria {
  return {
    productoId,
    codigo,
    descripcion: `Producto ${codigo}`,
    zona: 'Abarrotes',
    hoja: '001',
    precioVenta: 10,
    stockErp,
    conteos: [4],
    stockPorRonda: [],
    atribucion: {
      clase: 'unidad',
      empaqueUsado: null,
      empaqueSimbolo: null,
      empaqueEsCorregido: false,
      razon: null,
      unidadesAlPersonal: 0,
      unidadesAPaquetes: 0,
      unidadesAEmpresa: 0,
    },
    esEmpresa: false,
  };
}

describe('armar las filas de Corregir lo contado', () => {
  it('encuentra el ítem de la matriz al corregir una ronda posterior a la primera', () => {
    // La hoja es de la ronda 2: su producto es el 8030, no el 7045.
    const hojas = [hoja({ id: 305, numero: '001', productos: [producto(8030, '100150')], conteos: [conteo(8030, 4)] })];
    const matriz = [enLaMatriz(7045, '100150', 6)];

    const [fila] = armarFilasCorregibles(hojas, matriz);

    // Con el cruce por `productoId` esto era `null` y la pantalla quedaba sin
    // stock, sin diferencia y con el filtro "Sin cuadrar" vacío.
    expect(fila.item).not.toBeNull();
    expect(fila.item?.stockErp).toBe(6);
    expect(fila.item?.codigo).toBe('100150');
  });

  it('sigue encontrándolo en la ronda 1, donde los dos ids coinciden', () => {
    const hojas = [hoja({ id: 285, numero: '001', productos: [producto(7045, '100150')], conteos: [conteo(7045, 4)] })];

    const [fila] = armarFilasCorregibles(hojas, [enLaMatriz(7045, '100150', 6)]);

    expect(fila.item?.stockErp).toBe(6);
  });

  it('el producto que la matriz no trajo queda con item null, no con el de al lado', () => {
    const hojas = [hoja({ id: 305, numero: '004', productos: [producto(8031, '999999')], conteos: [] })];

    const [fila] = armarFilasCorregibles(hojas, [enLaMatriz(7045, '100150', 6)]);

    expect(fila.item).toBeNull();
    expect(fila.contado).toBeNull();
  });

  it('lleva la hoja, el conteo y las unidades de cada fila', () => {
    const hojas = [
      hoja({
        id: 305,
        numero: '002',
        productos: [producto(8030, '100150'), producto(8031, '113967')],
        conteos: [conteo(8030, 4)],
      }),
    ];

    const filas = armarFilasCorregibles(hojas, [enLaMatriz(7045, '100150', 6)]);

    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ hojaId: 305, numeroHoja: '002', contado: 4 });
    // El segundo no tiene conteo cargado: `null` y nunca 0 -- un cero diría
    // que alguien pasó por el ítem y contó cero.
    expect(filas[1].conteo).toBeNull();
    expect(filas[1].contado).toBeNull();
  });
});
