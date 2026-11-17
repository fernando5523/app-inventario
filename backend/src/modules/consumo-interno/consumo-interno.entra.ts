/**
 * Validacion del token de Entra ID con el que entra quien aprueba.
 *
 * Se valida con `node:crypto` y no con una libreria: es una firma RS256 contra
 * las claves publicas del tenant (JWKS), mas cinco chequeos de claims. Escrito
 * aca queda probado de punta a punta con una clave generada en el test, sin
 * red y sin sumar una dependencia que en su version actual solo viene como ESM
 * (este backend compila a CommonJS).
 *
 * Que se exige, y por que cada cosa:
 *   - alg RS256 y `kid` conocido: sin eso, cualquiera firma su propio token.
 *   - `iss` del tenant: un token valido de OTRO tenant no sirve.
 *   - `aud` = la API de esta app: un token de Entra para otra app (Teams,
 *     Outlook) del mismo tenant no sirve.
 *   - `exp`/`nbf` con 60 s de tolerancia de reloj.
 *   - `tid`, si viene, igual al tenant.
 * Que el token sea valido NO alcanza para aprobar: eso lo decide `esAprobador`.
 */

import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

import type { ConfigEntra } from './consumo-interno.config';

const TOLERANCIA_RELOJ_S = 60;

export class TokenInvalido extends Error {}

export interface ClaimsEntra {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  tid?: string;
  name?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
  groups?: string[];
  [clave: string]: unknown;
}

interface CabeceraJwt {
  alg?: string;
  kid?: string;
  typ?: string;
}

function base64UrlABuffer(parte: string): Buffer {
  return Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function leerJson<T>(parte: string): T {
  try {
    return JSON.parse(base64UrlABuffer(parte).toString('utf8')) as T;
  } catch {
    throw new TokenInvalido('El token no se puede leer.');
  }
}

/** Separa el JWT en sus tres partes. No valida nada todavia. */
export function partesDelJwt(token: string): { cabecera: CabeceraJwt; claims: ClaimsEntra; firmado: string; firma: Buffer } {
  const partes = token.split('.');
  if (partes.length !== 3 || partes.some((p) => p === '')) throw new TokenInvalido('El token no tiene formato JWT.');
  const [c, p, f] = partes as [string, string, string];
  return { cabecera: leerJson<CabeceraJwt>(c), claims: leerJson<ClaimsEntra>(p), firmado: `${c}.${p}`, firma: base64UrlABuffer(f) };
}

/** Los dos emisores que Entra usa segun la version del token. */
export function emisoresValidos(tenantId: string): string[] {
  return [`https://login.microsoftonline.com/${tenantId}/v2.0`, `https://sts.windows.net/${tenantId}/`];
}

export type ObtenerClave = (kid: string) => Promise<KeyObject | null>;

/**
 * Verifica firma y claims. Devuelve los claims si todo esta bien; si no, tira
 * `TokenInvalido` con el motivo (que va al log del servidor, no a la pantalla).
 */
export async function verificarTokenEntra(
  token: string,
  config: Pick<ConfigEntra, 'tenantId' | 'audiencias'>,
  obtenerClave: ObtenerClave,
  ahoraS: number = Math.floor(Date.now() / 1000),
): Promise<ClaimsEntra> {
  if (config.tenantId === '' || config.audiencias.length === 0) {
    throw new TokenInvalido('El ingreso con Microsoft no esta configurado (ENTRA_TENANT_ID / ENTRA_API_AUDIENCE).');
  }

  const { cabecera, claims, firmado, firma } = partesDelJwt(token);
  if (cabecera.alg !== 'RS256') throw new TokenInvalido(`Algoritmo no aceptado: ${String(cabecera.alg)}.`);
  if (!cabecera.kid) throw new TokenInvalido('El token no dice con que clave se firmo.');

  const clave = await obtenerClave(cabecera.kid);
  if (clave === null) throw new TokenInvalido('El token esta firmado con una clave que el tenant no publica.');
  if (!verify('RSA-SHA256', Buffer.from(firmado), clave, firma)) throw new TokenInvalido('La firma del token no es valida.');

  if (!claims.iss || !emisoresValidos(config.tenantId).includes(claims.iss)) {
    throw new TokenInvalido('El token no lo emitio el tenant de la empresa.');
  }
  if (claims.tid !== undefined && claims.tid !== config.tenantId) throw new TokenInvalido('El token es de otro tenant.');

  const audiencias = Array.isArray(claims.aud) ? claims.aud : claims.aud !== undefined ? [claims.aud] : [];
  if (!audiencias.some((a) => config.audiencias.includes(a))) throw new TokenInvalido('El token no es para esta aplicacion.');

  if (typeof claims.exp !== 'number' || claims.exp + TOLERANCIA_RELOJ_S < ahoraS) throw new TokenInvalido('El token vencio.');
  if (typeof claims.nbf === 'number' && claims.nbf - TOLERANCIA_RELOJ_S > ahoraS) {
    throw new TokenInvalido('El token todavia no es valido.');
  }
  return claims;
}

/** La cuenta (UPN o correo) de los claims, en minusculas. Vacia si no viene ninguna. */
export function cuentaDeClaims(claims: ClaimsEntra): string {
  return String(claims.preferred_username ?? claims.upn ?? claims.email ?? '').trim().toLowerCase();
}

/**
 * Si esta persona puede aprobar: su cuenta esta en la lista, o pertenece al
 * grupo configurado. Sin lista ni grupo, NADIE aprueba: una configuracion
 * vacia no puede abrir la puerta a todo el tenant.
 */
export function esAprobador(claims: ClaimsEntra, config: Pick<ConfigEntra, 'aprobadores' | 'grupoAprobadores'>): boolean {
  const cuenta = cuentaDeClaims(claims);
  if (cuenta !== '' && config.aprobadores.includes(cuenta)) return true;
  if (config.grupoAprobadores !== '' && Array.isArray(claims.groups)) return claims.groups.includes(config.grupoAprobadores);
  return false;
}

// ---------------------------------------------------------------------------
// Claves publicas del tenant (JWKS), con cache
// ---------------------------------------------------------------------------

interface Jwks {
  keys?: Array<JsonWebKey & { kid?: string }>;
}

/** No se vuelve a pedir el JWKS por un `kid` desconocido mas de una vez cada 5 minutos. */
const ESPERA_ENTRE_RECARGAS_MS = 5 * 60 * 1000;

/**
 * Proveedor de claves para `verificarTokenEntra`. Las cachea por `kid` y
 * recarga cuando aparece una que no conoce (Entra rota claves), con un tope
 * para que tokens basura no conviertan cada request en un pedido a Microsoft.
 */
export function crearProveedorDeClaves(
  tenantId: string,
  pedir: (url: string) => Promise<Jwks> = async (url) => (await fetch(url)).json() as Promise<Jwks>,
  ahoraMs: () => number = Date.now,
): ObtenerClave {
  const claves = new Map<string, KeyObject>();
  let ultimaRecarga: number | null = null;

  const recargar = async (): Promise<void> => {
    ultimaRecarga = ahoraMs();
    const jwks = await pedir(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`);
    for (const jwk of jwks.keys ?? []) {
      if (!jwk.kid) continue;
      try {
        claves.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        // Una clave que no se puede importar no invalida a las otras.
      }
    }
  };

  return async (kid) => {
    const enCache = claves.get(kid);
    if (enCache) return enCache;
    if (ultimaRecarga !== null && ahoraMs() - ultimaRecarga < ESPERA_ENTRE_RECARGAS_MS) return null;
    await recargar();
    return claves.get(kid) ?? null;
  };
}
