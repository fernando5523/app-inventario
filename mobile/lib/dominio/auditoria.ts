/**
 * Comparación de un item contra Dynamics tras el ciclo de 3 conteos.
 *
 * El precio usado para valorizar diferencias es el precio de VENTA, no el
 * de compra (así lo definió el cliente en la reunión de requisitos, ver
 * docs/pantallas.md Pantalla 5) — por eso `ItemAuditoria.precioVenta`, no
 * `precioCompra`.
 */

import type { ItemAuditoria, VeredictoAuditoria } from './tipos';

/**
 * El conteo que queda fijo para liquidar: el último que se hizo. Si un
 * item cuadró en el 1er o 2do conteo, no hay 3ro (ni 2do) — por eso se
 * toma el más avanzado que exista, no siempre `conteo3`.
 */
export function conteoFinal(item: Pick<ItemAuditoria, 'conteo1' | 'conteo2' | 'conteo3'>): number | null {
  return item.conteo3 ?? item.conteo2 ?? item.conteo1 ?? null;
}

/** conteoFinal - stockErp. Negativo = faltante, positivo = sobrante. */
export function diferenciaUnidades(item: ItemAuditoria): number {
  const final = conteoFinal(item);
  return final === null ? 0 : final - item.stockErp;
}

/** diferenciaUnidades * precioVenta — nunca precio de compra. */
export function diferenciaValor(item: ItemAuditoria): number {
  return diferenciaUnidades(item) * item.precioVenta;
}

/**
 * 'cuadrado' si el conteo final coincide con el ERP. Si no coincide y la
 * categoría la asume la empresa (regla de gerencia, ej. cervezas),
 * 'empresa' — el faltante existe pero no se descuenta a nómina. El resto
 * es 'falta', sea faltante o sobrante: la maqueta valida solo esos tres
 * filtros (Todos/Cuadrados/Faltante/Empresa), no hay un cuarto bucket
 * separado para sobrantes.
 */
export function veredicto(item: ItemAuditoria): VeredictoAuditoria {
  if (diferenciaUnidades(item) === 0) return 'cuadrado';
  if (item.esEmpresa) return 'empresa';
  return 'falta';
}
