/**
 * Aprobacion de consumo interno: lo que lee y lo que decide la aprobadora.
 *
 * La regla de negocio vive en Dynamics, no aca: la accion `DecideLine` valida
 * que la solicitud siga pendiente y, cuando se decide la ultima linea, crea y
 * registra el diario B_AS_CON (o deja "Error al registrar" con el motivo, que
 * resuelve Joselin). Este servicio solo traduce y ordena; los chequeos previos
 * existen para dar un mensaje claro antes de ir a Dynamics, no para
 * reemplazar los de alla.
 */

import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { IdentidadAprobador } from './consumo-interno.auth';
import { COLECCION_LINEAS, COLECCION_SOLICITUDES, clienteD365Consumo, literalOData, rutaAccionDecidir, type ClienteD365Consumo } from './consumo-interno.d365';
import {
  aLinea,
  aResumen,
  coincideTexto,
  filtroHistorial,
  filtroPendientes,
  ordenarHistorial,
  ordenarPendientes,
  type FiltrosHistorial,
  type LineaD365,
  type SolicitudD365,
  type SolicitudDetalleDto,
  type SolicitudResumenDto,
} from './consumo-interno.dominio';

export interface PendientesDto {
  solicitudes: SolicitudResumenDto[];
  /** Cuantas esperan 24 horas o mas: el recordatorio. */
  demoradas: number;
}

export async function listarPendientes(cliente: ClienteD365Consumo = clienteD365Consumo, ahora = new Date()): Promise<PendientesDto> {
  const { dataAreaId } = cliente.config();
  const filas = await cliente.listar<SolicitudD365>(COLECCION_SOLICITUDES, { filtro: filtroPendientes(dataAreaId) });
  const solicitudes = ordenarPendientes(filas.map((f) => aResumen(f, ahora)));
  return { solicitudes, demoradas: solicitudes.filter((s) => s.demorada).length };
}

export async function listarHistorial(
  filtros: FiltrosHistorial,
  cliente: ClienteD365Consumo = clienteD365Consumo,
  ahora = new Date(),
): Promise<SolicitudResumenDto[]> {
  const { dataAreaId } = cliente.config();
  const filas = await cliente.listar<SolicitudD365>(COLECCION_SOLICITUDES, { filtro: filtroHistorial(dataAreaId, filtros) });
  return ordenarHistorial(filas.map((f) => aResumen(f, ahora)).filter((s) => coincideTexto(s, filtros.texto)));
}

export async function obtener(id: string, cliente: ClienteD365Consumo = clienteD365Consumo, ahora = new Date()): Promise<SolicitudDetalleDto> {
  const { dataAreaId } = cliente.config();
  const clave = `dataAreaId eq ${literalOData(dataAreaId)} and RequestId eq ${literalOData(id)}`;
  const [cabeceras, lineas] = await Promise.all([
    cliente.listar<SolicitudD365>(COLECCION_SOLICITUDES, { filtro: clave }),
    cliente.listar<LineaD365>(COLECCION_LINEAS, { filtro: clave }),
  ]);
  const cabecera = cabeceras[0];
  if (cabecera === undefined) throw new NoEncontrado(`No se encontro la solicitud ${id}.`);
  return {
    ...aResumen(cabecera, ahora),
    lineas: lineas.map(aLinea).sort((a, b) => a.linea - b.linea),
  };
}

export interface Decision {
  aprobar: boolean;
  comentario?: string | undefined;
}

async function llamarDecidir(
  cliente: ClienteD365Consumo,
  id: string,
  linea: number,
  decision: Decision,
  aprobador: IdentidadAprobador,
): Promise<void> {
  const { dataAreaId } = cliente.config();
  await cliente.accion<unknown>(rutaAccionDecidir(dataAreaId, id), {
    _lineNumber: linea,
    _approve: decision.aprobar,
    _comment: (decision.comentario ?? '').trim(),
    _approverAccount: aprobador.cuenta,
    _approverName: aprobador.nombre,
  });
}

/** Decide una linea y devuelve la solicitud como quedo (con el resultado del registro si era la ultima). */
export async function decidirLinea(
  id: string,
  linea: number,
  decision: Decision,
  aprobador: IdentidadAprobador,
  cliente: ClienteD365Consumo = clienteD365Consumo,
): Promise<SolicitudDetalleDto> {
  const actual = await obtener(id, cliente);
  if (actual.estado !== 'pendiente') throw new Conflicto(`La solicitud ${id} ya no esta pendiente de aprobacion.`);
  const fila = actual.lineas.find((l) => l.linea === linea);
  if (fila === undefined) throw new NoEncontrado(`La solicitud ${id} no tiene el producto de la linea ${linea}.`);
  if (fila.decision !== 'pendiente') throw new Conflicto(`El producto ${fila.codigo} ya fue ${fila.decision}.`);

  await llamarDecidir(cliente, id, linea, decision, aprobador);
  return obtener(id, cliente);
}

export interface ResultadoDecisionMasiva {
  solicitud: SolicitudDetalleDto;
  decididas: number;
  /** Si una linea fallo, el motivo; las anteriores quedaron decididas. */
  error: string | null;
}

/**
 * Aprueba o rechaza todas las lineas que siguen pendientes, una por una y en
 * orden. Se para en la primera que Dynamics rechace: las ya decididas quedan
 * firmes (cada `DecideLine` es su propia transaccion) y la pantalla muestra
 * cuales faltan, en vez de fingir que no paso nada.
 */
export async function decidirPendientes(
  id: string,
  decision: Decision,
  aprobador: IdentidadAprobador,
  cliente: ClienteD365Consumo = clienteD365Consumo,
): Promise<ResultadoDecisionMasiva> {
  const actual = await obtener(id, cliente);
  if (actual.estado !== 'pendiente') throw new Conflicto(`La solicitud ${id} ya no esta pendiente de aprobacion.`);

  let decididas = 0;
  let error: string | null = null;
  for (const fila of actual.lineas.filter((l) => l.decision === 'pendiente')) {
    try {
      await llamarDecidir(cliente, id, fila.linea, decision, aprobador);
      decididas += 1;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  return { solicitud: await obtener(id, cliente), decididas, error };
}
