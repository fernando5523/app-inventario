/**
 * LO QUE EL MOCK NO PUEDE FABRICAR, NO LO FABRICA.
 *
 * El adaptador en memoria sirve para demostrar y para probar las pantallas sin
 * backend, y sus cifras salen del dataset real de la Hoja #002. El .xlsx del
 * detalle de la cadena es la excepción: lo escribe el servidor con una librería
 * de planillas que el bundle del teléfono no tiene.
 *
 * Este test fija que ahí se FALLA con el motivo escrito, en vez de bajar un
 * ArrayBuffer vacío (un archivo que Excel abre roto) o un CSV con extensión
 * .xlsx (uno que abre bien y afirma lo que este mock no sabe). Las dos salidas
 * terminan en el peor resultado que tuvo esta app: un archivo vacío leído como
 * "no falta nada".
 */

import { describe, expect, it } from 'vitest';

import { auditoriaMemoria } from './auditoria-memoria';

describe('auditoriaMemoria.exportarDiferenciasCadena', () => {
  it('rechaza diciendo que hace falta el servidor: nunca devuelve algo que finja ser una planilla', async () => {
    await expect(auditoriaMemoria.exportarDiferenciasCadena()).rejects.toThrow(/servidor/i);
  });

  /**
   * El período no cambia nada: no es que falte ESE mes, es que falta con qué
   * escribir el archivo. Un mensaje distinto por período haría creer que
   * probando otro mes se consigue.
   */
  it('falla igual con período explícito: lo que falta es el formato del archivo, no las cifras', async () => {
    await expect(auditoriaMemoria.exportarDiferenciasCadena({ anio: 2026, mes: 9 })).rejects.toThrow(/servidor/i);
  });
});

/**
 * EL TOTAL A DESCONTAR DEL MOCK TIENE QUE SER EL NETO, no el bruto de "Al
 * personal": si el mock mostrara el bruto, la pantalla se maquetaría contra un
 * número que el servidor no devuelve y el error saldría recién contra el backend
 * vivo.
 */
describe('auditoriaMemoria.cadena -- el total a descontar', () => {
  it('es el faltante del cuadro único menos su sobrante, tienda por tienda', async () => {
    const { tiendas } = await auditoriaMemoria.cadena();

    for (const tienda of tiendas) {
      expect(tienda.valorADescontar).toBe(
        Math.round((tienda.porClase.unidad.valorFaltante - tienda.porClase.unidad.valorSobrante) * 100) / 100,
      );
    }
  });

  it('una tienda sin inventario del período va en 0, como el resto de los contadores', async () => {
    const { tiendas } = await auditoriaMemoria.cadena();
    const sinInventario = tiendas.filter((t) => t.inventarioId === null);

    // El mock siembra una sola tienda con datos: las otras tres son la cobertura.
    expect(sinInventario.length).toBeGreaterThan(0);
    for (const tienda of sinInventario) expect(tienda.valorADescontar).toBe(0);
  });

  it('el total es la suma de las filas, no un neteo del cuadro ya sumado', async () => {
    const { total, tiendas } = await auditoriaMemoria.cadena();

    const suma = tiendas.reduce((acumulado, t) => acumulado + t.valorADescontar, 0);
    expect(total.valorADescontar).toBe(Math.round(suma * 100) / 100);
  });
});
