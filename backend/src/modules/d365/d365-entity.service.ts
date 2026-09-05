/**
 * Cliente OData de D365, SOLO LECTURA -- a proposito no tiene insert/update/
 * delete ni "createCountingJournal" como el proyecto hermano: el ajuste
 * automatico hacia Dynamics es fase 2 (decision del cliente, ver
 * app/auditor/lacrado.tsx y backend/README.md).
 */

import { ErrorHttp } from '../../shared/errores';
import { d365AuthService } from './d365-auth.service';
import type { ODataQueryOptions, ODataResponse } from './d365.types';

const TAMANO_LOTE_DEFECTO = 500;

/**
 * Particiona `total` registros en paginas de `tamanoLote` (skip/top) --
 * pura, sin red, para poder testear la logica de paginacion sin
 * depender de que D365 responda (ver d365-entity.test.ts).
 */
export function calcularPaginas(total: number, tamanoLote: number): Array<{ skip: number; top: number }> {
  if (total <= 0 || tamanoLote <= 0) return [];
  const paginas: Array<{ skip: number; top: number }> = [];
  for (let skip = 0; skip < total; skip += tamanoLote) {
    paginas.push({ skip, top: Math.min(tamanoLote, total - skip) });
  }
  return paginas;
}

function construirUrl(baseUrl: string, entidad: string, options?: ODataQueryOptions): string {
  let url = `${baseUrl}/${entidad}`;
  const params = new URLSearchParams();
  if (options?.$filter) params.append('$filter', options.$filter);
  if (options?.$select) params.append('$select', options.$select);
  if (options?.$orderby) params.append('$orderby', options.$orderby);
  if (options?.$top !== undefined) params.append('$top', String(options.$top));
  if (options?.$skip !== undefined) params.append('$skip', String(options.$skip));
  const queryString = params.toString().replace(/\+/g, '%20'); // D365 OData quiere %20, no +
  return queryString ? `${url}?${queryString}` : url;
}

export class D365EntityService {
  /** GET con reintento unico si el token vence justo antes de la llamada. */
  private async get<T>(url: string, reintentarSiVenceToken = true): Promise<T> {
    const token = await d365AuthService.getTokenValido();
    const respuesta = await fetch(url, {
      method: 'GET',
      headers: { Authorization: token, Accept: 'application/json' },
    });

    if (respuesta.status === 401 && reintentarSiVenceToken) {
      await d365AuthService.renovarToken();
      return this.get<T>(url, false);
    }

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      throw new ErrorHttp(502, `Error de Dynamics (${respuesta.status}): ${texto}`);
    }

    return respuesta.json() as Promise<T>;
  }

  /** Cuenta total de registros -- primero para saber cuantas paginas hacen falta. */
  async contar(entidad: string, filtro?: string): Promise<number> {
    const url = filtro
      ? `${await d365AuthService.getODataBaseUrl()}/${entidad}/$count?$filter=${encodeURIComponent(filtro)}`
      : `${await d365AuthService.getODataBaseUrl()}/${entidad}/$count`;
    const token = await d365AuthService.getTokenValido();
    const respuesta = await fetch(url, { method: 'GET', headers: { Authorization: token } });
    if (!respuesta.ok) {
      throw new ErrorHttp(502, `No se pudo contar ${entidad} en Dynamics (${respuesta.status}).`);
    }
    const texto = await respuesta.text();
    return parseInt(texto.replace(/\D/g, ''), 10) || 0;
  }

  /**
   * Trae TODOS los registros de una entidad, paginando por lotes de
   * `tamanoLote` (nunca todo de una: con 8.000 items no es opcional, ver
   * el pedido original). Usa `calcularPaginas`, no @odata.nextLink --
   * D365 F&O a veces no lo emite en consultas con $select simple.
   *
   * `onPagina` se llama DESPUES de cada pagina con lo que va acumulado y el
   * total: es lo unico que permite mostrar progreso real mientras esto tarda
   * minutos (ver d365.progreso.ts). Se llama tambien con `(0, total)` apenas
   * se conoce el total, ANTES de la primera pagina -- asi quien sondea deja
   * de ver `total: null` lo antes posible y puede dibujar la barra.
   *
   * Un error dentro de `onPagina` NO corta la bajada: reportar progreso es
   * accesorio, y perder un snapshot de 8.000 items porque falló un contador
   * seria cambiar algo que importa por algo que no.
   */
  async obtenerTodos<T>(
    entidad: string,
    options?: ODataQueryOptions,
    tamanoLote: number = TAMANO_LOTE_DEFECTO,
    onPagina?: (traidos: number, total: number) => void,
  ): Promise<T[]> {
    const total = await this.contar(entidad, options?.$filter);
    if (total === 0) return [];

    const avisar = (traidos: number): void => {
      if (onPagina === undefined) return;
      try {
        onPagina(traidos, total);
      } catch {
        // Ver el comentario de arriba: el progreso nunca voltea la bajada.
      }
    };

    avisar(0);

    const paginas = calcularPaginas(total, tamanoLote);
    // Una sola vez para todas las paginas: la baseUrl no cambia en el medio
    // de una bajada, y el cache del auth service la sirve igual.
    const baseUrl = await d365AuthService.getODataBaseUrl();
    const resultado: T[] = [];
    for (const pagina of paginas) {
      const url = construirUrl(baseUrl, entidad, { ...options, $skip: pagina.skip, $top: pagina.top });
      const respuesta = await this.get<ODataResponse<T>>(url);
      resultado.push(...respuesta.value);
      avisar(resultado.length);
    }
    return resultado;
  }
}

export const d365EntityService = new D365EntityService();
