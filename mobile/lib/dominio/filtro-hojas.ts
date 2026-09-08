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

/**
 * "Mostrando 7 de 25 hojas" — y con el filtro en `todas`, "Mostrando 25
 * hojas" a secas: "25 de 25" invita a buscar qué se está ocultando.
 */
export function textoMostrando(visibles: number, total: number, formatoMiles: (n: number) => string): string {
  const plural = total === 1 ? 'hoja' : 'hojas';
  if (visibles === total) return `Mostrando ${formatoMiles(total)} ${plural}`;
  return `Mostrando ${formatoMiles(visibles)} de ${formatoMiles(total)} ${plural}`;
}

/**
 * El filtro MODAL de "Hojas de esta ronda" (Coordinador) -- reemplazó a los
 * chips de un solo criterio (`cumpleFiltro` de arriba sigue siendo la
 * regla de estado, no se duplica). Mismo patrón que `filtro-productos.ts`:
 * un modal, un borrador, "Aplicar" -- ver `ModalFiltrosHojas.tsx`.
 *
 * Persona y número exigen coincidencia EXACTA (se eligen de una lista, no es
 * texto libre); `estado` en `'todas'` es "no filtra por estado".
 */
export interface FiltroHojasModal {
  persona: string | null;
  estado: FiltroHojas;
  numero: string | null;
}

export const FILTRO_HOJAS_MODAL_VACIO: FiltroHojasModal = { persona: null, estado: 'todas', numero: null };

/** Personas distintas entre los asignados de todas las hojas, en el orden en que aparecen. */
export function personasDeHojas(hojas: readonly HojaConteo[]): string[] {
  const vistos = new Set<string>();
  const orden: string[] = [];
  for (const h of hojas) {
    for (const nombre of h.asignados) {
      if (!vistos.has(nombre)) {
        vistos.add(nombre);
        orden.push(nombre);
      }
    }
  }
  return orden;
}

/** Números de hoja tal cual vienen ("002"), en el orden de la lista. */
export function numerosDeHojas(hojas: readonly HojaConteo[]): string[] {
  return hojas.map((h) => h.numero);
}

/** Los tres criterios combinados con Y -- misma regla de estado que `cumpleFiltro`. */
export function cumpleFiltroModal(hoja: HojaConteo, filtro: FiltroHojasModal): boolean {
  return (
    cumpleFiltro(hoja, filtro.estado) &&
    (filtro.persona === null || hoja.asignados.includes(filtro.persona)) &&
    (filtro.numero === null || hoja.numero === filtro.numero)
  );
}

export function filtrarHojasModal(hojas: readonly HojaConteo[], filtro: FiltroHojasModal): HojaConteo[] {
  return hojas.filter((h) => cumpleFiltroModal(h, filtro));
}

/** Estados con al menos una hoja -- nunca 'todas', esa es el "sin filtro" del propio hueco. */
function estadosDeHojas(hojas: readonly HojaConteo[]): FiltroHojas[] {
  return FILTROS_HOJAS.filter((f) => f !== 'todas' && hojas.some((h) => cumpleFiltro(h, f)));
}

function filtrarSinCampo(hojas: readonly HojaConteo[], filtro: FiltroHojasModal, excepto: keyof FiltroHojasModal): HojaConteo[] {
  return filtrarHojasModal(hojas, { ...filtro, [excepto]: FILTRO_HOJAS_MODAL_VACIO[excepto] });
}

/**
 * Los tres selectores del modal EN CASCADA -- mismo pedido del cliente y
 * mismo patrón que `filtro-productos.ts#opcionesEnCascada` (af4810f, min-2):
 * cada campo ofrece solo lo que sigue siendo posible dado lo que ya se
 * eligió en los OTROS DOS (nunca sobre el filtro completo, o el propio
 * campo se quedaría viendo una sola opción: la que ya tiene puesta).
 *
 * `estado` devuelve los valores del ENUM (`FiltroHojas`), no las etiquetas:
 * lo que se muestra es cosa de `ModalFiltrosHojas.tsx`, acá solo se decide
 * QUÉ opciones siguen teniendo sentido.
 */
export function opcionesEnCascada(
  hojas: readonly HojaConteo[],
  filtro: FiltroHojasModal,
): { persona: string[]; estado: FiltroHojas[]; numero: string[] } {
  return {
    persona: personasDeHojas(filtrarSinCampo(hojas, filtro, 'persona')),
    estado: estadosDeHojas(filtrarSinCampo(hojas, filtro, 'estado')),
    numero: numerosDeHojas(filtrarSinCampo(hojas, filtro, 'numero')),
  };
}

/** ¿Existe una hoja que matchee los dos valores a la vez? Los demás campos quedan sin restringir. */
function algunaCoincide(hojas: readonly HojaConteo[], a: Partial<FiltroHojasModal>, b: Partial<FiltroHojasModal>): boolean {
  const combinado: FiltroHojasModal = { ...FILTRO_HOJAS_MODAL_VACIO, ...a, ...b };
  return hojas.some((h) => cumpleFiltroModal(h, combinado));
}

/**
 * Se llama al elegir `valor` para `campo` en el modal. Mismo patrón que
 * `filtro-productos.ts#elegirCampo`: ese campo se pone tal cual -- sale de
 * sus propias opciones en cascada, así que ya es compatible con lo demás.
 * Los OTROS DOS, si su valor actual dejó de tener alguna hoja en común con
 * el recién elegido, se limpian -- nunca se deja un filtro puesto que no
 * corresponde a ninguna fila. Se comparan cada uno CONTRA EL CAMPO QUE
 * CAMBIÓ nada más, no entre sí (mismo motivo que allá: ya eran compatibles
 * entre ellos antes de este cambio).
 *
 * Es EXPLÍCITO por campo (no un loop genérico sobre `keyof FiltroHojasModal`
 * como el de productos) porque acá los tres campos no comparten tipo:
 * `estado` es un enum con su propio "vacío" (`'todas'`), no `string | null`
 * como `persona`/`numero` -- el algoritmo es el mismo, la forma de escribirlo
 * no puede serlo sin perder el tipado.
 */
export function elegirCampo(
  hojas: readonly HojaConteo[],
  filtro: FiltroHojasModal,
  campo: keyof FiltroHojasModal,
  // FiltroHojas es un subtipo de string, así que un valor de `estado` entra
  // igual por acá -- un solo signature alcanza, sin perder tipado en las
  // otras dos llamadas (persona/numero).
  valor: string | null,
): FiltroHojasModal {
  const resultado = { ...filtro, [campo]: valor } as FiltroHojasModal;
  const cambio = { [campo]: valor } as Partial<FiltroHojasModal>;

  const esVacio = valor === FILTRO_HOJAS_MODAL_VACIO[campo];
  if (esVacio) return resultado;

  if (campo !== 'persona' && resultado.persona !== null && !algunaCoincide(hojas, cambio, { persona: resultado.persona })) {
    resultado.persona = null;
  }
  if (campo !== 'estado' && resultado.estado !== 'todas' && !algunaCoincide(hojas, cambio, { estado: resultado.estado })) {
    resultado.estado = 'todas';
  }
  if (campo !== 'numero' && resultado.numero !== null && !algunaCoincide(hojas, cambio, { numero: resultado.numero })) {
    resultado.numero = null;
  }
  return resultado;
}

/** Cuántos de los tres campos están puestos -- el número que muestra el botón "Filtros". */
export function contarFiltrosActivosModal(filtro: FiltroHojasModal): number {
  return (filtro.persona !== null ? 1 : 0) + (filtro.estado !== 'todas' ? 1 : 0) + (filtro.numero !== null ? 1 : 0);
}

/** Qué mostrar como "filtro activo" en el pie de la lista -- `null` cuando no hay ninguno. */
export function textoFiltroModalActivo(filtro: FiltroHojasModal): string | null {
  const partes: string[] = [];
  if (filtro.persona !== null) partes.push(filtro.persona);
  if (filtro.estado !== 'todas') partes.push(ETIQUETA_FILTRO[filtro.estado]);
  if (filtro.numero !== null) partes.push(`Hoja #${filtro.numero}`);
  return partes.length > 0 ? partes.join(' · ') : null;
}
