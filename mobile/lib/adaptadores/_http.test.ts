/**
 * Tests del cliente HTTP. Sin red, sin emulador, sin backend: `fetch` está
 * mockeado, así que esto corre tan barato como los tests del dominio.
 *
 * `react-native` y `expo-constants` se mockean con factory (no se llega a
 * cargar el módulo real, que en Node ni parsea). Son las DOS únicas
 * dependencias nativas del archivo, y ambas solo se usan para resolver la
 * URL base.
 *
 * Lo que se prueba acá no es "que ande fetch": es que NINGÚN camino de falla
 * deje escapar una excepción cruda, que ninguno se cuelgue, y que las
 * escrituras no se reintenten solas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import {
  ErrorApi,
  esErrorApi,
  esFallaDeRed,
  pedir,
  recordarToken,
  registrarLectorDeToken,
  urlBase,
} from './_http';

const BASE = 'http://servidor-de-prueba:3000';

/** Respuesta OK con cuerpo JSON. */
function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

/** Respuesta de error tal como la arma backend/src/middleware/error.middleware.ts. */
function respuestaError(estado: number, cuerpo: unknown = { error: 'mensaje del backend' }): Response {
  return {
    ok: false,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

/** Cuerpo que NO es JSON — lo que devuelve un proxy caído (HTML de un 502). */
function respuestaHtml(estado: number): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => {
      throw new Error('no es JSON');
    },
    text: async () => '<html>502 Bad Gateway</html>',
  } as unknown as Response;
}

/**
 * Los parámetros se declaran aunque no se usen: sin ellos `mock.calls` queda
 * tipado como tupla vacía y no se puede inspeccionar la URL ni los headers.
 */
function fetchFalso(...respuestas: Array<Response | Error>) {
  // `_init` sin default a propósito: con un valor por defecto el parámetro
  // pasa a ser opcional en la tupla de `mock.calls` y cada lectura necesita
  // un `!`. `pedir` siempre llama a fetch con los dos argumentos.
  const fn = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => {
    const siguiente = respuestas.length > 1 ? respuestas.shift()! : respuestas[0];
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = BASE;
  recordarToken(null);
  // El lector persistido es estado de módulo: si un test lo deja tirando un
  // error, contamina a todos los que siguen.
  registrarLectorDeToken(async () => null);
  // Jitter a cero: los reintentos no meten espera real en los tests. La
  // aleatoriedad se prueba aparte, no acá.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_API_URL;
});

// ---------------------------------------------------------------------------

describe('urlBase', () => {
  it('sale de configuración, no está hardcodeada', () => {
    expect(urlBase()).toBe(BASE);
  });

  it('normaliza la barra final para no generar rutas con //', () => {
    process.env.EXPO_PUBLIC_API_URL = `${BASE}/`;
    expect(urlBase()).toBe(BASE);
  });
});

describe('camino feliz', () => {
  it('devuelve el JSON parseado', async () => {
    fetchFalso(respuestaJson([{ id: 1, nombre: 'Luzuriaga' }]));
    await expect(pedir('/api/sesion/sucursales')).resolves.toEqual([{ id: 1, nombre: 'Luzuriaga' }]);
  });

  it('un 204 devuelve undefined en vez de reventar al parsear', async () => {
    fetchFalso(respuestaJson(null, 204));
    await expect(pedir('/api/hojas/1/conteos/2', { metodo: 'PUT' })).resolves.toBeUndefined();
  });

  it('arma la URL pegando la base con la ruta', async () => {
    const fn = fetchFalso(respuestaJson({}));
    await pedir('/api/config');
    expect(fn.mock.calls[0][0]).toBe(`${BASE}/api/config`);
  });
});

describe('token de sesión', () => {
  it('lo inyecta como Bearer cuando hay sesión', async () => {
    recordarToken('abc123');
    const fn = fetchFalso(respuestaJson({}));
    await pedir('/api/usuarios');
    expect(fn.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer abc123' });
  });

  it('NO lo manda en rutas públicas: el login no tiene token todavía', async () => {
    recordarToken('abc123');
    const fn = fetchFalso(respuestaJson({}));
    await pedir('/api/sesion/ingresar', { metodo: 'POST', cuerpo: {}, sinSesion: true });
    expect(fn.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('si falla la lectura del token en SQLite tampoco escapa un error crudo', async () => {
    // Base bloqueada, disco lleno, archivo corrupto: el lector persistido
    // revienta ANTES de que haya un fetch del que colgarse.
    registrarLectorDeToken(async () => {
      throw new Error('database is locked');
    });
    fetchFalso(respuestaJson({}));
    const error = (await pedir('/api/usuarios').catch((e) => e)) as ErrorApi;
    expect(esErrorApi(error)).toBe(true);
    expect(error.clase).toBe('sesion-vencida');
  });
});

describe('clasificación de errores', () => {
  it('un fetch que revienta es sin-red, no una excepción cruda', async () => {
    fetchFalso(new TypeError('Network request failed'));
    const error = await pedir('/api/config').catch((e) => e);
    expect(esErrorApi(error)).toBe(true);
    expect((error as ErrorApi).clase).toBe('sin-red');
  });

  it('sin-red no suena a que se rompió algo', async () => {
    fetchFalso(new TypeError('Network request failed'));
    const error = (await pedir('/api/config').catch((e) => e)) as ErrorApi;
    // La persona está en una cámara de frío: el mensaje no puede sugerir
    // que perdió el conteo.
    expect(error.message).toMatch(/nada se pierde/i);
    expect(esFallaDeRed(error)).toBe(true);
  });

  it('401 en ruta pública es PIN incorrecto, no sesión vencida', async () => {
    fetchFalso(respuestaError(401, { error: 'PIN incorrecto.' }));
    const error = (await pedir('/api/sesion/ingresar', {
      metodo: 'POST',
      sinSesion: true,
    }).catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe('credenciales-invalidas');
  });

  it('401 en ruta autenticada es sesión vencida', async () => {
    fetchFalso(respuestaError(401));
    const error = (await pedir('/api/usuarios').catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe('sesion-vencida');
  });

  it.each([
    [403, 'sin-permiso'],
    [404, 'no-encontrado'],
    [409, 'conflicto'],
    [429, 'demasiados-intentos'],
    [400, 'validacion'],
    [422, 'validacion'],
    [500, 'servidor'],
    [503, 'servidor'],
  ])('%i se traduce a %s', async (estado, clase) => {
    fetchFalso(respuestaError(estado));
    const error = (await pedir('/api/config').catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe(clase);
    expect(error.estado).toBe(estado);
  });

  it('un DNI duplicado (409) no se confunde con un formulario mal cargado', async () => {
    // README §Usuarios: 409 = "ya existe un colaborador con ese DNI en esa
    // sucursal". La pantalla tiene que señalar el DNI, no todo el formulario.
    fetchFalso(respuestaError(409, { error: 'Ya existe un colaborador con ese DNI en esa sucursal.' }));
    const error = (await pedir('/api/usuarios', { metodo: 'POST' }).catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe('conflicto');
    expect(error.clase).not.toBe('validacion');
    expect(error.reintentable).toBe(false);
  });

  it('prefiere el mensaje del backend, que está escrito para el operario', async () => {
    fetchFalso(respuestaError(400, { error: 'El PIN debe tener 6 digitos.' }));
    const error = (await pedir('/api/usuarios', { metodo: 'POST' }).catch((e) => e)) as ErrorApi;
    expect(error.message).toBe('El PIN debe tener 6 digitos.');
  });

  it('en un 5xx NO muestra el mensaje del servidor: puede traer un stack', async () => {
    fetchFalso(respuestaError(500, { error: 'relation "hojas_conteo" does not exist' }));
    const error = (await pedir('/api/config').catch((e) => e)) as ErrorApi;
    expect(error.message).not.toMatch(/hojas_conteo/);
  });

  it('un cuerpo de error que no es JSON no rompe: cae al mensaje por clase', async () => {
    fetchFalso(respuestaHtml(502));
    const error = (await pedir('/api/config').catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe('servidor');
    expect(esErrorApi(error)).toBe(true);
  });

  it('un 200 con cuerpo ilegible es respuesta-invalida, no un crash', async () => {
    fetchFalso(respuestaHtml(200));
    const error = (await pedir('/api/config').catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe('respuesta-invalida');
  });

  it('marca reintentable solo donde el problema es el camino', async () => {
    for (const [estado, esperado] of [
      [500, true],
      [503, true],
      [401, false],
      [400, false],
      [429, false],
    ] as const) {
      fetchFalso(respuestaError(estado));
      const error = (await pedir('/api/config', { intentos: 1 }).catch((e) => e)) as ErrorApi;
      expect(error.reintentable, `estado ${estado}`).toBe(esperado);
    }
  });
});

describe('timeout', () => {
  /** Un servidor que aceptó la conexión y no contesta nunca. */
  function fetchQueCuelga() {
    const fn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolver, rechazar) => {
          init.signal?.addEventListener('abort', () => rechazar(new Error('AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('corta el pedido en vez de dejar el spinner girando', async () => {
    fetchQueCuelga();
    const error = (await pedir('/api/config', {
      msTimeout: 20,
      msPresupuesto: 40,
    }).catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe('timeout');
  });

  it('el presupuesto total acota la operación entera, no cada intento', async () => {
    fetchQueCuelga();
    const comienzo = Date.now();
    await pedir('/api/config', { msTimeout: 30, msPresupuesto: 60 }).catch(() => undefined);
    // 3 intentos de 30ms sin presupuesto serían 90ms+. El techo manda.
    expect(Date.now() - comienzo).toBeLessThan(200);
  });

  it('una cancelación de la pantalla no se confunde con un timeout', async () => {
    fetchQueCuelga();
    const control = new AbortController();
    const promesa = pedir('/api/config', { senal: control.signal, msTimeout: 5_000 });
    control.abort();
    const error = (await promesa.catch((e) => e)) as ErrorApi;
    expect(error.clase).toBe('cancelado');
  });
});

describe('reintentos', () => {
  it('reintenta un GET que falló por red: repetir una lectura es gratis', async () => {
    const fn = fetchFalso(new TypeError('Network request failed'));
    await pedir('/api/config').catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('un GET que se recupera en el segundo intento devuelve el dato', async () => {
    fetchFalso(new TypeError('Network request failed'), respuestaJson({ ok: true }));
    await expect(pedir('/api/config')).resolves.toEqual({ ok: true });
  });

  it('NO reintenta un POST: podría duplicar un conteo', async () => {
    const fn = fetchFalso(new TypeError('Network request failed'));
    await pedir('/api/hojas/1/finalizar', { metodo: 'POST' }).catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('NO reintenta un PUT por defecto, aunque HTTP lo llame idempotente', async () => {
    const fn = fetchFalso(new TypeError('Network request failed'));
    await pedir('/api/hojas/1/conteos/2', { metodo: 'PUT' }).catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta una escritura solo si quien llama la declara idempotente', async () => {
    const fn = fetchFalso(new TypeError('Network request failed'));
    await pedir('/api/hojas/1/conteos/2', { metodo: 'PUT', idempotente: true }).catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('no reintenta un 4xx: el dato está mal, insistir da lo mismo', async () => {
    const fn = fetchFalso(respuestaError(400));
    await pedir('/api/config').catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('no reintenta un 429: el servidor pidió justamente que bajemos el ritmo', async () => {
    const fn = fetchFalso(respuestaError(429));
    await pedir('/api/config').catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta un 5xx en lectura', async () => {
    const fn = fetchFalso(respuestaError(503));
    await pedir('/api/config').catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('informa cuántos intentos se hicieron DE VERDAD, no el máximo', async () => {
    fetchFalso(respuestaError(401));
    const error = (await pedir('/api/config').catch((e) => e)) as ErrorApi;
    expect(error.intentos).toBe(1);
  });
});
