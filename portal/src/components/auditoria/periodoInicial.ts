import type { Periodo, ResumenDeLaCadena } from '../../tipos'

/**
 * Cuántos períodos se revisan como máximo al entrar, contando el de hoy: el
 * mes en curso y los once anteriores. Un año entero alcanza para el caso real
 * (se cuenta todos los meses) y acota la búsqueda de una base sin inventarios.
 */
export const PERIODOS_A_REVISAR = 12

export function periodoAnterior(p: Periodo): Periodo {
  return p.mes === 1 ? { anio: p.anio - 1, mes: 12 } : { anio: p.anio, mes: p.mes - 1 }
}

/**
 * EL PERÍODO CON EL QUE ABRE EL PANEL: el más reciente con al menos una tienda
 * con inventario, buscando hacia atrás desde `desde`.
 *
 * El inventario se cuenta a fin de mes, así que el mes en curso casi siempre
 * está vacío: abrir en él es recibir al auditor con once "Sin inventario".
 *
 * No hay endpoint que liste los períodos con inventario, así que se pregunta
 * a la cadena mes por mes: DE A UNO (nunca en paralelo, para no disparar doce
 * pedidos juntos) y cortando en el primero que traiga datos. La respuesta que
 * corta la búsqueda es la misma que se pinta, sin pedirla otra vez.
 *
 * Si ninguno de los revisados tiene datos devuelve el resumen de `desde`, que
 * fue el primero en llegar: la tabla dice lo que ya decía para el mes en curso.
 * `null` solo si `cancelado` cortó la búsqueda. Un error de la red se propaga
 * y la corta: tapar la falla con el mes vacío sería un dato inventado.
 */
export async function buscarPeriodoInicial(
  desde: Periodo,
  pedir: (p: Periodo) => Promise<ResumenDeLaCadena>,
  cancelado: () => boolean = () => false,
): Promise<ResumenDeLaCadena | null> {
  let delMesEnCurso: ResumenDeLaCadena | null = null
  let periodo = desde
  for (let i = 0; i < PERIODOS_A_REVISAR; i++) {
    const resumen = await pedir(periodo)
    if (cancelado()) return null
    if (resumen.total.conInventario > 0) return resumen
    delMesEnCurso ??= resumen
    periodo = periodoAnterior(periodo)
  }
  return delMesEnCurso
}
