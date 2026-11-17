import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { identificarAprobador } from './consumo-interno.auth';
import { emitirTokenDev, ingresoDevHabilitado, verificarTokenDev } from './consumo-interno.dev';

const IDENTIDAD = { CONSUMO_DEV_APROBADOR_CUENTA: 'Elizabeth@Prueba.pe', CONSUMO_DEV_APROBADOR_NOMBRE: 'Elizabeth (prueba)' };
const ABIERTO = { NODE_ENV: 'development', CONSUMO_INGRESO_DEV: '1', ...IDENTIDAD };
const AHORA = 1_790_000_000;

describe('ingreso de desarrollo: doble candado', () => {
  it('en produccion NO se enciende aunque el flag este puesto', () => {
    const produccion = { ...ABIERTO, NODE_ENV: 'production' };
    expect(ingresoDevHabilitado(produccion)).toBe(false);
    expect(() => emitirTokenDev(produccion)).toThrow(/deshabilitado/);
  });

  it('fuera de produccion tampoco, si nadie puso el flag', () => {
    expect(ingresoDevHabilitado({ NODE_ENV: 'development', ...IDENTIDAD })).toBe(false);
    expect(ingresoDevHabilitado({ NODE_ENV: 'development', CONSUMO_INGRESO_DEV: 'true', ...IDENTIDAD })).toBe(false);
  });

  it('un token emitido con el candado abierto deja de valer si el servidor pasa a produccion', () => {
    const { token } = emitirTokenDev(ABIERTO, AHORA);
    expect(verificarTokenDev(token, ABIERTO, AHORA)).toEqual({ cuenta: 'elizabeth@prueba.pe', nombre: 'Elizabeth (prueba)' });
    expect(verificarTokenDev(token, { ...ABIERTO, NODE_ENV: 'production' }, AHORA)).toBeNull();
  });

  it('rechaza un token alterado, uno vencido y uno firmado con otra clave', () => {
    const { token } = emitirTokenDev(ABIERTO, AHORA);
    const [prefijoYDatos, firma] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
    const otraCuenta = Buffer.from(JSON.stringify({ cuenta: 'intruso@x.pe', nombre: 'X', exp: AHORA + 100 })).toString('base64url');
    expect(verificarTokenDev(`dev.${otraCuenta}.${firma}`, ABIERTO, AHORA)).toBeNull();
    expect(verificarTokenDev(`${prefijoYDatos}.${firma}`, ABIERTO, AHORA + 9 * 3600)).toBeNull();
    expect(verificarTokenDev(token, ABIERTO, AHORA, randomBytes(32))).toBeNull();
  });

  it('la identidad es la configurada: falta la cuenta, no se emite nada', () => {
    expect(() => emitirTokenDev({ NODE_ENV: 'development', CONSUMO_INGRESO_DEV: '1' })).toThrow(/CUENTA/);
  });

  it('el middleware rechaza el token de desarrollo con el candado cerrado', async () => {
    const { token } = emitirTokenDev(ABIERTO);
    await expect(identificarAprobador(`Bearer ${token}`, ABIERTO)).resolves.toMatchObject({ origen: 'desarrollo' });
    await expect(identificarAprobador(`Bearer ${token}`, { ...ABIERTO, NODE_ENV: 'production' })).rejects.toMatchObject({ status: 401 });
  });
});
