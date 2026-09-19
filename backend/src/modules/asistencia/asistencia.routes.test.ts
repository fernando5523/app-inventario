/**
 * Pasar lista es lo que decide la multa por inasistencia, que se descuenta del
 * sueldo. Estos tests fijan la PRIMERA barrera: qué roles llegan siquiera al
 * controller. El recorte por sucursal y por estado del inventario lo prueban
 * `asistencia.permisos.test.ts` y `asistencia.service.test.ts`.
 *
 * Además cuidan una trampa propia de este router: comparte el prefijo
 * `/api/inventarios` con `inventarios.routes.ts`, así que el rol va POR RUTA.
 * Ver el comentario de `asistencia.routes.ts`.
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
vi.mock('./asistencia.controller', () => controllerFalso(['listar', 'marcar', 'borrar', 'justificar', 'quitarJustificacion']));

import { asistenciaRouter } from './asistencia.routes';

const ADMIN: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const CONTEO: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  const app = appDePrueba('/api/inventarios', asistenciaRouter);
  ({ baseUrl, cerrar } = await levantar(app));
}

function marcar(actor: ColaboradorAutenticado): Promise<Response> {
  return fetch(`${baseUrl}/api/inventarios/8021/asistencia`, {
    method: 'POST',
    headers: { ...autorizacion(actor), 'Content-Type': 'application/json' },
    body: JSON.stringify({ colaboradorId: 102, dia: '2026-09-18' }),
  });
}

afterEach(async () => {
  await cerrar?.();
});

describe('GET /api/inventarios/:id/asistencia: ver la lista', () => {
  it('sin sesión, 401', async () => {
    await iniciar();
    expect((await fetch(`${baseUrl}/api/inventarios/8021/asistencia`)).status).toBe(401);
  });

  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia`, { headers: autorizacion(COORDINADOR) });
    expect(r.status).toBe(200);
  });

  it('administrador, pasa el middleware -- entra por soporte', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia`, { headers: autorizacion(ADMIN) });
    expect(r.status).toBe(200);
  });

  it('auditor, 200 -- desde que justifica faltas necesita ver a quién le perdona qué día', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia`, { headers: autorizacion(AUDITOR) });
    expect(r.status).toBe(200);
  });

  it('conteo, 403 -- nadie se marca a sí mismo presente', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia`, { headers: autorizacion(CONTEO) });
    expect(r.status).toBe(403);
  });
});

describe('POST /api/inventarios/:id/asistencia: marcar la entrada', () => {
  it('coordinador, pasa el middleware', async () => {
    await iniciar();
    expect((await marcar(COORDINADOR)).status).toBe(200);
  });

  it('conteo, 403 -- marcarse uno mismo es declarar el propio descuento', async () => {
    await iniciar();
    expect((await marcar(CONTEO)).status).toBe(403);
  });

  it('auditor, 403 -- lee la lista pero no pasa lista: él no estuvo en la jornada', async () => {
    await iniciar();
    expect((await marcar(AUDITOR)).status).toBe(403);
  });

  it('un día que no existe en el calendario, 400 -- inventaría un día de inventario y multaría a todos', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia`, {
      method: 'POST',
      headers: { ...autorizacion(COORDINADOR), 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId: 102, dia: '2026-02-31' }),
    });
    expect(r.status).toBe(400);
  });
});

describe('DELETE /api/inventarios/:id/asistencia/:colaboradorId: corregir una marca', () => {
  it('coordinador con ?dia=, pasa el middleware', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia/102?dia=2026-09-18`, {
      method: 'DELETE',
      headers: autorizacion(COORDINADOR),
    });
    expect(r.status).toBe(200);
  });

  /**
   * Sin `?dia=` no hay "borrar todo": el día es obligatorio. Un DELETE al que
   * se le olvidó el query param borraría la asistencia entera de esa persona
   * y le costaría la multa completa.
   */
  it('sin ?dia=, 400 y no un borrado masivo', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia/102`, {
      method: 'DELETE',
      headers: autorizacion(COORDINADOR),
    });
    expect(r.status).toBe(400);
  });

  it('conteo, 403', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/inventarios/8021/asistencia/102?dia=2026-09-18`, {
      method: 'DELETE',
      headers: autorizacion(CONTEO),
    });
    expect(r.status).toBe(403);
  });
});

/** POST de una justificación con el cuerpo que corresponda. */
function justificar(actor: ColaboradorAutenticado, cuerpo: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/inventarios/8021/justificaciones`, {
    method: 'POST',
    headers: { ...autorizacion(actor), 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

const JUSTIFICACION_VALIDA = { colaboradorId: 102, dia: '2026-09-18', motivo: 'Licencia médica' };

describe('POST /api/inventarios/:id/justificaciones: perdonar una falta', () => {
  it('auditor, pasa el middleware', async () => {
    await iniciar();
    expect((await justificar(AUDITOR, JUSTIFICACION_VALIDA)).status).toBe(200);
  });

  it('coordinador, 403 -- quien pasa lista no perdona faltas', async () => {
    await iniciar();
    expect((await justificar(COORDINADOR, JUSTIFICACION_VALIDA)).status).toBe(403);
  });

  /**
   * El administrador SÍ pasa lista (entra por soporte) y acá NO entra:
   * perdonar una multa es una decisión de negocio sobre la plata de una
   * persona, no una tarea operativa que haya que destrabar.
   */
  it('administrador, 403 -- aunque sí pueda pasar lista', async () => {
    await iniciar();
    expect((await justificar(ADMIN, JUSTIFICACION_VALIDA)).status).toBe(403);
  });

  it('conteo, 403', async () => {
    await iniciar();
    expect((await justificar(CONTEO, JUSTIFICACION_VALIDA)).status).toBe(403);
  });

  /**
   * EL MOTIVO ES OBLIGATORIO y lo corta el schema, antes de llegar al
   * service. Un perdón sin motivo es un descuento menos que nadie puede
   * explicar seis meses después.
   */
  it('sin motivo, 400', async () => {
    await iniciar();
    const r = await justificar(AUDITOR, { colaboradorId: 102, dia: '2026-09-18' });
    expect(r.status).toBe(400);
  });

  it('motivo vacío o de relleno, 400 -- "." no explica nada', async () => {
    await iniciar();
    expect((await justificar(AUDITOR, { ...JUSTIFICACION_VALIDA, motivo: '' })).status).toBe(400);
    expect((await justificar(AUDITOR, { ...JUSTIFICACION_VALIDA, motivo: '  .  ' })).status).toBe(400);
  });

  it('un día que no existe en el calendario, 400', async () => {
    // Mismo cuidado que al marcar: `2026-02-31` pasa cualquier regex y
    // JavaScript lo convierte en el 3 de marzo sin avisar.
    await iniciar();
    expect((await justificar(AUDITOR, { ...JUSTIFICACION_VALIDA, dia: '2026-02-31' })).status).toBe(400);
  });

  it('un campo de más, 400 -- el body es estricto', async () => {
    await iniciar();
    expect((await justificar(AUDITOR, { ...JUSTIFICACION_VALIDA, loQueSea: 1 })).status).toBe(400);
  });
});

describe('DELETE /api/inventarios/:id/justificaciones/:colaboradorId', () => {
  const quitar = (actor: ColaboradorAutenticado, query = '?dia=2026-09-18'): Promise<Response> =>
    fetch(`${baseUrl}/api/inventarios/8021/justificaciones/102${query}`, {
      method: 'DELETE',
      headers: autorizacion(actor),
    });

  it('auditor, pasa el middleware', async () => {
    await iniciar();
    expect((await quitar(AUDITOR)).status).toBe(200);
  });

  it('coordinador, 403', async () => {
    await iniciar();
    expect((await quitar(COORDINADOR)).status).toBe(403);
  });

  /**
   * Sin `?dia=` es 400, nunca un borrado masivo: se levanta el perdón de UN
   * día, jamás todos los de una persona de una sola vez.
   */
  it('sin ?dia=, 400 y no un borrado masivo silencioso', async () => {
    await iniciar();
    expect((await quitar(AUDITOR, '')).status).toBe(400);
  });
});
