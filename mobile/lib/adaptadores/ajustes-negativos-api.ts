/**
 * Adaptador HTTP de la importación del Excel de ajustes de Dynamics contra
 * backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts (e39b370).
 * Solo lo usa el Auditor -- el backend responde 403 al resto
 * (liquidacion.permisos.ts).
 *
 * CONTRATO (verificado contra el service del backend):
 *   GET   /api/liquidacion/inventarios/:id/ajustes
 *         → EstadoAjustesDto -- se usa SOLO `montoNegativos` acá; el resto
 *           (montoFaltanteEmpresa, nota) es de liquidacion.tsx, no de esta
 *           pantalla.
 *   POST  /api/liquidacion/inventarios/:id/ajustes-negativos/preview
 *         body = el .xlsx CRUDO → ResultadoLecturaAjustes. Nunca persiste.
 *   POST  /api/liquidacion/inventarios/:id/ajustes-negativos/confirmar?nombreArchivo=...
 *         body = el .xlsx CRUDO → { importacionId, ..., montoNegativos }.
 *   PATCH /api/liquidacion/inventarios/:id/ajustes-negativos/lineas/:lineaId/excluir
 *   PATCH /api/liquidacion/inventarios/:id/ajustes-negativos/lineas/:lineaId/incluir
 *         body { motivo } → { montoNegativos, linea }.
 *
 * NO hay adaptador en memoria: importar un archivo de mentira fabricaría
 * justo el dato que decide cuánto se le descuenta a once personas -- mismo
 * criterio que clasificacion-api.ts/historial-api.ts.
 *
 * El .xlsx viaja como BINARIO crudo (`cuerpoBinario` en _http.ts), no como
 * JSON: el backend lo lee con `express.raw()`
 * (liquidacion.routes.ts#cuerpoExcel), no con `express.json()`.
 */

import type {
  LineaAjusteNegativoRechazada,
  LineaAjusteNegativoValida,
  MotivoAdvertenciaLinea,
  MotivoRechazoLinea,
  ResultadoPreviewAjustesNegativos,
} from '../dominio/ajustes-negativos';
import { pedir } from './_http';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function base(inventarioId: number): string {
  return `/api/liquidacion/inventarios/${inventarioId}/ajustes-negativos`;
}

export interface EstadoAjustesNegativos {
  /** `null` = todavía no se importó nada (bloquea liquidar). `0` = se importó y no había líneas útiles. */
  montoNegativos: number | null;
}

export interface ConfirmarAjustesNegativosResultado {
  importacionId: number;
  inventarioId: number;
  nombreArchivo: string;
  importadoEn: string;
  cantidadValidas: number;
  cantidadRechazadas: number;
  montoNegativos: number;
}

export interface LineaAjusteNegativoDto {
  id: number;
  fila: number;
  codigo: string;
  descripcion: string;
  importe: number;
  excluida: boolean;
  motivoExclusion: string | null;
  excluidaPor: { id: number; nombre: string } | null;
  excluidaEn: string | null;
}

export interface ResultadoAlternarLinea {
  montoNegativos: number;
  linea: LineaAjusteNegativoDto;
}

/** Formas crudas del backend, para los tipos de `previsualizar` (ver liquidacion.ajustes-dynamics.ts). */
interface LineaValidaDto {
  fila: number;
  codigo: string;
  nombre2: string;
  importe: number;
  motivoAjuste: string;
  responsable: string;
  advertencias: MotivoAdvertenciaLinea[];
}
interface LineaRechazadaDto {
  fila: number;
  motivo: MotivoRechazoLinea;
}
type PreviewDto =
  | { ok: true; validas: LineaValidaDto[]; rechazadas: LineaRechazadaDto[]; totalImporte: number }
  | { ok: false; motivo: 'columna-faltante' | 'archivo-invalido'; detalle: string };

function aLineaValida(dto: LineaValidaDto): LineaAjusteNegativoValida {
  return {
    fila: dto.fila,
    codigo: dto.codigo,
    nombre2: dto.nombre2,
    importe: dto.importe,
    motivoAjuste: dto.motivoAjuste,
    responsable: dto.responsable,
    advertencias: dto.advertencias,
  };
}

function aLineaRechazada(dto: LineaRechazadaDto): LineaAjusteNegativoRechazada {
  return { fila: dto.fila, motivo: dto.motivo };
}

export const ajustesNegativosApi = {
  async estado(inventarioId: number): Promise<EstadoAjustesNegativos> {
    const dto = await pedir<{ montoNegativos: number | null }>(`/api/liquidacion/inventarios/${inventarioId}/ajustes`);
    return { montoNegativos: dto.montoNegativos };
  },

  async previsualizar(inventarioId: number, archivo: Uint8Array): Promise<ResultadoPreviewAjustesNegativos> {
    const dto = await pedir<PreviewDto>(`${base(inventarioId)}/preview`, {
      metodo: 'POST',
      cuerpoBinario: archivo,
      tipoCuerpo: TIPO_XLSX,
    });
    if (!dto.ok) return dto;
    return {
      ok: true,
      validas: dto.validas.map(aLineaValida),
      rechazadas: dto.rechazadas.map(aLineaRechazada),
      totalImporte: dto.totalImporte,
    };
  },

  async confirmar(
    inventarioId: number,
    archivo: Uint8Array,
    nombreArchivo: string,
  ): Promise<ConfirmarAjustesNegativosResultado> {
    return pedir<ConfirmarAjustesNegativosResultado>(
      `${base(inventarioId)}/confirmar?nombreArchivo=${encodeURIComponent(nombreArchivo)}`,
      { metodo: 'POST', cuerpoBinario: archivo, tipoCuerpo: TIPO_XLSX },
    );
  },

  async excluirLinea(inventarioId: number, lineaId: number, motivo: string): Promise<ResultadoAlternarLinea> {
    return pedir<ResultadoAlternarLinea>(`${base(inventarioId)}/lineas/${lineaId}/excluir`, {
      metodo: 'PATCH',
      cuerpo: { motivo },
    });
  },

  async incluirLinea(inventarioId: number, lineaId: number, motivo: string): Promise<ResultadoAlternarLinea> {
    return pedir<ResultadoAlternarLinea>(`${base(inventarioId)}/lineas/${lineaId}/incluir`, {
      metodo: 'PATCH',
      cuerpo: { motivo },
    });
  },
};
