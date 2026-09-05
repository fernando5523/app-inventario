/**
 * EL SECRETO DEL ERP NO VUELVE POR LA API. Nunca, por ninguna ruta, ni
 * entero ni enmascarado a medias.
 *
 * Por qué "ni enmascarado": un `sk_live_abc…xyz` con el medio tapado sigue
 * diciendo el largo, el prefijo y el sufijo — y con eso, quien saque una
 * foto de la pantalla tiene la mitad del trabajo hecho. El puerto del front
 * lo dice textual: *"un secreto que la pantalla puede mostrar de vuelta es un
 * secreto que alguien puede fotografiar"*. Lo único que se informa es
 * `secretoConfigurado: boolean`.
 *
 * Se prueba contra el SERVICE REAL (Prisma mockeado), no contra las rutas con
 * el controller falso: lo que hay que verificar es el cuerpo que sale, y con
 * un controller falso el cuerpo lo escribe el test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRETO = 'ClientSecretRealDeAzure~abc123XYZ.-_defGHI';

const prismaMock = vi.hoisted(() => ({
  configDynamics: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

// Cifrado disponible y reversible, para poder afirmar que el secreto SE
// guarda (cifrado) y aun así NO sale. Sin esto, "no vuelve" podría estar
// pasando solo porque nunca se guardó nada.
vi.mock('./config-dynamics.cifrado', () => ({
  cifrar: (v: string) => `cifrado:${v}`,
  descifrar: (v: string) => v.replace(/^cifrado:/, ''),
  cifradoDisponible: () => true,
  enmascarar: (v: string) => `***${v.slice(-2)}`,
  CifradoNoConfigurado: class extends Error {},
}));

import * as service from './config-dynamics.service';
import type { ColaboradorAutenticado } from '../../shared/tipos';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };

/** La fila como la devuelve Prisma, con el secreto YA cifrado en la columna. */
const FILA = {
  id: 1,
  tenantId: 'tenant-abc',
  clientId: 'client-abc',
  urlBase: 'https://empresa.operations.dynamics.com',
  dataAreaId: 'trn',
  clientSecretCifrado: `cifrado:${SECRETO}`,
  actualizadoPorId: 1000,
  updatedAt: new Date('2026-09-05T06:00:00.000Z'),
};

/** Busca el secreto en CUALQUIER parte del objeto, por profundo que esté. */
function contieneElSecreto(valor: unknown): boolean {
  return JSON.stringify(valor ?? null).includes(SECRETO);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.configDynamics.findUnique.mockResolvedValue(FILA);
  prismaMock.configDynamics.upsert.mockResolvedValue(FILA);
});

describe('el clientSecret no sale por la API', () => {
  it('`obtener` no lo devuelve, ni entero ni en ningún campo anidado', async () => {
    const dto = await service.obtener();
    expect(contieneElSecreto(dto)).toBe(false);
  });

  it('`obtener` tampoco devuelve el valor CIFRADO de la columna', async () => {
    // El cifrado protege la base, no la API: publicar el ciphertext le da a
    // quien lo vea algo para atacar offline, y no le sirve de nada a la
    // pantalla.
    const dto = await service.obtener();
    expect(JSON.stringify(dto)).not.toContain('cifrado:');
    expect(JSON.stringify(dto)).not.toContain('clientSecretCifrado');
  });

  it('lo único que dice del secreto es SI HAY, no cuál es', async () => {
    const dto = await service.obtener();
    expect(dto.secretoConfigurado).toBe(true);
    expect(Object.keys(dto)).not.toContain('clientSecret');
  });

  it('sin secreto guardado dice `secretoConfigurado: false` y nada más', async () => {
    prismaMock.configDynamics.findUnique.mockResolvedValue({ ...FILA, clientSecretCifrado: null });
    const dto = await service.obtener();

    expect(dto.secretoConfigurado).toBe(false);
    expect(contieneElSecreto(dto)).toBe(false);
  });

  /**
   * EL CAMINO POR EL QUE SE FILTRARÍA MÁS FÁCIL: devolver el estado después
   * de guardar, con los datos que acaban de entrar por el body todavía en la
   * mano.
   */
  it('`guardar` recibe el secreto por el body y NO lo devuelve', async () => {
    const dto = await service.guardar(ADMIN, {
      tenantId: 'tenant-abc',
      clientId: 'client-abc',
      urlBase: 'https://empresa.operations.dynamics.com',
      clientSecret: SECRETO,
    });

    expect(contieneElSecreto(dto)).toBe(false);
    expect(dto.secretoConfigurado).toBe(true);
  });

  it('`guardar` SÍ lo persiste (cifrado): que no vuelva no es que no se guarde', async () => {
    await service.guardar(ADMIN, {
      tenantId: 'tenant-abc',
      clientId: 'client-abc',
      urlBase: 'https://empresa.operations.dynamics.com',
      clientSecret: SECRETO,
    });

    const escrito = JSON.stringify(prismaMock.configDynamics.upsert.mock.calls[0]?.[0] ?? {});
    expect(escrito).toContain('cifrado:');
    // Y nunca en claro, ni siquiera en la escritura.
    expect(escrito).not.toContain(`"${SECRETO}"`);
  });

  it('el registro de auditoría del cambio tampoco lleva el secreto', async () => {
    // Un secreto en `RegistroAuditoria` queda en la base para siempre, en
    // claro, y lo lee cualquiera que pueda ver el histórico de acciones.
    await service.guardar(ADMIN, {
      tenantId: 'tenant-abc',
      clientId: 'client-abc',
      urlBase: 'https://empresa.operations.dynamics.com',
      clientSecret: SECRETO,
    });

    const { registrarAuditoria } = await import('../../shared/auditoria');
    for (const llamada of vi.mocked(registrarAuditoria).mock.calls) {
      expect(contieneElSecreto(llamada[0])).toBe(false);
    }
  });
});

/**
 * `credencialesEfectivas` SÍ devuelve el secreto en claro -- lo necesita para
 * pedir el token a Azure. Es de uso interno del servidor y ningún controller
 * la llama; este test fija esa frontera, para que quien la exponga por una
 * ruta tenga que borrarlo a mano y se pregunte por qué estaba.
 */
describe('credencialesEfectivas: interna, no de la API', () => {
  it('devuelve el secreto en claro para poder autenticar', async () => {
    const cred = await service.credencialesEfectivas();
    expect(cred.clientSecret).toBe(SECRETO);
  });

  it('ningún handler de config-dynamics.controller.ts la llama', async () => {
    const controller = await import('./config-dynamics.controller');
    expect(Object.keys(controller)).toEqual(['obtener', 'guardar', 'probarConexion']);
  });
});
