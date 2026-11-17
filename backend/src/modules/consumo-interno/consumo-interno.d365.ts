/**
 * Cliente OData de Dynamics para la aprobacion de consumo interno.
 *
 * Aparte de `d365EntityService` del inventario por dos razones:
 *   - usa su PROPIA configuracion (consumo-interno.config.ts), con la guarda
 *     contra produccion, porque este cliente escribe;
 *   - el token se pide con un `resource` configurable: el onebox no acepta su
 *     URL como audiencia y el cliente del inventario la manda fija.
 *
 * Las lecturas van con `cross-company=true` y filtro por `dataAreaId`: sin el
 * parametro, Dynamics responde solo la empresa por defecto del usuario de
 * integracion, que no tiene por que ser TRV.
 */

import { Conflicto, ErrorHttp } from '../../shared/errores';
import { leerConfigD365, type ConfigD365Consumo } from './consumo-interno.config';

const MARGEN_RENOVACION_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 60_000;

export const COLECCION_SOLICITUDES = 'TRUInventConsumptionRequests';
export const COLECCION_LINEAS = 'TRUInventConsumptionRequestLines';

/** `'texto'` como literal OData: la comilla simple se duplica. */
export function literalOData(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

/** URL de la accion `DecideLine` enlazada a una solicitud. */
export function rutaAccionDecidir(dataAreaId: string, requestId: string): string {
  return (
    `${COLECCION_SOLICITUDES}(dataAreaId=${literalOData(dataAreaId)},RequestId=${literalOData(requestId)})` +
    '/Microsoft.Dynamics.DataEntities.DecideLine'
  );
}

/**
 * El mensaje util de un error de Dynamics. OData envuelve el error de X++ en
 * `error.innererror.message`; `error.message` suele ser un generico ("An error
 * has occurred."). Se devuelve el mas especifico, sin la traza.
 */
export function mensajeDeErrorD365(cuerpo: string): string {
  try {
    const json = JSON.parse(cuerpo) as {
      error?: { message?: string; innererror?: { message?: string; internalexception?: { message?: string } } };
    };
    const interno = json.error?.innererror;
    const candidato = interno?.internalexception?.message ?? interno?.message ?? json.error?.message ?? '';
    return candidato.replace(/\s+/g, ' ').trim() || cuerpo.slice(0, 300);
  } catch {
    return cuerpo.slice(0, 300);
  }
}

interface RespuestaToken {
  access_token: string;
  token_type: string;
  expires_on: string;
}

export class ClienteD365Consumo {
  private token: { valor: string; venceMs: number; clave: string } | null = null;

  constructor(
    private readonly leerConfig: () => ConfigD365Consumo = () => leerConfigD365(),
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  config(): ConfigD365Consumo {
    return this.leerConfig();
  }

  private async autorizacion(config: ConfigD365Consumo, forzar = false): Promise<string> {
    const clave = `${config.tenantId}|${config.clientId}|${config.resource}`;
    if (!forzar && this.token && this.token.clave === clave && this.token.venceMs - MARGEN_RENOVACION_MS > Date.now()) {
      return this.token.valor;
    }
    const cuerpo = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
      resource: config.resource,
    });
    const respuesta = await this.fetchImpl(`https://login.microsoftonline.com/${config.tenantId}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    });
    if (!respuesta.ok) {
      throw new ErrorHttp(502, `No se pudo autenticar contra Dynamics (${respuesta.status}).`);
    }
    const datos = (await respuesta.json()) as RespuestaToken;
    this.token = {
      valor: `${datos.token_type} ${datos.access_token}`,
      venceMs: Number.parseInt(datos.expires_on, 10) * 1000,
      clave,
    };
    return this.token.valor;
  }

  private async pedir(url: string, init: RequestInit, reintentar = true): Promise<Response> {
    const config = this.config();
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const respuesta = await this.fetchImpl(url, {
        ...init,
        signal: control.signal,
        headers: { ...(init.headers as Record<string, string>), Authorization: await this.autorizacion(config, !reintentar) },
      });
      if (respuesta.status === 401 && reintentar) return this.pedir(url, init, false);
      return respuesta;
    } catch (error) {
      if (error instanceof ErrorHttp) throw error;
      throw new ErrorHttp(502, 'No se pudo conectar con Dynamics. Revisa la conexion e intenta de nuevo.');
    } finally {
      clearTimeout(reloj);
    }
  }

  /** Todas las filas de una coleccion, siguiendo `@odata.nextLink`. */
  async listar<T>(coleccion: string, opciones: { filtro?: string; select?: string } = {}): Promise<T[]> {
    const config = this.config();
    const parametros = new URLSearchParams({ 'cross-company': 'true' });
    if (opciones.filtro) parametros.append('$filter', opciones.filtro);
    if (opciones.select) parametros.append('$select', opciones.select);
    // D365 quiere %20, no `+`.
    let url: string | undefined = `${config.baseUrl}/data/${coleccion}?${parametros.toString().replace(/\+/g, '%20')}`;

    const filas: T[] = [];
    while (url) {
      const respuesta = await this.pedir(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!respuesta.ok) {
        throw new ErrorHttp(502, `Dynamics no devolvio ${coleccion} (${respuesta.status}): ${mensajeDeErrorD365(await respuesta.text())}`);
      }
      const datos = (await respuesta.json()) as { value?: T[]; '@odata.nextLink'?: string };
      filas.push(...(datos.value ?? []));
      url = datos['@odata.nextLink'];
    }
    return filas;
  }

  /**
   * POST a una accion. Un 4xx/5xx con mensaje de negocio (la solicitud ya no
   * esta pendiente, la linea ya se decidio) se devuelve como 409 con ESE
   * mensaje: es un hecho que la persona tiene que leer, no un "intenta de nuevo".
   */
  async accion<T>(ruta: string, cuerpo: Record<string, unknown>): Promise<T> {
    const config = this.config();
    // Sin `cross-company=true` Dynamics no encuentra el registro en una empresa
    // que no es la del usuario de integracion y responde 400 "No resources were
    // found when selecting for update" (medido en el onebox).
    const separador = ruta.includes('?') ? '&' : '?';
    const respuesta = await this.pedir(`${config.baseUrl}/data/${ruta}${separador}cross-company=true`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const texto = await respuesta.text();
    if (!respuesta.ok) {
      // 500 SI es negocio: Dynamics devuelve asi el error() de X++ de la accion.
      if ([502, 503, 504].includes(respuesta.status)) {
        throw new ErrorHttp(502, 'Dynamics no respondio. Intenta de nuevo en unos minutos.');
      }
      throw new Conflicto(mensajeDeErrorD365(texto));
    }
    return (texto === '' ? null : JSON.parse(texto)) as T;
  }
}

export const clienteD365Consumo = new ClienteD365Consumo();
