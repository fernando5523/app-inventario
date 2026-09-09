/**
 * El filtro de la lista de productos en Contar: un modal con TRES campos
 * combinables —categoría, nombre y código—, cada uno un select con búsqueda
 * de texto adentro (decisión del cliente 2026-09-07: los chips no escalaban a
 * hojas con muchas categorías). Aparte del JSX porque son reglas con bordes
 * (acentos, "sin categoría", cómo se combinan) que dentro de un `.filter()` en
 * el render no se pueden probar.
 *
 * `aplicarFiltro` NUNCA reordena la LISTA de productos: `.filter()` conserva
 * el orden de `hoja.productos`, que ya viene ordenado por categoría y código
 * desde el backend (ver `lote.ts#ordenarParaContar`) — filtrar no es
 * reordenar. Distinto es el orden de las OPCIONES de cada selector
 * (categoría/nombre/código): esas sí van alfabético ascendente (pedido del
 * cliente 2026-09-09) — ver `categoriasDeHoja`/`nombresDeHoja`/
 * `codigosDeHoja` más abajo. Y CONTEO CIEGO: acá no entra ni stock ni
 * precio, solo lo que sirve para encontrar un renglón.
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

/** Valores DISTINTOS, sin ningún orden en particular (lo pone quien llama). */
function distintos(valores: Iterable<string>): string[] {
  return [...new Set(valores)];
}

/** Alfabético natural en español: acentos y Ñ en su lugar (localeCompare 'es'). */
function ordenAlfabetico(valores: string[]): string[] {
  return [...valores].sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Igual que `ordenAlfabetico`, pero con `numeric: true`: un código
 * NUMÉRICO se compara por su valor, no letra por letra -- pedido del
 * cliente 2026-09-09, "que 100010 no quede antes que 9". Sirve igual de
 * bien para códigos no numéricos (alfabético común).
 */
function ordenDeCodigos(valores: string[]): string[] {
  return [...valores].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

/**
 * Las opciones de cada selector del modal de filtros, ORDENADAS ASCENDENTE
 * -- pedido del cliente 2026-09-09: antes salían en el orden en que
 * aparecen en la hoja (el de la góndola), que no ayuda a encontrar un
 * valor puntual en una lista larga.
 */
export function categoriasDeHoja(productos: readonly Producto[]): string[] {
  return ordenAlfabetico(distintos((function* () {
    for (const p of productos) yield categoriaDe(p);
  })()));
}

export function nombresDeHoja(productos: readonly Producto[]): string[] {
  return ordenAlfabetico(distintos((function* () {
    for (const p of productos) yield p.descripcion;
  })()));
}

export function codigosDeHoja(productos: readonly Producto[]): string[] {
  return ordenDeCodigos(distintos((function* () {
    for (const p of productos) yield p.codigo;
  })()));
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

function filtrarSinCampo(productos: readonly Producto[], filtro: FiltroProductos, excepto: keyof FiltroProductos): Producto[] {
  return aplicarFiltro(productos, { ...filtro, [excepto]: null });
}

function valorDeCampo(p: Producto, campo: keyof FiltroProductos): string {
  switch (campo) {
    case 'categoria':
      return categoriaDe(p);
    case 'nombre':
      return p.descripcion;
    case 'codigo':
      return p.codigo;
  }
}

const CAMPOS: (keyof FiltroProductos)[] = ['categoria', 'nombre', 'codigo'];

/**
 * Los tres selectores EN CASCADA: cada campo ofrece solo lo que sigue
 * siendo posible dado lo que ya se eligió en los OTROS dos (nunca sobre el
 * filtro completo, o el propio campo se quedaría viendo una sola opción:
 * la que ya tiene puesta). Pedido del cliente 2026-09-08: elegir
 * LICOR-RON en categoría tiene que dejar Nombre ofreciendo solo esos 2
 * productos, no los 10 de la hoja entera.
 */
export function opcionesEnCascada(
  productos: readonly Producto[],
  filtro: FiltroProductos,
): { categoria: string[]; nombre: string[]; codigo: string[] } {
  return {
    categoria: categoriasDeHoja(filtrarSinCampo(productos, filtro, 'categoria')),
    nombre: nombresDeHoja(filtrarSinCampo(productos, filtro, 'nombre')),
    codigo: codigosDeHoja(filtrarSinCampo(productos, filtro, 'codigo')),
  };
}

/**
 * Se llama al elegir `valor` para `campo` en el modal. Ese campo se pone
 * tal cual -- sale de sus propias opciones en cascada (`opcionesEnCascada`),
 * así que ya es compatible con lo demás. Los OTROS DOS, si su valor actual
 * dejó de tener algún producto en común con el recién elegido, se
 * limpian -- nunca se deja un filtro puesto que no corresponde a ninguna
 * fila. Se comparan cada uno CONTRA EL CAMPO QUE CAMBIÓ nada más, no entre
 * sí: ya eran compatibles entre ellos antes de este cambio (si no lo
 * fueran, ya se habrían limpiado en el cambio anterior), así que revisar
 * uno contra el otro además del que cambió los invalidaría en falso —
 * cambiar de categoría con nombre Y código de ANTES ya puestos limpiaría
 * también el código con solo mirar si combina con el nombre viejo.
 */
export function elegirCampo(
  productos: readonly Producto[],
  filtro: FiltroProductos,
  campo: keyof FiltroProductos,
  valor: string | null,
): FiltroProductos {
  const resultado: FiltroProductos = { ...filtro, [campo]: valor };
  if (valor === null) return resultado;
  for (const otro of CAMPOS) {
    if (otro === campo) continue;
    const actual = resultado[otro];
    if (actual !== null && !productos.some((p) => valorDeCampo(p, campo) === valor && valorDeCampo(p, otro) === actual)) {
      resultado[otro] = null;
    }
  }
  return resultado;
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
