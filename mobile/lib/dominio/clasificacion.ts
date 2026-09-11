/**
 * Lógica pura de la pantalla de Clasificación de productos (Auditor). Aparte
 * del JSX por lo de siempre: son reglas con casos que importan (¿la decisión
 * del Auditor cambia lo de Dynamics o coincide?, ¿quedan páginas por traer?) y
 * dentro del render no se prueban.
 */

import type { Clasificacion, ProductoClasificable, ResponsableDynamics } from '../puertos/repositorios';

/** Lo que dice Dynamics, en texto para la pantalla. */
export function textoResponsableDynamics(r: ResponsableDynamics): string {
  if (r === 'empresa') return 'Empresa';
  if (r === 'empleado') return 'Empleado';
  return 'Sin dato';
}

export type EstadoClasificacion =
  /** El Auditor no puso excepción: manda Dynamics. */
  | { tipo: 'sin-clasificar' }
  /** El Auditor decidió LO MISMO que Dynamics: no cambia la cuenta. */
  | { tipo: 'coincide'; esEmpresa: boolean }
  /** El Auditor CAMBIÓ lo de Dynamics (la cerveza): mueve la liquidación. */
  | { tipo: 'excepcion'; esEmpresa: boolean };

/**
 * Cruza lo que dice Dynamics con lo que decidió el Auditor. La distinción
 * `coincide`/`excepcion` es la que le importa a Gilmer: una excepción cambia a
 * quién se le descuenta el faltante; una coincidencia es redundante. Cuando
 * Dynamics no tiene dato (`null`) cualquier decisión es excepción: no había
 * nada con qué coincidir.
 */
export function estadoClasificacion(p: ProductoClasificable): EstadoClasificacion {
  if (p.clasificacion === null) return { tipo: 'sin-clasificar' };
  const esEmpresa = p.clasificacion.esEmpresa;
  const dynamicsConocido = p.responsableDynamics !== null;
  const coincide = dynamicsConocido && esEmpresa === (p.responsableDynamics === 'empresa');
  return { tipo: coincide ? 'coincide' : 'excepcion', esEmpresa };
}

/** ¿Quedan productos por traer del catálogo? (paginado de ~11.800). */
export function hayMasPorCargar(cargados: number, total: number): boolean {
  return cargados < total;
}

/**
 * Actualiza (o limpia, con `null`) la clasificación de UN código en la lista ya
 * cargada, sin recargar todo. Devuelve un arreglo NUEVO: la pantalla re-renderiza
 * solo esa fila y no vuelve a pedir las ~11.800.
 */
export function aplicarClasificacion(
  productos: ProductoClasificable[],
  codigo: string,
  clasificacion: Clasificacion | null,
): ProductoClasificable[] {
  return productos.map((p) => (p.codigo === codigo ? { ...p, clasificacion } : p));
}

/** Deja solo los que tienen excepción -- para el filtro "solo clasificados" tras desclasificar en pantalla. */
export function soloConClasificacion(productos: ProductoClasificable[]): ProductoClasificable[] {
  return productos.filter((p) => p.clasificacion !== null);
}
