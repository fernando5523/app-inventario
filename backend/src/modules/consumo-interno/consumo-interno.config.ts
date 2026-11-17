/**
 * Configuracion del modulo de CONSUMO INTERNO (aprobacion de la planilla de
 * "Salida por consumo interno de almacen" desde el telefono).
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO USA `credencialesEfectivas()` DEL RESTO DEL BACKEND
 * ---------------------------------------------------------------------------
 * El inventario lee Dynamics con las credenciales que el Administrador carga
 * en la base (config-dynamics) y esas MANDAN sobre el entorno. Este modulo
 * ESCRIBE en Dynamics: cada aprobacion termina en un diario de ajuste
 * registrado (B_AS_CON). Si heredara aquella configuracion, un backend de
 * desarrollo con la base apuntando a produccion aprobaria contra el ERP real
 * sin que nadie lo note. Por eso tiene su propia configuracion, explicita, y
 * una guarda: fuera de produccion se niega a hablar con un host de produccion.
 *
 * Variables:
 *   CONSUMO_D365_BASE_URL     obligatoria. Ej: https://usnconeboxax1aos.cloud.onebox.dynamics.com
 *   CONSUMO_D365_RESOURCE     el `resource` del token. Default: la base URL.
 *                             El onebox NO acepta su URL como audiencia: ahi va
 *                             `spn:19c88cfe-070d-4425-86dc-176de968c1bf`.
 *   CONSUMO_D365_DATA_AREA_ID empresa. Default: trv.
 *   CONSUMO_D365_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET
 *                             credenciales de la app registrada en Dynamics.
 *                             Si faltan, se usan D365_TENANT_ID / _CLIENT_ID /
 *                             _CLIENT_SECRET (la misma app "Odata TRV"): lo que
 *                             decide CONTRA QUE ERP se habla es la base URL, que
 *                             nunca se hereda.
 *   CONSUMO_D365_HOSTS_PRODUCCION  hosts que se consideran produccion
 *                             (coma). Default: mistr.operations.dynamics.com.
 */

import { ErrorHttp } from '../../shared/errores';

export interface ConfigD365Consumo {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  resource: string;
  dataAreaId: string;
}

type Entorno = Record<string, string | undefined>;

const HOSTS_PRODUCCION_DEFECTO = ['mistr.operations.dynamics.com'];

function limpio(valor: string | undefined): string {
  return (valor ?? '').trim();
}

function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Los hosts que cuentan como ERP de produccion. */
export function hostsDeProduccion(env: Entorno = process.env): string[] {
  const propios = limpio(env.CONSUMO_D365_HOSTS_PRODUCCION)
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  return propios.length > 0 ? propios : HOSTS_PRODUCCION_DEFECTO;
}

/**
 * `true` si la URL apunta a un ERP de produccion. Pura, para probar la guarda
 * sin red. Una URL que no se puede leer cuenta como produccion: ante la duda,
 * no se escribe.
 */
export function esUrlDeProduccion(url: string, env: Entorno = process.env): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return hostsDeProduccion(env).includes(host);
}

/**
 * La configuracion vigente, o un error que dice QUE falta en terminos de la
 * persona que levanta el servidor (no de la que aprueba: a ella le llega un
 * 503 generico, ver el controller).
 */
export function leerConfigD365(env: Entorno = process.env): ConfigD365Consumo {
  const baseUrl = sinBarraFinal(limpio(env.CONSUMO_D365_BASE_URL));
  if (baseUrl === '') {
    throw new ErrorHttp(503, 'La aprobacion de consumo interno no esta configurada: falta CONSUMO_D365_BASE_URL.');
  }

  if (env.NODE_ENV !== 'production' && esUrlDeProduccion(baseUrl, env)) {
    throw new ErrorHttp(
      503,
      'CONSUMO_D365_BASE_URL apunta al Dynamics de produccion y este servidor no corre en produccion. ' +
        'Las aprobaciones registran diarios: en desarrollo se usa el onebox.',
    );
  }

  const tenantId = limpio(env.CONSUMO_D365_TENANT_ID) || limpio(env.D365_TENANT_ID);
  const clientId = limpio(env.CONSUMO_D365_CLIENT_ID) || limpio(env.D365_CLIENT_ID);
  const clientSecret = limpio(env.CONSUMO_D365_CLIENT_SECRET) || limpio(env.D365_CLIENT_SECRET);
  if (tenantId === '' || clientId === '' || clientSecret === '') {
    throw new ErrorHttp(
      503,
      'La aprobacion de consumo interno no tiene credenciales de Dynamics: faltan CONSUMO_D365_TENANT_ID, ' +
        'CONSUMO_D365_CLIENT_ID y CONSUMO_D365_CLIENT_SECRET (o sus equivalentes D365_*).',
    );
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    baseUrl,
    resource: limpio(env.CONSUMO_D365_RESOURCE) || baseUrl,
    dataAreaId: (limpio(env.CONSUMO_D365_DATA_AREA_ID) || 'trv').toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// Entra ID: quien puede aprobar
// ---------------------------------------------------------------------------

export interface ConfigEntra {
  tenantId: string;
  /** Valores aceptados del claim `aud` (el App ID URI y/o el client id de la API). */
  audiencias: string[];
  /** Cuentas (UPN/correo) que pueden aprobar, en minusculas. */
  aprobadores: string[];
  /** Id del grupo de Entra cuyos miembros pueden aprobar. Vacio = no se usa. */
  grupoAprobadores: string;
}

/**
 * ENTRA_TENANT_ID (default: el tenant de las credenciales de Dynamics),
 * ENTRA_API_AUDIENCE (coma), CONSUMO_APROBADORES (coma),
 * CONSUMO_GRUPO_APROBADORES.
 */
export function leerConfigEntra(env: Entorno = process.env): ConfigEntra {
  const lista = (valor: string | undefined): string[] =>
    limpio(valor)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '');

  return {
    tenantId: limpio(env.ENTRA_TENANT_ID) || limpio(env.CONSUMO_D365_TENANT_ID) || limpio(env.D365_TENANT_ID),
    audiencias: lista(env.ENTRA_API_AUDIENCE),
    aprobadores: lista(env.CONSUMO_APROBADORES).map((c) => c.toLowerCase()),
    grupoAprobadores: limpio(env.CONSUMO_GRUPO_APROBADORES),
  };
}
