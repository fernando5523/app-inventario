/**
 * Lógica pura del selector de sucursal del Auditor: ordenar la lista y mapear
 * nombre <-> id. Aparte del componente para poder probarla sin montar la
 * pantalla, y en un solo lugar para las 4 pantallas que lo usan.
 */
import type { Sucursal } from './tipos';

/**
 * Los nombres, ascendente (regla de la skill trujillo-ui, sección Filtros:
 * "ordenadas ascendente, alfabético natural en español"). `numeric: true` por
 * si un nombre lleva número, para que 10 no quede antes que 2.
 */
export function nombresSucursalesOrdenados(sucursales: readonly Sucursal[]): string[] {
  return sucursales.map((s) => s.nombre).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

/** El nombre de la sucursal enfocada, o `null` si no hay id o no existe. */
export function nombreDeSucursal(sucursales: readonly Sucursal[], id: number | null): string | null {
  if (id === null) return null;
  return sucursales.find((s) => s.id === id)?.nombre ?? null;
}

/** El id de la sucursal con ese nombre exacto, o `null` si ninguna coincide. */
export function idDeSucursal(sucursales: readonly Sucursal[], nombre: string): number | null {
  return sucursales.find((s) => s.nombre === nombre)?.id ?? null;
}
