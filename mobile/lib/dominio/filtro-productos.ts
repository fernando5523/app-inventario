/**
 * El filtro de la lista de productos en Contar: cada persona busca a su
 * manera (decisión del cliente, 2026-09-07). Aparte del JSX por lo mismo
 * que `filtro-hojas.ts`: son reglas con bordes (acentos, "sin categoría",
 * qué gana cuando los dos filtros están activos) que adentro de un
 * `.filter()` en el render no se pueden probar.
 *
 * El ORDEN nunca lo toca este módulo: `.filter()` conserva el orden de
 * `hoja.productos`, que ya viene ordenado por categoría y código desde el
 * backend (ver `lote.ts#ordenarParaContar`) — filtrar no es lo mismo que
 * reordenar.
 */

import type { Producto } from './tipos';

/** Chip "Todas" en el selector de categoría — no es una categoría real, nunca puede colisionar con una del ERP. */
export const ID_TODAS = '__todas__';

/** El ERP no clasifica todos los productos (`Producto.categoria` es opcional) — este es el bucket para esos. */
export const SIN_CATEGORIA = 'Sin categoría';

const DIACRITICOS = /\p{Diacritic}/gu;

/** Quita tildes y pasa a minúsculas — "GASEOSA" y "gaseosa" (o "gaseósa" mal tipeado) tienen que matchear igual. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(DIACRITICOS, '').toLowerCase();
}

/** Nombre O código (interno o de barras) — una sola caja para las dos cosas, sin distinguir mayúsculas ni acentos. */
export function coincideBusqueda(producto: Producto, busqueda: string): boolean {
  const q = normalizar(busqueda.trim());
  if (!q) return true;
  return (
    normalizar(producto.descripcion).includes(q) ||
    normalizar(producto.codigoBarras).includes(q) ||
    normalizar(producto.codigo).includes(q)
  );
}

export function categoriaDe(producto: Producto): string {
  return producto.categoria ?? SIN_CATEGORIA;
}

/** Categorías presentes en la hoja, en el orden en que aparecen (el mismo orden con el que ya camina la góndola). Sin duplicados. */
export function categoriasDeHoja(productos: readonly Producto[]): string[] {
  const vistas = new Set<string>();
  const orden: string[] = [];
  for (const p of productos) {
    const categoria = categoriaDe(p);
    if (!vistas.has(categoria)) {
      vistas.add(categoria);
      orden.push(categoria);
    }
  }
  return orden;
}

function coincideCategoria(producto: Producto, categoria: string): boolean {
  return categoria === ID_TODAS || categoriaDe(producto) === categoria;
}

/** Los dos filtros son combinables: un producto tiene que pasar los dos, no uno u otro. */
export function productosVisibles(productos: readonly Producto[], busqueda: string, categoria: string): Producto[] {
  return productos.filter((p) => coincideCategoria(p, categoria) && coincideBusqueda(p, busqueda));
}

/**
 * Qué mostrar como "filtro activo" en el pie de la lista — `null` cuando no
 * hay ningún filtro puesto, para que la pantalla no diga "filtro:" sin nada
 * detrás.
 */
export function textoFiltroActivo(busqueda: string, categoria: string): string | null {
  const partes: string[] = [];
  if (categoria !== ID_TODAS) partes.push(categoria);
  const q = busqueda.trim();
  if (q) partes.push(`"${q}"`);
  return partes.length > 0 ? partes.join(' · ') : null;
}
