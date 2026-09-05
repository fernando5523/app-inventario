/**
 * El filtro de Gestión de hojas: con qué valida el Coordinador antes de
 * cerrar la ronda.
 *
 * Decisión del cliente (2026-09-06): un FILTRO, no una notificación. La
 * diferencia importa — una notificación avisa una vez y se va; un filtro deja
 * ver el subconjunto y trabajarlo hasta vaciarlo, que es lo que alguien hace
 * cuando tiene 25 hojas y quiere saber cuáles le faltan.
 *
 * Aparte del JSX por lo mismo que `comparativo-ronda.ts`: son cuatro reglas
 * con bordes, y adentro de un `.filter()` en el render no se puede probar
 * ninguna.
 */

import { avance } from './hoja';
import type { HojaConteo } from './tipos';

export const FILTROS_HOJAS = ['todas', 'sin-finalizar', 'sin-conteo', 'finalizadas'] as const;
export type FiltroHojas = (typeof FILTROS_HOJAS)[number];

export const ETIQUETA_FILTRO: Record<FiltroHojas, string> = {
  todas: 'Todas',
  'sin-finalizar': 'Sin finalizar',
  'sin-conteo': 'Con productos sin conteo',
  finalizadas: 'Finalizadas',
};

/**
 * `sin-conteo` aplica SOLO a hojas NO finalizadas, y no es un detalle.
 *
 * `finalizar` registra 0 en los productos que quedaron sin contar (min-4), o
 * sea que en una hoja cerrada "sin conteo" ya no significa "falta contar
 * esto" sino "se contó como cero, a propósito". Mezclarlas haría que el
 * filtro que sirve para ir a buscar lo que falta devuelva también hojas donde
 * no falta nada — y un filtro que trae ruido deja de usarse.
 *
 * Las cerradas ANTES de ese cambio pueden tener productos sin conteo de
 * verdad; siguen visibles en 'Finalizadas', que es donde se las mira.
 */
export function cumpleFiltro(hoja: HojaConteo, filtro: FiltroHojas): boolean {
  const finalizada = hoja.estado === 'finalizada';

  switch (filtro) {
    case 'todas':
      return true;
    case 'sin-finalizar':
      return !finalizada;
    case 'sin-conteo':
      return !finalizada && avance(hoja).sinConteo > 0;
    case 'finalizadas':
      return finalizada;
  }
}

export function filtrarHojas(hojas: readonly HojaConteo[], filtro: FiltroHojas): HojaConteo[] {
  return hojas.filter((h) => cumpleFiltro(h, filtro));
}

/**
 * Cuántas hojas caen en cada chip, para poder mostrar el número al lado de la
 * etiqueta.
 *
 * Se calcula sobre TODAS las hojas siempre, nunca sobre las ya filtradas: si
 * los contadores cambiaran al elegir un chip, dejarían de servir para decidir
 * a cuál ir.
 */
export function conteoPorFiltro(hojas: readonly HojaConteo[]): Record<FiltroHojas, number> {
  return {
    todas: hojas.length,
    'sin-finalizar': hojas.filter((h) => cumpleFiltro(h, 'sin-finalizar')).length,
    'sin-conteo': hojas.filter((h) => cumpleFiltro(h, 'sin-conteo')).length,
    finalizadas: hojas.filter((h) => cumpleFiltro(h, 'finalizadas')).length,
  };
}

/**
 * "Mostrando 7 de 25 hojas" — y con el filtro en `todas`, "Mostrando 25
 * hojas" a secas: "25 de 25" invita a buscar qué se está ocultando.
 */
export function textoMostrando(visibles: number, total: number, formatoMiles: (n: number) => string): string {
  const plural = total === 1 ? 'hoja' : 'hojas';
  if (visibles === total) return `Mostrando ${formatoMiles(total)} ${plural}`;
  return `Mostrando ${formatoMiles(visibles)} de ${formatoMiles(total)} ${plural}`;
}
