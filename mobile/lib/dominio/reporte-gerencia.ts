/**
 * El REPORTE A GERENCIA dentro de la Liquidación del Auditor: qué muestra la
 * tarjeta y cómo se llama el archivo que se comparte.
 *
 * Vive en dominio y no en el JSX por lo mismo que exportar-diferencias.ts: son
 * ramas con bordes -- "todavía no se liquidó" no es "no hubo productos de la
 * empresa", y ninguna de las dos es "está cargando" -- y dentro de un ternario
 * anidado no se puede probar ninguna.
 */
import type { FilaReporteGerencia, ReporteGerencia } from '../puertos/repositorios';

/**
 * Por qué no hay reporte antes de liquidar. Dice la CAUSA: qué productos son
 * de la empresa recién queda fijo al liquidar (backend
 * liquidacion.reclasificacion.ts). Mostrar dos listas vacías antes de eso
 * se leería como "la empresa no absorbe nada", que es otra afirmación.
 */
export const MOTIVO_SIN_LIQUIDAR =
  'El reporte a gerencia se arma al liquidar: recién ahí queda fijo qué productos son de la empresa. Cuando cierres la planilla, aparece aquí.';

/** Liquidado y sin nada que reportar: es un dato, no un error ni un vacío. */
export const MOTIVO_SIN_PRODUCTOS = 'No hubo productos de la empresa con sobrantes ni faltantes en este inventario.';

export type VistaReporteGerencia =
  | { tipo: 'no-liquidado'; motivo: string }
  | { tipo: 'cargando' }
  | { tipo: 'error'; motivo: string }
  | { tipo: 'sin-productos'; motivo: string }
  | {
      tipo: 'con-datos';
      faltantes: FilaReporteGerencia[];
      sobrantes: FilaReporteGerencia[];
      totalFaltante: number;
      totalSobrante: number;
      /** Cuántos productos no tienen precio en Dynamics: están en la lista pero no suman al total. */
      sinPrecio: number;
    };

export interface EntradaVistaReporte {
  /** `Liquidacion.proyectada`: `true` = la planilla todavía no se cerró. */
  proyectada: boolean;
  reporte: ReporteGerencia | null;
  /** El motivo del servidor, si el pedido falló. */
  error: string | null;
}

export function vistaReporteGerencia({ proyectada, reporte, error }: EntradaVistaReporte): VistaReporteGerencia {
  // Primero, y gana sobre todo lo demás: sin liquidar no hay reporte, aunque
  // haya quedado uno en memoria de la tienda anterior.
  if (proyectada) return { tipo: 'no-liquidado', motivo: MOTIVO_SIN_LIQUIDAR };
  if (error !== null) return { tipo: 'error', motivo: error };
  if (reporte === null) return { tipo: 'cargando' };
  if (reporte.faltantes.length === 0 && reporte.sobrantes.length === 0) {
    return { tipo: 'sin-productos', motivo: MOTIVO_SIN_PRODUCTOS };
  }
  return {
    tipo: 'con-datos',
    faltantes: reporte.faltantes,
    sobrantes: reporte.sobrantes,
    // Los del servidor, no una suma hecha acá: la cuenta que se muestra es la
    // misma que va al Excel.
    totalFaltante: reporte.totalFaltante,
    totalSobrante: reporte.totalSobrante,
    sinPrecio: [...reporte.faltantes, ...reporte.sobrantes].filter((f) => f.monto === null).length,
  };
}

/** Sin precio en Dynamics dice eso: un "S/ 0.00" afirmaría que el producto no vale nada. */
export function textoMontoReporte(monto: number | null, soles: (n: number) => string): string {
  return monto === null ? 'Sin precio' : soles(monto);
}

/**
 * Los totales no incluyen a los productos sin precio (el backend los suma solo
 * con monto), y quien los lee tiene que saberlo: un total que omite algo sin
 * decirlo se lee como completo.
 */
export function textoSinPrecioReporte(cantidad: number): string {
  return cantidad === 1
    ? '1 producto no tiene precio en Dynamics: está en la lista pero no suma al total.'
    : `${cantidad} productos no tienen precio en Dynamics: están en la lista pero no suman al total.`;
}

/** El signo es la segunda vía de la señal, además del color de la fila. */
export function textoUnidadesReporte(tipo: 'faltante' | 'sobrante', unidades: number, miles: (n: number) => string): string {
  return `${tipo === 'faltante' ? '-' : '+'}${miles(unidades)} und`;
}

/**
 * "reporte-gerencia-market-bolivar-2026-08-inv45.xlsx": el MISMO formato que
 * arma el backend (liquidacion.reporte-gerencia.exportar.ts), sin espacios ni
 * tildes porque es lo que viaja por WhatsApp. Se calcula acá, igual que
 * exportar-diferencias.ts: los datos ya están en pantalla y el puerto solo
 * devuelve los bytes.
 */
export function nombreArchivoReporteGerencia(sucursal: string, periodoAnio: number, periodoMes: number, inventarioId: number): string {
  const slugSucursal =
    sucursal
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sucursal';
  const periodo = `${periodoAnio}-${String(periodoMes).padStart(2, '0')}`;
  return `reporte-gerencia-${slugSucursal}-${periodo}-inv${inventarioId}.xlsx`;
}
