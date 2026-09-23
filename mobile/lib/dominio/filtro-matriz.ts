/**
 * El filtro de la MATRIZ DE AUDITORÍA: cinco campos combinables —hoja, cuadro,
 * categoría, descripción y código—, cada uno un select con búsqueda de texto
 * adentro.
 *
 * ES HERMANO DE `filtro-productos.ts`, NO EL MISMO. Comparte la forma (modal,
 * borrador, cascada, coincidencia exacta) porque es el control que la gente ya
 * sabe usar en Contar, pero opera sobre otra cosa: allá es `Producto[]` de UNA
 * hoja, acá es `ItemAuditoria[]` de TODAS las hojas del inventario, con el
 * veredicto y el reparto que resolvió el servidor. Intentar unificarlos
 * obligaría a uno de los dos a fingir campos del otro.
 *
 * POR QUÉ MODAL Y NO CHIPS + BUSCADOR, que es lo que había: la misma razón que
 * en Contar (2026-09-07, decisión del cliente). Seis chips en fila ya ocupaban
 * un renglón entero con scroll horizontal, y con la hoja adentro serían veinte
 * opciones más. Un chip que hay que scrollear para encontrar no se usa.
 *
 * Acá viven las reglas con bordes —qué cuenta como vacío, cómo se combinan,
 * cómo se ordenan las opciones—, fuera del JSX: adentro de un `.filter()` en
 * el render no se puede probar ninguna.
 */

import { cuadroDelItem } from './auditoria';
import type { ItemAuditoria, VeredictoAuditoria } from './tipos';

/**
 * EL CUADRO O ESTADO DE UN ÍTEM, que es el eje que antes eran los chips.
 *
 * `cuadrado` y `sin_dato` salen del VEREDICTO; los otros tres, del REPARTO que
 * resolvió el servidor. Son ejes distintos a propósito: un ítem con veredicto
 * `falta` puede caer en cualquiera de los tres cuadros, y confundirlos fue un
 * error caro (ver `cuadroDelItem`).
 */
export type CuadroFiltro = 'cuadrado' | 'personal' | 'paquetes' | 'empresa' | 'sin_dato';

/** La etiqueta de cada cuadro, con las palabras que ya usaba la pantalla. */
export const ETIQUETA_CUADRO: Record<CuadroFiltro, string> = {
  cuadrado: 'Cuadrados',
  personal: 'Al personal',
  paquetes: 'Por paquete',
  empresa: 'Empresa',
  sin_dato: 'Sin dato',
};

/** El orden en que se ofrecen: el mismo que tenían los chips, que es el del cierre. */
const ORDEN_CUADROS: CuadroFiltro[] = ['cuadrado', 'personal', 'paquetes', 'empresa', 'sin_dato'];

/**
 * Los cinco campos del modal. `null` en un campo = ese campo NO filtra. Se
 * combinan con Y (AND): un ítem tiene que pasar los cinco a la vez.
 */
export interface FiltroMatriz {
  hoja: string | null;
  cuadro: CuadroFiltro | null;
  categoria: string | null;
  descripcion: string | null;
  codigo: string | null;
}

export const FILTRO_MATRIZ_VACIO: FiltroMatriz = {
  hoja: null,
  cuadro: null,
  categoria: null,
  descripcion: null,
  codigo: null,
};

/** Cómo se llama cada campo en la pantalla. Un solo lugar, para que no haya dos. */
export const ETIQUETA_CAMPO: Record<keyof FiltroMatriz, string> = {
  hoja: 'Hoja',
  cuadro: 'En qué cuadro cayó',
  categoria: 'Categoría',
  descripcion: 'Descripción',
  codigo: 'Código',
};

const DIACRITICOS = /\p{Diacritic}/gu;

/** Quita tildes y pasa a minúsculas — "GASEOSA" y "gaseósa" (mal tipeado) matchean igual. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(DIACRITICOS, '').toLowerCase();
}

/**
 * Un ítem que ninguna hoja finalizada incluye llega con `hoja` en VACÍO (ver
 * `ItemAuditoria.hoja`). No se le inventa un rótulo que parezca un número de
 * hoja; se lo nombra por lo que es, y así se puede filtrar por ellos.
 */
export const SIN_HOJA = 'Sin hoja asignada';

export function hojaDe(item: Pick<ItemAuditoria, 'hoja'>): string {
  return item.hoja === '' ? SIN_HOJA : item.hoja;
}

/** El ERP no clasifica todos los productos — este es el bucket para esos. */
export const SIN_CATEGORIA = 'Sin categoría';

/**
 * La CATEGORÍA de un ítem de la matriz es su `zona`: es el campo que la
 * tarjeta ya muestra ("LICOR - VINO TINTO SECO") y con el que se arman las
 * hojas. Se le da el nombre que la persona ve, no el que tiene en el DTO.
 */
export function categoriaDe(item: Pick<ItemAuditoria, 'zona'>): string {
  return item.zona === '' ? SIN_CATEGORIA : item.zona;
}

/**
 * Si un ítem cae en un cuadro. SALIÓ DE `app/auditor/matriz.tsx` sin cambiarle
 * una coma: era el predicado de los chips, y al mudarse el filtro al modal
 * tenía que dejar de vivir en una pantalla para poder probarse.
 */
export function esDelCuadro(item: ItemAuditoria, v: VeredictoAuditoria, cuadro: CuadroFiltro): boolean {
  if (cuadro === 'sin_dato') return v === 'sin_contar' || v === 'sin_erp';
  if (cuadro === 'cuadrado') return v === 'cuadrado';
  const suyo = cuadroDelItem(item.atribucion);
  if (cuadro === 'personal') return suyo === 'personal';
  if (cuadro === 'paquetes') return suyo === 'paquetes';
  return suyo === 'empresa';
}

/**
 * Los cinco campos combinados con Y. Conserva el orden de `items`: filtrar no
 * es reordenar. Un campo en `null` no filtra; uno con valor exige coincidencia
 * EXACTA — es lo que se eligió de la lista del select, no texto libre.
 *
 * `veredictoPorId` viene de afuera (`resumirAuditoria`) y no se recalcula acá:
 * la pantalla ya recorre la matriz una vez para su resumen, y volver a
 * calcular el veredicto por ítem en cada render sobre 8.000 filas se nota.
 */
export function aplicarFiltroMatriz(
  items: readonly ItemAuditoria[],
  filtro: FiltroMatriz,
  veredictoPorId: ReadonlyMap<number, VeredictoAuditoria>,
): ItemAuditoria[] {
  return items.filter((it) => {
    if (filtro.hoja !== null && hojaDe(it) !== filtro.hoja) return false;
    if (filtro.categoria !== null && categoriaDe(it) !== filtro.categoria) return false;
    if (filtro.descripcion !== null && it.descripcion !== filtro.descripcion) return false;
    if (filtro.codigo !== null && it.codigo !== filtro.codigo) return false;
    if (filtro.cuadro !== null) {
      const v = veredictoPorId.get(it.productoId);
      // Sin veredicto no se puede afirmar en qué cuadro cayó, así que NO pasa
      // el filtro: meterlo igual sería decir que cayó en el que se eligió.
      if (v === undefined || !esDelCuadro(it, v, filtro.cuadro)) return false;
    }
    return true;
  });
}

/** Valores DISTINTOS, sin ningún orden en particular (lo pone quien llama). */
function distintos(valores: Iterable<string>): string[] {
  return [...new Set(valores)];
}

/** Alfabético natural en español: acentos y Ñ en su lugar. */
function ordenAlfabetico(valores: string[]): string[] {
  return [...valores].sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Igual, pero con `numeric: true`: "003" y "010" se comparan por su VALOR y no
 * letra por letra, así que la hoja 10 no queda antes que la 9. Mismo criterio
 * que los códigos en `filtro-productos.ts` (pedido del cliente 2026-09-09).
 */
function ordenNumerico(valores: string[]): string[] {
  return [...valores].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

/**
 * La búsqueda DENTRO de un campo (estilo select2): deja las opciones que
 * CONTIENEN el texto, sin distinguir mayúsculas ni acentos. Vacío = todas.
 * Es lo que hace que un campo con 20 hojas o 980 descripciones se navegue: se
 * tipea y la lista se achica.
 */
export function filtrarOpciones(opciones: readonly string[], texto: string): string[] {
  const q = normalizar(texto.trim());
  if (!q) return [...opciones];
  return opciones.filter((o) => normalizar(o).includes(q));
}

export interface OpcionesMatriz {
  hoja: string[];
  cuadro: CuadroFiltro[];
  categoria: string[];
  descripcion: string[];
  codigo: string[];
}

function sinCampo(
  items: readonly ItemAuditoria[],
  filtro: FiltroMatriz,
  excepto: keyof FiltroMatriz,
  veredictoPorId: ReadonlyMap<number, VeredictoAuditoria>,
): ItemAuditoria[] {
  return aplicarFiltroMatriz(items, { ...filtro, [excepto]: null }, veredictoPorId);
}

/**
 * Los cinco selectores EN CASCADA: cada campo ofrece solo lo que sigue siendo
 * posible dado lo que ya se eligió en los OTROS cuatro.
 *
 * Nunca sobre el filtro completo: si no, el propio campo se quedaría viendo
 * una sola opción, la que ya tiene puesta. Es el mismo molde que
 * `filtro-productos.ts#opcionesEnCascada`, y nace del mismo pedido (cliente,
 * 2026-09-08): elegir la hoja 003 tiene que dejar Descripción ofreciendo sus
 * 50 productos, no los 980 del inventario.
 */
export function opcionesEnCascada(
  items: readonly ItemAuditoria[],
  filtro: FiltroMatriz,
  veredictoPorId: ReadonlyMap<number, VeredictoAuditoria>,
): OpcionesMatriz {
  const posibles = (campo: keyof FiltroMatriz): ItemAuditoria[] => sinCampo(items, filtro, campo, veredictoPorId);
  return {
    hoja: ordenNumerico(distintos(posibles('hoja').map(hojaDe))),
    // Los cuadros NO se ordenan por nombre: van en el orden del cierre, que es
    // el que ya tenían los chips. Solo se ofrecen los que tienen algún ítem —
    // un cuadro vacío en la lista es una opción que no lleva a ninguna fila.
    cuadro: ORDEN_CUADROS.filter((c) =>
      posibles('cuadro').some((it) => {
        const v = veredictoPorId.get(it.productoId);
        return v !== undefined && esDelCuadro(it, v, c);
      }),
    ),
    categoria: ordenAlfabetico(distintos(posibles('categoria').map(categoriaDe))),
    descripcion: ordenAlfabetico(distintos(posibles('descripcion').map((it) => it.descripcion))),
    codigo: ordenNumerico(distintos(posibles('codigo').map((it) => it.codigo))),
  };
}

/**
 * Se llama al elegir `valor` para `campo` en el modal. Ese campo se pone tal
 * cual —sale de sus propias opciones en cascada, así que ya es compatible con
 * lo demás—. Los OTROS, si su valor actual dejó de tener algún ítem en común
 * con el recién elegido, SE LIMPIAN: nunca se deja puesto un filtro que no
 * corresponde a ninguna fila.
 *
 * Se comparan cada uno CONTRA EL CAMPO QUE CAMBIÓ y nada más, no entre sí: ya
 * eran compatibles entre ellos antes de este cambio (si no, se habrían
 * limpiado en el cambio anterior), así que mirarlos de a pares los invalidaría
 * en falso. Es la misma trampa que documenta `filtro-productos.ts#elegirCampo`.
 */
export function elegirCampo(
  items: readonly ItemAuditoria[],
  filtro: FiltroMatriz,
  campo: keyof FiltroMatriz,
  valor: string | null,
  veredictoPorId: ReadonlyMap<number, VeredictoAuditoria>,
): FiltroMatriz {
  const resultado = { ...filtro, [campo]: valor } as FiltroMatriz;
  if (valor === null) return resultado;

  const soloEsteCampo = { ...FILTRO_MATRIZ_VACIO, [campo]: valor } as FiltroMatriz;
  const conElNuevo = aplicarFiltroMatriz(items, soloEsteCampo, veredictoPorId);

  for (const otro of Object.keys(FILTRO_MATRIZ_VACIO) as Array<keyof FiltroMatriz>) {
    if (otro === campo) continue;
    const actual = resultado[otro];
    if (actual === null) continue;
    const sigueSiendoPosible = aplicarFiltroMatriz(
      conElNuevo,
      { ...FILTRO_MATRIZ_VACIO, [otro]: actual } as FiltroMatriz,
      veredictoPorId,
    ).length > 0;
    if (!sigueSiendoPosible) resultado[otro] = null;
  }
  return resultado;
}

/** Cuántos campos están puestos — el número que muestra el botón "Filtros". */
export function contarFiltrosActivos(filtro: FiltroMatriz): number {
  return (Object.keys(FILTRO_MATRIZ_VACIO) as Array<keyof FiltroMatriz>).filter((c) => filtro[c] !== null).length;
}

/**
 * Qué mostrar debajo del botón como "filtro activo" — `null` cuando no hay
 * ninguno, para que la pantalla no diga "filtro:" sin nada detrás.
 */
export function textoFiltroActivo(filtro: FiltroMatriz): string | null {
  const partes: string[] = [];
  if (filtro.hoja !== null) partes.push(filtro.hoja === SIN_HOJA ? SIN_HOJA : `Hoja ${filtro.hoja}`);
  if (filtro.cuadro !== null) partes.push(ETIQUETA_CUADRO[filtro.cuadro]);
  if (filtro.categoria !== null) partes.push(filtro.categoria);
  if (filtro.descripcion !== null) partes.push(filtro.descripcion);
  if (filtro.codigo !== null) partes.push(`#${filtro.codigo}`);
  return partes.length > 0 ? partes.join(' · ') : null;
}
