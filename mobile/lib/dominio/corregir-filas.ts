import { totalUnidades } from './empaque';
import type { Conteo, HojaConteo, ItemAuditoria, Producto } from './tipos';

/**
 * ---------------------------------------------------------------------------
 * LAS FILAS DE "CORREGIR LO CONTADO"
 * ---------------------------------------------------------------------------
 * Unir las hojas de UNA ronda con la matriz de auditoría. Las dos lecturas
 * hacen falta y ninguna alcanza sola: las hojas traen el `hojaId` que pide el
 * endpoint de corrección y el conteo cargado hoy; la matriz trae el stock del
 * ERP y con él el veredicto.
 *
 * ---------------------------------------------------------------------------
 * EL CRUCE ES POR CÓDIGO, Y ESO ES EL ARREGLO DE UN BUG QUE MENTÍA EN SILENCIO
 * ---------------------------------------------------------------------------
 * El mismo artículo se materializa como un `Producto` DISTINTO en cada hoja de
 * cada ronda; el puente entre rondas es el CÓDIGO. La matriz devuelve el
 * `productoId` DE LA RONDA 1 (`auditoria.service.ts`: "la ronda 1 manda para
 * productoId/zona/hoja").
 *
 * Las dos pantallas cruzaban por `productoId`, así que al corregir la ronda 1
 * funcionaba y de la 2 en adelante NO encontraba ninguno: el stock del ERP, la
 * columna Diferencia y el filtro "Sin cuadrar" salían vacíos. Y no daba error
 * -- la tabla se veía bien y estaba vacía de datos, que es peor que fallar.
 * Medido en el inventario 8078: de los productos de la ronda 2 coinciden 0 con
 * los ids de la matriz, de la ronda 3 coinciden 0 y de la 4 coinciden 0.
 *
 * VIVE EN EL DOMINIO y no en cada pantalla porque es la MISMA regla para las
 * dos, y dos copias del mismo cruce es como una se arregla y la otra no. Es el
 * mismo criterio que `productoIdParaAjustar` en ajuste-final.ts, que cierra la
 * otra cara de este bug.
 */
export interface FilaCorregible {
  /** A qué hoja pertenece: es lo que pide el endpoint de corrección. */
  hojaId: number;
  numeroHoja: string;
  producto: Producto;
  /** Lo que se cargó, o `null` si nadie lo contó en esta ronda. */
  conteo: Conteo | null;
  /** Unidades contadas, por `totalUnidades`. `null` si no hay conteo. */
  contado: number | null;
  /** El ítem en la matriz de auditoría, para el stock y el veredicto. `null` si la matriz no lo trajo. */
  item: ItemAuditoria | null;
}

export function armarFilasCorregibles(
  hojas: readonly HojaConteo[],
  matriz: readonly ItemAuditoria[],
): FilaCorregible[] {
  // POR CÓDIGO. Ver la cabecera: con `productoId` esto queda vacío en toda
  // ronda posterior a la primera.
  const porCodigo = new Map(matriz.map((i) => [i.codigo, i] as const));

  return hojas.flatMap((hoja) =>
    hoja.productos.map((producto) => {
      const conteo = hoja.conteos.find((c) => c.productoId === producto.id) ?? null;
      return {
        hojaId: hoja.id,
        numeroHoja: hoja.numero,
        producto,
        conteo,
        // `totalUnidades` y nunca una suma a mano: es la MISMA función que usa
        // el Contador para su total, así que lo que el Auditor ve acá es
        // exactamente lo que se guardó.
        contado: conteo ? totalUnidades(conteo, producto.empaques) : null,
        item: porCodigo.get(producto.codigo) ?? null,
      };
    }),
  );
}
