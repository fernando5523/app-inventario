/**
 * El filtro de la lista de productos en Contar: un modal con TRES campos
 * combinables —categoría, nombre y código—, cada uno un select con búsqueda
 * de texto adentro (decisión del cliente 2026-09-07: los chips no escalaban a
 * hojas con muchas categorías). Aparte del JSX porque son reglas con bordes
 * (acentos, "sin categoría", cómo se combinan) que dentro de un `.filter()` en
 * el render no se pueden probar.
 *
 * El ORDEN nunca lo toca este módulo: `.filter()` conserva el orden de
 * `hoja.productos`, que ya viene ordenado por categoría y código desde el
 * backend (ver `lote.ts#ordenarParaContar`) — filtrar no es reordenar. Y
 * CONTEO CIEGO: acá no entra ni stock ni precio, solo lo que sirve para
 * encontrar un renglón.
 */

import type { Producto } from './tipos';

/** El ERP no clasifica todos los productos (`Producto.categoria` es opcional) — este es el bucket para esos. */
export const SIN_CATEGORIA = 'Sin categoría';

/**
 * Los tres campos del modal. `null` en un campo = ese campo NO filtra. Se
 * combinan con Y (AND): un producto tiene que pasar los tres a la vez.
 */
export interface FiltroProductos {
  categoria: string | null;
  nombre: string | null;
  codigo: string | null;
}

export const FILTRO_VACIO: FiltroProductos = { categoria: null, nombre: null, codigo: null };

const DIACRITICOS = /\p{Diacritic}/gu;

/** Quita tildes y pasa a minúsculas — "GASEOSA" y "gaseósa" (mal tipeado) matchean igual. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(DIACRITICOS, '').toLowerCase();
}

export function categoriaDe(producto: Producto): string {
  return producto.categoria ?? SIN_CATEGORIA;
}

/**
 * Valores DISTINTOS en el orden en que aparecen en la hoja (el mismo con el
 * que se camina la góndola). Sin duplicados, sin reordenar.
 */
function distintosEnOrden(valores: Iterable<string>): string[] {
  const vistos = new Set<string>();
  const orden: string[] = [];
  for (const v of valores) {
    if (!vistos.has(v)) {
      vistos.add(v);
      orden.push(v);
    }
  }
  return orden;
}

export function categoriasDeHoja(productos: readonly Producto[]): string[] {
  return distintosEnOrden((function* () {
    for (const p of productos) yield categoriaDe(p);
  })());
}

export function nombresDeHoja(productos: readonly Producto[]): string[] {
  return distintosEnOrden((function* () {
    for (const p of productos) yield p.descripcion;
  })());
}

export function codigosDeHoja(productos: readonly Producto[]): string[] {
  return distintosEnOrden((function* () {
    for (const p of productos) yield p.codigo;
  })());
}

/**
 * La búsqueda DENTRO de un campo (estilo select2): deja las opciones que
 * CONTIENEN el texto, sin distinguir mayúsculas ni acentos. Vacío = todas.
 * Es lo que hace que un campo con 100 categorías se navegue igual que uno con
 * 2: se tipea y la lista se achica, en vez de scrollear cien chips.
 */
export function filtrarOpciones(opciones: readonly string[], texto: string): string[] {
  const q = normalizar(texto.trim());
  if (!q) return [...opciones];
  return opciones.filter((o) => normalizar(o).includes(q));
}

/**
 * Los tres campos combinados con Y. Conserva el orden de `productos`. Un campo
 * en `null` no filtra; uno con valor exige coincidencia EXACTA (es lo que se
 * eligió de la lista del select, no texto libre).
 */
export function aplicarFiltro(productos: readonly Producto[], filtro: FiltroProductos): Producto[] {
  return productos.filter(
    (p) =>
      (filtro.categoria === null || categoriaDe(p) === filtro.categoria) &&
      (filtro.nombre === null || p.descripcion === filtro.nombre) &&
      (filtro.codigo === null || p.codigo === filtro.codigo),
  );
}

/** Cuántos de los tres campos están puestos — el número que muestra el botón "Filtros". */
export function contarFiltrosActivos(filtro: FiltroProductos): number {
  return (filtro.categoria !== null ? 1 : 0) + (filtro.nombre !== null ? 1 : 0) + (filtro.codigo !== null ? 1 : 0);
}

/**
 * Qué mostrar como "filtro activo" en el pie de la lista — `null` cuando no
 * hay ninguno, para que la pantalla no diga "filtro:" sin nada detrás.
 */
export function textoFiltroActivo(filtro: FiltroProductos): string | null {
  const partes: string[] = [];
  if (filtro.categoria !== null) partes.push(filtro.categoria);
  if (filtro.nombre !== null) partes.push(filtro.nombre);
  if (filtro.codigo !== null) partes.push(`#${filtro.codigo}`);
  return partes.length > 0 ? partes.join(' · ') : null;
}
