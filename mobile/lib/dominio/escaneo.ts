/**
 * Resuelve un código de barras escaneado contra los productos de la hoja
 * que el Contador tiene abierta — en LOCAL, sin red.
 *
 * POR QUÉ EN LOCAL Y NO CONTRA EL CATÁLOGO DEL SERVIDOR
 * (`RepositorioCatalogo.porCodigoBarras`, el camino anterior):
 *
 * El escáner se usa parado frente a la góndola, en el fondo del almacén,
 * sin señal — es justo el momento en que mandar el código a HTTP falla
 * igual que cualquier otro pedido de red, y volver a la puerta a buscar
 * cobertura para confirmar UN producto no es una opción real.
 *
 * La hoja YA tiene sus productos completos en SQLite (ver
 * `hojas-sqlite.ts#filaAProducto`: `codigoBarras` de la unidad y de CADA
 * empaque viajan en el JSON de la columna `empaques`) — resolver contra
 * `hoja.productos` no es una degradación del dato, es la misma
 * información que ya está ahí, sin depender de que haya señal en ESE
 * momento.
 *
 * CONTEO CIEGO: si el código no está entre los productos ASIGNADOS a esta
 * hoja, no se cuenta nada — ni siquiera si el producto existe en el
 * catálogo general de la tienda. Es la misma regla que ya sostiene el
 * resto del conteo: cada hoja ve solo lo suyo.
 */

import type { Empaque, Producto } from './tipos';

/**
 * Una coincidencia posible del código escaneado: QUÉ producto es y en QUÉ
 * presentación se leyó (la unidad suelta, o alguno de sus empaques).
 *
 * Misma forma que ya usaba `contar.tsx#ultimoEscaneo` — se preserva a
 * propósito para que integrarla no obligue a rediseñar el estado de la
 * pantalla, solo a cambiar de dónde sale el dato.
 */
export interface CoincidenciaEscaneo {
  producto: Producto;
  presentacion: 'unidad' | 'empaque';
  /** El empaque que matcheó, o `null` si fue la unidad suelta. */
  empaque: Empaque | null;
}

/**
 * `no-encontrado`: el código no pertenece a NINGÚN producto de esta hoja.
 * `encontrado`: matchea con exactamente un producto (en una presentación).
 * `ambiguo`: el mismo código aparece más de una vez entre los productos de
 * la hoja — nada en el modelo lo impide (dos `Producto` son independientes,
 * `Producto.codigoBarras` no es único por diseño), y confirmar el primero
 * a ciegas registraría el producto equivocado. Se listan las opciones para
 * que la persona elija, en vez de adivinar.
 */
export type ResultadoEscaneo =
  | { estado: 'no-encontrado' }
  | { estado: 'encontrado'; coincidencia: CoincidenciaEscaneo }
  | { estado: 'ambiguo'; opciones: CoincidenciaEscaneo[] };

/**
 * Busca el código en TODOS los productos de la hoja: primero la unidad
 * suelta de cada uno, después cada uno de sus empaques. No corta en la
 * primera coincidencia — sigue recorriendo para poder detectar un
 * segundo match y devolver `ambiguo` en vez de resolver el primero que
 * encontró, que sería confirmar un producto al azar entre dos posibles.
 */
export function resolverCodigoEnHoja(productos: Producto[], codigo: string): ResultadoEscaneo {
  const coincidencias: CoincidenciaEscaneo[] = [];

  for (const producto of productos) {
    if (producto.codigoBarras === codigo) {
      coincidencias.push({ producto, presentacion: 'unidad', empaque: null });
    }
    for (const empaque of producto.empaques) {
      if (empaque.codigoBarras === codigo) {
        coincidencias.push({ producto, presentacion: 'empaque', empaque });
      }
    }
  }

  if (coincidencias.length === 0) return { estado: 'no-encontrado' };
  if (coincidencias.length === 1) return { estado: 'encontrado', coincidencia: coincidencias[0] };
  return { estado: 'ambiguo', opciones: coincidencias };
}
