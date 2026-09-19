/**
 * Quien entra a clasificar productos: SOLO el Auditor.
 *
 * A diferencia de /api/usuarios (admin + auditor), aca el administrador
 * TAMBIEN queda afuera -- la clasificacion empresa/empleado es del Auditor.
 * Estos tests prueban lo unico que decide la ruta: el gate de rol. Lo que
 * hace el controller se cubre en clasificacion.service.test.ts, sin Prisma.
 */
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appDePrueba, autorizacion, controllerFalso, levantar } from '../../test-utils/http-test';

vi.mock('../sesion/sesion.service', () => ({
  verificarToken: async (token: string) => {
    try {
      return JSON.parse(token) as ColaboradorAutenticado;
    } catch {
      return null;
    }
  },
}));
vi.mock('./clasificacion.controller', () => controllerFalso(['buscar', 'clasificar', 'desclasificar']));

import { clasificacionRouter } from './clasificacion.routes';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/clasificacion', clasificacionRouter);
  ({ baseUrl, cerrar } = await levantar(app));
}

afterEach(async () => {
  await cerrar?.();
});

const json = (actor: ColaboradorAutenticado) => ({
  ...autorizacion(actor),
  'Content-Type': 'application/json',
});

describe('GET /api/clasificacion: la busqueda del catalogo', () => {
  it('sin sesion, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/clasificacion`)).status).toBe(401);
  });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/clasificacion`, { headers: autorizacion(AUDITOR) })).status).toBe(200);
  });

  it('administrador, 403 -- clasificar es del Auditor, no del admin', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/clasificacion`, { headers: autorizacion(ADMIN) })).status).toBe(403);
  });

  it('coordinador, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/clasificacion`, { headers: autorizacion(COORDINADOR) })).status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/clasificacion`, { headers: autorizacion(CONTEO) })).status).toBe(403);
  });
});

describe('PUT/DELETE /api/clasificacion/:codigo: clasificar y desclasificar', () => {
  it('auditor clasifica (PUT con cuerpo valido), pasa', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/CERV-001`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({ clase: 'empresa', nota: 'La asume la empresa' }),
    });
    expect(r.status).toBe(200);
  });

  it.each(['empresa', 'paquete', 'unidad'] as const)('auditor clasifica con clase %s, pasa', async (clase) => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/CERV-001`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({ clase }),
    });
    expect(r.status).toBe(200);
  });

  /**
   * `esEmpresa` DEJO DE ACEPTARSE en el cuerpo: se deriva de la clase. Un
   * cliente viejo que lo siga mandando tiene que fallar con 400, no quedar
   * clasificado como otra cosa en silencio -- la invariante
   * (`clase == 'empresa'` <=> `esEmpresa`) se cumple porque solo hay UNA
   * fuente, y aceptar las dos abriria la puerta a que discrepen.
   */
  it('un cuerpo con esEmpresa (el contrato viejo) falla con 400, no se ignora', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/CERV-001`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({ esEmpresa: true }),
    });
    expect(r.status).toBe(400);
  });

  it('una clase que no existe falla con 400', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/CERV-001`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({ clase: 'caja' }),
    });
    expect(r.status).toBe(400);
  });

  it('auditor desclasifica (DELETE), pasa', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/CERV-001`, { method: 'DELETE', headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(200);
  });

  it('coordinador no clasifica, 403 (antes de mirar el cuerpo)', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/CERV-001`, {
      method: 'PUT',
      headers: json(COORDINADOR),
      body: JSON.stringify({ clase: 'empresa' }),
    });
    expect(r.status).toBe(403);
  });
});

/**
 * El cuerpo tiene que decir ALGO: o fuerza un cuadro, o corrige el empaque.
 * Sin esa regla, un cuerpo vacio dejaria una fila `clase NULL + empaque NULL`,
 * que es la forma exacta de una EXCEPCION VIEJA -- y las dos quedarian
 * indistinguibles.
 */
describe('PUT /api/clasificacion/:codigo: el cuadro es OPCIONAL, pero algo hay que decir', () => {
  it('solo el empaque corregido, sin cuadro: pasa', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/105621`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({ empaqueCompraCorregido: 12 }),
    });
    expect(r.status).toBe(200);
  });

  it('con la clase en null explicito, tambien', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/105621`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({ clase: null, empaqueCompraCorregido: 12 }),
    });
    expect(r.status).toBe(200);
  });

  it('un cuerpo vacio falla con 400: no hay nada que guardar', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/105621`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('solo una nota tampoco alcanza: una nota no clasifica nada', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/clasificacion/105621`, {
      method: 'PUT',
      headers: json(AUDITOR),
      body: JSON.stringify({ nota: 'algo' }),
    });
    expect(r.status).toBe(400);
  });
});
