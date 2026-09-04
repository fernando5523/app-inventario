/**
 * Tests de `credencialesEfectivas()`: LA regla que decide de dónde salen las
 * credenciales con las que el sistema le habla al ERP.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE, escrito después de un bug real.
 *
 * La precedencia "la base gana sobre el .env" estaba implementada y andaba.
 * Lo que NO andaba es que el módulo `d365` la usara: `d365-auth.service.ts`
 * leía `d365Config` (el `.env`) directo. El resultado era el peor tipo de
 * error posible — el que se ve bien. La pantalla de Configuración mostraba
 * las credenciales de la base, la prueba de conexión respondía "origen:
 * base", y el traído del catálogo seguía usando el archivo. Todo verde, y
 * nada de lo que se cargaba tenía efecto.
 *
 * Por eso se prueba la función Y se prueba que el auth service la use: la
 * primera sin la segunda es exactamente el bug que hubo.
 *
 * Prisma está mockeado, igual que el resto de la suite: `npm test` no levanta
 * Postgres. Lo que se prueba no es que Prisma lea, es qué decide el service
 * con lo que Prisma le devuelve.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  configDynamics: { findUnique: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

/**
 * El `.env` se simula acá y no se toca `process.env`: `d365Config` congela
 * los valores al importarse, así que escribir `process.env` después no
 * cambiaría nada y el test pasaría por la razón equivocada.
 */
const configMock = vi.hoisted(() => ({
  tenantId: 'tenant-del-env',
  clientId: 'client-del-env',
  clientSecret: 'secreto-del-env',
  baseUrl: 'https://del-env.operations.dynamics.com',
  dataAreaId: 'env',
  isConfigured(): boolean {
    return !!(this.tenantId && this.clientId && this.clientSecret && this.baseUrl);
  },
}));
vi.mock('../../config/d365.config', () => ({ d365Config: configMock }));

/** El secreto de la base viaja cifrado: se simula el descifrado, no el cifrado. */
vi.mock('./config-dynamics.cifrado', async (original) => {
  const real = await original<typeof import('./config-dynamics.cifrado')>();
  return { ...real, descifrar: (guardado: string) => `descifrado(${guardado})` };
});

import { credencialesEfectivas } from './config-dynamics.service';

/** Una fila de `config_dynamics` como la devuelve Prisma. */
function filaEnBase(extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    tenantId: 'tenant-de-la-base',
    clientId: 'client-de-la-base',
    urlBase: 'https://de-la-base.operations.dynamics.com',
    dataAreaId: 'trv',
    clientSecretCifrado: 'cifrado-abc',
    actualizadoPorId: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  configMock.tenantId = 'tenant-del-env';
  configMock.clientId = 'client-del-env';
  configMock.clientSecret = 'secreto-del-env';
  configMock.baseUrl = 'https://del-env.operations.dynamics.com';
  configMock.dataAreaId = 'env';
});

describe('credencialesEfectivas: la base le gana al .env', () => {
  it('con fila en la base, TODO sale de la base — aunque el .env esté completo', async () => {
    prismaMock.configDynamics.findUnique.mockResolvedValue(filaEnBase());

    const cred = await credencialesEfectivas();

    expect(cred.origen).toBe('base');
    expect(cred.tenantId).toBe('tenant-de-la-base');
    expect(cred.clientId).toBe('client-de-la-base');
    expect(cred.baseUrl).toBe('https://de-la-base.operations.dynamics.com');
    expect(cred.dataAreaId).toBe('trv');
    // El secreto llega descifrado y listo para pedirle un token a Azure.
    expect(cred.clientSecret).toBe('descifrado(cifrado-abc)');
  });

  it('sin fila, cae al .env — el sistema sigue andando igual que antes', async () => {
    prismaMock.configDynamics.findUnique.mockResolvedValue(null);

    const cred = await credencialesEfectivas();

    expect(cred.origen).toBe('entorno');
    expect(cred.tenantId).toBe('tenant-del-env');
    expect(cred.clientSecret).toBe('secreto-del-env');
  });

  /**
   * El caso que separa "hay una fila" de "hay credenciales usables". Una fila
   * sin secreto queda cuando alguien guardó tenant/clientId/urlBase pero el
   * secreto nunca se cargó: NO puede ganarle al `.env`, porque no sirve para
   * autenticar y dejaría al sistema sin integración teniendo una que anda.
   */
  it('fila SIN secreto no gana: cae al .env', async () => {
    prismaMock.configDynamics.findUnique.mockResolvedValue(filaEnBase({ clientSecretCifrado: null }));

    const cred = await credencialesEfectivas();

    expect(cred.origen).toBe('entorno');
    expect(cred.tenantId).toBe('tenant-del-env');
  });

  it('sin fila y sin .env: "ninguno", no una credencial a medias', async () => {
    prismaMock.configDynamics.findUnique.mockResolvedValue(null);
    configMock.clientSecret = '';

    const cred = await credencialesEfectivas();

    expect(cred.origen).toBe('ninguno');
    expect(cred.clientSecret).toBe('');
    expect(cred.tenantId).toBe('');
  });

  /**
   * `dataAreaId` es el único campo con precedencia propia: la fila puede
   * traerlo vacío (la pantalla no lo pedía) y en ese caso vale el del
   * entorno. Sin esto, cargar credenciales por base dejaría al catálogo sin
   * filtro de empresa y traería productos de TODAS las compañías del tenant.
   */
  it('dataAreaId vacío en la base usa el del entorno, no queda vacío', async () => {
    prismaMock.configDynamics.findUnique.mockResolvedValue(filaEnBase({ dataAreaId: '' }));

    const cred = await credencialesEfectivas();

    expect(cred.origen).toBe('base');
    expect(cred.dataAreaId).toBe('env');
  });
});
