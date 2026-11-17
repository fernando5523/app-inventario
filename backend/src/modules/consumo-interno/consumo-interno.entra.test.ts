import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { identificarAprobador } from './consumo-interno.auth';
import { TokenInvalido, crearProveedorDeClaves, esAprobador, verificarTokenEntra } from './consumo-interno.entra';

const TENANT = '11111111-2222-3333-4444-555555555555';
const AUD = 'api://consumo-interno';
const AHORA = 1_790_000_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otra = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

function firmar(claims: Record<string, unknown>, opciones: { kid?: string; alg?: string; clave?: KeyObject } = {}): string {
  const cabecera = b64({ alg: opciones.alg ?? 'RS256', kid: opciones.kid ?? 'k1', typ: 'JWT' });
  const cuerpo = b64(claims);
  const firma = sign('RSA-SHA256', Buffer.from(`${cabecera}.${cuerpo}`), opciones.clave ?? privateKey).toString('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

const validos = {
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  aud: AUD,
  tid: TENANT,
  exp: AHORA + 3600,
  nbf: AHORA - 60,
  name: 'Elizabeth Valverde',
  preferred_username: 'Elizabeth@Empresa.pe',
};
const config = { tenantId: TENANT, audiencias: [AUD] };
const clave = async (kid: string) => (kid === 'k1' ? publicKey : null);

describe('verificarTokenEntra', () => {
  it('acepta un token bien firmado, del tenant y para esta API', async () => {
    const claims = await verificarTokenEntra(firmar(validos), config, clave, AHORA);
    expect(claims.name).toBe('Elizabeth Valverde');
  });

  it('acepta el emisor v1 (sts.windows.net) del mismo tenant', async () => {
    await expect(verificarTokenEntra(firmar({ ...validos, iss: `https://sts.windows.net/${TENANT}/` }), config, clave, AHORA)).resolves.toBeTruthy();
  });

  it.each([
    ['otra audiencia (token de otra app del tenant)', { aud: 'api://otra-app' }],
    ['otro tenant', { iss: 'https://login.microsoftonline.com/otro/v2.0' }],
    ['tid distinto aunque el iss calce', { tid: 'otro' }],
    ['vencido hace mas de un minuto', { exp: AHORA - 61 }],
    ['todavia no valido', { nbf: AHORA + 120 }],
    ['sin exp', { exp: undefined }],
  ])('rechaza: %s', async (_caso, cambio) => {
    await expect(verificarTokenEntra(firmar({ ...validos, ...cambio }), config, clave, AHORA)).rejects.toBeInstanceOf(TokenInvalido);
  });

  it('rechaza la firma de otra clave con el mismo kid', async () => {
    await expect(verificarTokenEntra(firmar(validos, { clave: otra.privateKey }), config, clave, AHORA)).rejects.toThrow(/firma/);
  });

  it('rechaza un kid que el tenant no publica', async () => {
    await expect(verificarTokenEntra(firmar(validos, { kid: 'kx' }), config, clave, AHORA)).rejects.toThrow(/clave/);
  });

  it('rechaza alg distinto de RS256 (incluido "none")', async () => {
    const sinFirma = `${b64({ alg: 'none', kid: 'k1' })}.${b64(validos)}.x`;
    await expect(verificarTokenEntra(sinFirma, config, clave, AHORA)).rejects.toThrow(/Algoritmo/);
  });

  it('rechaza si el ingreso con Microsoft no esta configurado', async () => {
    await expect(verificarTokenEntra(firmar(validos), { tenantId: TENANT, audiencias: [] }, clave, AHORA)).rejects.toThrow(/configurado/);
  });
});

describe('esAprobador', () => {
  it('por cuenta, sin distinguir mayusculas', () => {
    expect(esAprobador(validos, { aprobadores: ['elizabeth@empresa.pe'], grupoAprobadores: '' })).toBe(true);
  });

  it('por grupo', () => {
    expect(esAprobador({ ...validos, groups: ['g1', 'g2'] }, { aprobadores: [], grupoAprobadores: 'g2' })).toBe(true);
  });

  it('sin lista ni grupo configurados, NADIE aprueba', () => {
    expect(esAprobador(validos, { aprobadores: [], grupoAprobadores: '' })).toBe(false);
  });
});

describe('crearProveedorDeClaves', () => {
  it('cachea por kid y no vuelve a pedir el JWKS por un kid desconocido antes de 5 minutos', async () => {
    let pedidos = 0;
    let ahora = 0;
    const jwk = publicKey.export({ format: 'jwk' });
    const proveedor = crearProveedorDeClaves(TENANT, async () => {
      pedidos += 1;
      return { keys: [{ ...jwk, kid: 'k1' }] };
    }, () => ahora);
    expect(await proveedor('k1')).not.toBeNull();
    expect(await proveedor('k1')).not.toBeNull();
    expect(await proveedor('desconocido')).toBeNull();
    expect(pedidos).toBe(1);
    ahora = 6 * 60 * 1000;
    expect(await proveedor('desconocido')).toBeNull();
    expect(pedidos).toBe(2);
  });
});

describe('identificarAprobador (Entra)', () => {
  const env = { ENTRA_TENANT_ID: TENANT, ENTRA_API_AUDIENCE: AUD, CONSUMO_APROBADORES: 'elizabeth@empresa.pe', NODE_ENV: 'production' };
  const vigente = { ...validos, exp: Math.floor(Date.now() / 1000) + 3600, nbf: Math.floor(Date.now() / 1000) - 60 };

  it('la cuenta y el nombre salen del token', async () => {
    const yo = await identificarAprobador(`Bearer ${firmar(vigente)}`, env, clave);
    expect(yo).toEqual({ cuenta: 'elizabeth@empresa.pe', nombre: 'Elizabeth Valverde', origen: 'entra' });
  });

  it('401 sin token y 403 con token valido de alguien que no aprueba', async () => {
    await expect(identificarAprobador(undefined, env, clave)).rejects.toMatchObject({ status: 401 });
    const ajeno = firmar({ ...vigente, preferred_username: 'otro@empresa.pe' });
    await expect(identificarAprobador(`Bearer ${ajeno}`, env, clave)).rejects.toMatchObject({ status: 403 });
  });

  it('401 (no 500) con un token roto', async () => {
    await expect(identificarAprobador('Bearer abc.def.ghi', env, clave)).rejects.toMatchObject({ status: 401 });
  });
});
