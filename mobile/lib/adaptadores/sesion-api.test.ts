/**
 * Cubre `cambiarPin` contra el contrato real de `POST /api/sesion/cambiar-pin`
 * (backend/src/modules/sesion/sesion.routes.ts): lo crítico acá no es que el
 * POST salga con el cuerpo correcto — es que la sesión local trate el 204
 * como lo que es. El backend cierra TODAS las sesiones de la persona al
 * aplicar el cambio, la que llama incluida (sesion.service.ts#cambiarPinPropio):
 * si este adaptador no borrara la copia local, `sesionActiva()` seguiría
 * devolviendo un token que el próximo pedido a CUALQUIER otro endpoint
 * rechazaría con 401 — un "estás adentro" que ya no es cierto.
 *
 * Mismo patrón de SQLite que hojas-sqlite.test.ts: `node:sqlite` real
 * envuelto en la interfaz async de expo-sqlite, no un mock de la lógica.
 * `sesion-api.ts` abre `expo-sqlite` DIRECTO (no pasa por `./_sqlite` como
 * hojas-sqlite.ts), así que acá se mockea `expo-sqlite` mismo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

/**
 * `sesion-api.ts` abre la base a nivel de MÓDULO (`const dbPromise =
 * SQLite.openDatabaseAsync('sesion.db')`), no dentro de una función — se
 * ejecuta apenas se importa, antes de que el resto de ESTE archivo corra
 * ni una línea (los imports de un módulo se evalúan como parte de
 * vincular el grafo, antes que el cuerpo del propio módulo). Por eso el
 * estado que el mock necesita tiene que vivir en `vi.hoisted`: es lo único
 * que garantiza estar listo para cuando el factory de `vi.mock` se
 * invoque, sin importar el orden textual de las declaraciones acá abajo.
 */
const { obtenerDbDeTest } = vi.hoisted(() => {
  interface DbDeTest {
    execAsync(source: string): Promise<void>;
    runAsync(source: string, params?: unknown[]): Promise<void>;
    getFirstAsync<T>(source: string, params?: unknown[]): Promise<T | null>;
  }

  let conexionActual: DbDeTest | null = null;

  return {
    obtenerDbDeTest: async (): Promise<DbDeTest> => {
      if (!conexionActual) {
        // Import dinámico, no estático: node:sqlite/fs/os/path solo hacen
        // falta acá adentro, en el momento en que el factory de `vi.mock`
        // los necesita — mantenerlos fuera de los imports de arriba evita
        // competir con el orden de evaluación del módulo mockeado.
        const [{ DatabaseSync }, { default: fs }, { default: os }, { default: path }] = await Promise.all([
          import('node:sqlite'),
          import('node:fs'),
          import('node:os'),
          import('node:path'),
        ]);

        const archivoDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sesion-sqlite-test-')), 'sesion.db');
        const raw = new DatabaseSync(archivoDb);
        conexionActual = {
          async execAsync(source) {
            raw.exec(source);
          },
          async runAsync(source, params = []) {
            raw.prepare(source).run(...(params as never[]));
          },
          async getFirstAsync<T>(source: string, params: unknown[] = []) {
            return (raw.prepare(source).get(...(params as never[])) ?? null) as T | null;
          },
        };
      }
      return conexionActual;
    },
  };
});

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: () => obtenerDbDeTest(),
}));

import { recordarToken } from './_http';
import { sesionApi } from './sesion-api';

const BASE = 'http://servidor-de-prueba:3000';

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

function fetchQueDevuelve(respuesta: Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => respuesta);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const SESION_DE_PRUEBA = {
  colaborador: { id: 102, nombre: 'María Rojas', dni: '8890', rol: 'conteo' as const },
  sucursal: { id: 1, nombre: 'Market Central Luzuriaga', colaboradores: 11 },
  token: 'token-102',
  expiraEn: new Date(Date.now() + 60_000).toISOString(),
};

beforeEach(async () => {
  process.env.EXPO_PUBLIC_API_URL = BASE;
  // Deja una sesión guardada en la SQLite de prueba, como si `ingresar()`
  // ya hubiera corrido — es el punto de partida real de quien va a cambiar
  // su PIN: siempre lo hace CON sesión. `ingresar()` ya deja el token en
  // memoria (recordarToken) y persistido en SQLite — no hace falta
  // registrar un lector aparte para este archivo.
  vi.stubGlobal('fetch', vi.fn(async () => json(SESION_DE_PRUEBA)));
  await sesionApi.ingresar(102, '000102');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EXPO_PUBLIC_API_URL;
  recordarToken(null);
});

describe('cambiarPin', () => {
  it('manda POST a /api/sesion/cambiar-pin con pinActual y pinNuevo, sin colaboradorId', async () => {
    const fn = fetchQueDevuelve(json(null, 204));
    await sesionApi.cambiarPin('000102', '820394');

    expect(fn).toHaveBeenCalledWith(
      `${BASE}/api/sesion/cambiar-pin`,
      expect.objectContaining({ method: 'POST' }),
    );
    const cuerpo = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(cuerpo).toEqual({ pinActual: '000102', pinNuevo: '820394' });
  });

  it('en éxito (204), invalida la sesión local: sesionActiva() vuelve a null', async () => {
    fetchQueDevuelve(json(null, 204));
    await expect(sesionApi.sesionActiva()).resolves.not.toBeNull();

    await sesionApi.cambiarPin('000102', '820394');

    // El backend ya cerró esta sesión (y todas las demás) al aplicar el
    // cambio — si acá siguiera devolviendo la sesión vieja, la app
    // mostraría "estás adentro" cuando el servidor ya dice que no.
    await expect(sesionApi.sesionActiva()).resolves.toBeNull();
  });

  it('en error (401, PIN actual incorrecto), NO toca la sesión local y respeta el mensaje del servidor', async () => {
    fetchQueDevuelve(json({ error: 'El PIN actual no es correcto.' }, 401));

    await expect(sesionApi.cambiarPin('999999', '820394')).rejects.toThrow('El PIN actual no es correcto.');
    // Un PIN actual mal tipeado no es una sesión vencida: la persona sigue
    // adentro y puede reintentar sin volver a loguearse.
    await expect(sesionApi.sesionActiva()).resolves.not.toBeNull();
  });

  it('en 429 (demasiados intentos), respeta el mensaje del limitador y no toca la sesión', async () => {
    fetchQueDevuelve(json({ error: 'Demasiados intentos de ingreso. Volvé a intentar en unos minutos.' }, 429));

    await expect(sesionApi.cambiarPin('000102', '820394')).rejects.toThrow(/Demasiados intentos/);
    await expect(sesionApi.sesionActiva()).resolves.not.toBeNull();
  });
});
