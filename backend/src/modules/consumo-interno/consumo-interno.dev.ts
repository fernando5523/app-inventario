/**
 * INGRESO DE DESARROLLO para el aprobador -- SOLO para probar en el emulador
 * mientras no exista la app registrada en Entra ID.
 *
 * DOBLE CANDADO, y los dos se miran en CADA uso, no solo al arrancar:
 *   1. NODE_ENV distinto de `production`.
 *   2. CONSUMO_INGRESO_DEV=1 puesto a proposito.
 * En produccion no hay combinacion de variables que lo encienda: el primer
 * candado lo apaga aunque alguien deje el flag puesto. Lo prueba
 * consumo-interno.dev.test.ts.
 *
 * La identidad que emite es FIJA (CONSUMO_DEV_APROBADOR_CUENTA / _NOMBRE): no
 * se acepta del cliente. El token se firma con una clave aleatoria que vive
 * solo en la memoria de este proceso: reiniciar el servidor invalida todos.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type Entorno = Record<string, string | undefined>;

export const PREFIJO_TOKEN_DEV = 'dev.';
const DURACION_S = 8 * 60 * 60;
const CLAVE_PROCESO = randomBytes(32);

export interface IdentidadDev {
  cuenta: string;
  nombre: string;
}

export function ingresoDevHabilitado(env: Entorno = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.CONSUMO_INGRESO_DEV === '1';
}

/** La identidad configurada para el ingreso de desarrollo, o null si falta. */
export function identidadDev(env: Entorno = process.env): IdentidadDev | null {
  const cuenta = (env.CONSUMO_DEV_APROBADOR_CUENTA ?? '').trim().toLowerCase();
  if (cuenta === '') return null;
  return { cuenta, nombre: (env.CONSUMO_DEV_APROBADOR_NOMBRE ?? '').trim() || cuenta };
}

function firmar(datos: string, clave: Buffer): string {
  return createHmac('sha256', clave).update(datos).digest('base64url');
}

/** Emite el token. Tira si el candado esta cerrado: nunca se emite "por si acaso". */
export function emitirTokenDev(
  env: Entorno = process.env,
  ahoraS: number = Math.floor(Date.now() / 1000),
  clave: Buffer = CLAVE_PROCESO,
): { token: string; identidad: IdentidadDev; venceEn: string } {
  if (!ingresoDevHabilitado(env)) throw new Error('El ingreso de desarrollo esta deshabilitado.');
  const identidad = identidadDev(env);
  if (identidad === null) throw new Error('Falta CONSUMO_DEV_APROBADOR_CUENTA.');
  const exp = ahoraS + DURACION_S;
  const datos = Buffer.from(JSON.stringify({ ...identidad, exp })).toString('base64url');
  return {
    token: `${PREFIJO_TOKEN_DEV}${datos}.${firmar(datos, clave)}`,
    identidad,
    venceEn: new Date(exp * 1000).toISOString(),
  };
}

/** Verifica un token de desarrollo. null = no vale (candado cerrado, firma mala o vencido). */
export function verificarTokenDev(
  token: string,
  env: Entorno = process.env,
  ahoraS: number = Math.floor(Date.now() / 1000),
  clave: Buffer = CLAVE_PROCESO,
): IdentidadDev | null {
  if (!ingresoDevHabilitado(env) || !token.startsWith(PREFIJO_TOKEN_DEV)) return null;
  const [datos, firma] = token.slice(PREFIJO_TOKEN_DEV.length).split('.');
  if (!datos || !firma) return null;

  const esperada = Buffer.from(firmar(datos, clave));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;

  try {
    const contenido = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8')) as Partial<IdentidadDev> & { exp?: number };
    if (typeof contenido.exp !== 'number' || contenido.exp < ahoraS) return null;
    if (typeof contenido.cuenta !== 'string' || typeof contenido.nombre !== 'string') return null;
    return { cuenta: contenido.cuenta, nombre: contenido.nombre };
  } catch {
    return null;
  }
}
