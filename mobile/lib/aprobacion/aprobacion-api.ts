/**
 * Adaptador HTTP de la aprobación de consumo interno. Usa el mismo `pedir`
 * que el resto de la app (timeout, reintentos solo en lecturas, traducción de
 * errores), con el token PROPIO de la aprobadora (`token`), nunca el del PIN.
 */

import { ErrorApi, esErrorApi, pedir } from '../adaptadores/_http';
import type { Aprobador, FiltrosHistorial, Pendientes, ResultadoDecisionMasiva, SolicitudDetalle, SolicitudResumen } from './tipos';

const BASE = '/api/consumo-interno';

export function ingresoDePrueba(): Promise<{ token: string; aprobador: Aprobador }> {
  return pedir(`${BASE}/sesion-dev`, { metodo: 'POST', sinSesion: true });
}

export function quienSoy(token: string): Promise<{ aprobador: Aprobador }> {
  return pedir(`${BASE}/yo`, { token });
}

export function traerPendientes(token: string): Promise<Pendientes> {
  return pedir(`${BASE}/solicitudes/pendientes`, { token, msTimeout: 60_000 });
}

export function traerHistorial(token: string, filtros: FiltrosHistorial): Promise<{ solicitudes: SolicitudResumen[] }> {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) if (valor) params.append(clave, String(valor));
  const consulta = params.toString();
  return pedir(`${BASE}/solicitudes/historial${consulta ? `?${consulta}` : ''}`, { token, msTimeout: 60_000 });
}

export function traerSolicitud(token: string, id: string): Promise<SolicitudDetalle> {
  return pedir(`${BASE}/solicitudes/${encodeURIComponent(id)}`, { token, msTimeout: 60_000 });
}

/**
 * Decidir puede tardar: si es la última línea, Dynamics crea y registra el
 * diario en el mismo pedido. Por eso el timeout es largo y hay UN solo
 * intento (es una escritura: repetirla a ciegas podría decidir dos veces).
 */
const MS_DECIDIR = 3 * 60_000;

export function decidirLinea(token: string, id: string, linea: number, aprobar: boolean, comentario: string): Promise<SolicitudDetalle> {
  return pedir(`${BASE}/solicitudes/${encodeURIComponent(id)}/lineas/${linea}/decision`, {
    token,
    metodo: 'POST',
    cuerpo: { aprobar, ...(comentario.trim() !== '' ? { comentario: comentario.trim() } : {}) },
    msTimeout: MS_DECIDIR,
    msPresupuesto: MS_DECIDIR,
  });
}

export function decidirTodas(token: string, id: string, aprobar: boolean, comentario: string): Promise<ResultadoDecisionMasiva> {
  return pedir(`${BASE}/solicitudes/${encodeURIComponent(id)}/decision`, {
    token,
    metodo: 'POST',
    cuerpo: { aprobar, ...(comentario.trim() !== '' ? { comentario: comentario.trim() } : {}) },
    msTimeout: MS_DECIDIR * 2,
    msPresupuesto: MS_DECIDIR * 2,
  });
}

/**
 * El texto para la aprobadora. El mensaje genérico de sesión vencida del
 * resto de la app habla del PIN, que acá no existe; y un 409 trae el hecho
 * de negocio que Dynamics explicó ("ya no está pendiente"), que se muestra tal cual.
 */
export function mensajeParaAprobadora(error: unknown): string {
  if (!esErrorApi(error)) return 'Algo salió mal. Intenta de nuevo.';
  const e: ErrorApi = error;
  switch (e.clase) {
    case 'sesion-vencida':
      return 'Tu sesión venció. Ingresa de nuevo con tu cuenta.';
    case 'sin-permiso':
    case 'conflicto':
    case 'no-encontrado':
    case 'validacion':
      return e.mensajeServidor ?? e.message;
    default:
      return e.message;
  }
}

/** `true` si el error significa que hay que volver a ingresar. */
export function esSesionVencida(error: unknown): boolean {
  return esErrorApi(error) && error.clase === 'sesion-vencida';
}
