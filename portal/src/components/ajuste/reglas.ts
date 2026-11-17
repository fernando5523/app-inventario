import type { FaseDeCierre } from '../corregir/reglas'
import type { ItemDeLaMatriz } from '../corregir/tipos'

/**
 * Lo poco que el ajuste necesita y no está ya en `corregir/reglas.ts`.
 *
 * El resto —`STOCK_NO_SE_CORRIGE`, `faseDeCierre`, `errorDeMotivo`,
 * `MOTIVO_MINIMO`, `ordinal`, `textoStockDeLaMedicion`— se IMPORTA de ahí en
 * vez de copiarse: son las mismas reglas del mismo dominio, y una tercera
 * copia es un tercer lugar donde pueden discrepar. Si esas funciones se
 * mudan a una carpeta compartida, este módulo sigue el import y nada más.
 */

/**
 * CUÁNDO SE PUEDE AJUSTAR: solo con el ajuste ya iniciado.
 *
 * Espeja `mobile/lib/dominio/ajuste-final.ts#puedeAjustar` y la ventana que
 * el servidor sostiene en `ajuste.permisos.ts#validarAjusteEnCurso`: con
 * `en_curso` responde 409 ("todavía no está iniciado") y con el conteo ya
 * cerrado también ("el ajuste final terminó").
 */
export function puedeAjustar(fase: FaseDeCierre | null): boolean {
  return fase === 'ajuste'
}

/** `true` cuando el ajuste todavía se puede INICIAR: la última ronda cerró y nadie lo arrancó. */
export function puedeIniciarAjuste(fase: FaseDeCierre | null): boolean {
  return fase === 'rondas-cerradas'
}

export type Cantidad = { ok: true; valor: number } | { ok: false; mensaje: string }

/**
 * El valor definitivo se escribe en UNIDADES, no en empaques.
 *
 * Decisión del cliente, portada del teléfono: el Auditor no está recontando
 * góndola, está fijando una cifra contra un stock del ERP que ya viene en
 * unidades. Pedírsela en empaques lo obligaría a dividir mentalmente para
 * comparar dos números que están en la misma unidad.
 *
 * Vacío NO es 0: un campo en blanco es "todavía no escribí", y guardarlo como
 * cero fijaría un valor que nadie afirmó.
 */
export function interpretarCantidad(texto: string): Cantidad {
  const limpio = texto.trim()
  if (limpio === '') return { ok: false, mensaje: 'Escribe el valor definitivo en unidades.' }
  if (!/^\d+$/.test(limpio)) return { ok: false, mensaje: 'Solo números enteros, sin comas ni negativos.' }
  const valor = Number(limpio)
  if (!Number.isSafeInteger(valor)) return { ok: false, mensaje: 'Ese número es demasiado grande.' }
  return { ok: true, valor }
}

/**
 * LA DIFERENCIA QUE DEJARÍA ESTE VALOR, para mostrarla antes de guardar. Es
 * la razón de que el formulario exista: el Auditor no está cargando una
 * cantidad, está cerrando una brecha.
 *
 * Se mide contra `stockDeLaMedicion`, NO contra `item.stockErp`: desde que
 * cada reconteo baja su propio stock, el de la ronda 1 es la vara de la
 * primera pasada. El ajuste escribe sobre la última ronda, que es la misma
 * contra la que ya se calculó `diferenciaUnidades`, así que la vara no cambia.
 *
 * `null` = no hay con qué comparar. Nunca 0: un cero diría "cuadra exacto".
 */
export function diferenciaDelAjuste(item: ItemDeLaMatriz, valorNuevo: number): number | null {
  const stock = item.stockDeLaMedicion.stockErp
  return stock === null ? null : valorNuevo - stock
}

/**
 * LOS ÍTEMS QUE EL AJUSTE PUEDE CAMBIAR DE VERDAD: los que no cuadran.
 *
 * `empresa` entra junto con `falta`: tiene diferencia real, solo cambia quién
 * la absorbe. Los `sin_erp` y `sin_contar` quedan afuera de este filtro porque
 * no se puede afirmar nada sobre ellos — siguen estando en "Todos".
 */
export function sinCuadrar(items: readonly ItemDeLaMatriz[]): ItemDeLaMatriz[] {
  return items.filter((i) => i.veredicto === 'falta' || i.veredicto === 'empresa')
}

/**
 * ---------------------------------------------------------------------------
 * CÓDIGO → `productoId` DE LA ÚLTIMA RONDA
 * ---------------------------------------------------------------------------
 * El mismo artículo es un `Producto` DISTINTO en cada hoja de cada ronda; el
 * puente entre rondas es el CÓDIGO. La matriz devuelve el id de la RONDA 1 y
 * `ajustarConteo` exige el de la última, así que mandar el de la matriz da 404
 * en todo inventario con más de una ronda (ver `ajusteApi.ts`).
 *
 * Quien no esté en el mapa no entró en la última ronda: no es ajustable.
 */
export function productoIdPorCodigo(
  hojas: readonly { productos: readonly { id: number; codigo: string }[] }[],
): Map<string, number> {
  const porCodigo = new Map<string, number>()
  for (const hoja of hojas) {
    for (const producto of hoja.productos) porCodigo.set(producto.codigo, producto.id)
  }
  return porCodigo
}
