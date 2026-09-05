/**
 * EL SELECTOR DE PUERTOS: qué adaptador queda enchufado en el APK real.
 *
 * Este test no existía, y es el que habría atrapado el bug que motivó
 * escribirlo: `repositorioCatalogo` usaba `elegirHttp` —memoria por defecto,
 * HTTP solo con `EXPO_PUBLIC_PUERTOS_HTTP=catalogo`— y en el APK **no hay
 * ninguna `EXPO_PUBLIC_PUERTOS_*`**. Resultado: el escáner de Contar buscaba
 * los códigos de barras en el dataset de demo, encontrando productos que no
 * están en la góndola y no encontrando los que sí.
 *
 * Un adaptador mal cableado no rompe nada visible: la app anda, la pantalla
 * dibuja, los datos son de otro lado. Por eso hace falta fijarlo con un test
 * y no confiar en que se note.
 *
 * ---------------------------------------------------------------------------
 * COMO SE PRUEBA
 * ---------------------------------------------------------------------------
 * `contenedor.ts` lee `process.env` UNA vez, al importarse. Así que cada caso
 * setea el entorno, hace `vi.resetModules()` y vuelve a importar — no alcanza
 * con cambiar la variable después.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `contenedor.ts` importa TODOS los adaptadores, así que arrastra media
// cadena de Expo. Se mockea lo justo para que el módulo cargue: acá no se
// prueba ningún adaptador, se prueba QUÉ adaptador queda elegido.
vi.stubGlobal('__DEV__', false);
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));

/**
 * Importa el contenedor con el entorno que esté seteado en ese momento.
 *
 * Los mocks se vuelven a declarar con `vi.doMock` DESPUÉS del
 * `vi.resetModules()`: el `vi.mock` de arriba es hoisted y se pierde con el
 * reset, y sin él la cadena de Expo se carga de verdad (revienta con
 * "Stripping types is currently unsupported for files under node_modules").
 * Se notó porque fallaban solo los casos que arman adaptadores HTTP.
 */
async function contenedorCon(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
  vi.doMock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
  vi.doMock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));
  vi.doMock('expo-network', () => ({
    getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
    addNetworkStateListener: () => ({ remove: () => {} }),
  }));
  return import('./contenedor');
}

const VARIABLES = [
  'EXPO_PUBLIC_PUERTOS_MEMORIA',
  'EXPO_PUBLIC_PUERTOS_HTTP',
  'EXPO_PUBLIC_HOJAS_MEMORIA',
] as const;

beforeEach(() => {
  for (const v of VARIABLES) delete process.env[v];
});

afterEach(() => {
  for (const v of VARIABLES) delete process.env[v];
  vi.resetModules();
});

/**
 * EL CASO DEL APK: sin ninguna variable seteada. Es exactamente lo que corre
 * en el teléfono de la tienda, y es donde el catálogo estuvo sirviendo datos
 * de mentira.
 */
/**
 * ⚠️ LO QUE ESTE ARCHIVO NO PUEDE CUBRIR TODAVÍA, Y ES JUSTO LO QUE FALLÓ
 *
 * El caso "sin ninguna variable" —el del APK real, donde el catálogo estuvo
 * sirviendo datos de demo— NO se puede probar acá: importar el contenedor con
 * los adaptadores HTTP activos revienta en vitest con
 *
 *   Stripping types is currently unsupported for files under node_modules,
 *   for ".../expo-modules-core/src/index.ts"
 *
 * Alguien de esa cadena importa `expo-modules-core` sin pasar por los mocks
 * (no es `expo-network`: mockearlo con `vi.mock` y con `vi.doMock` no alcanza).
 * Es una limitación de la config de tests del proyecto, no del selector.
 *
 * Los casos de abajo cubren la otra mitad —que `PUERTOS_MEMORIA` manda a
 * memoria, y con qué precedencia—, que es lo que sí se puede afirmar sin
 * cargar la cadena HTTP. El default queda fijado por el código y por el
 * comentario de `contenedor.ts`, no por un test: quien arregle la config de
 * vitest para que los adaptadores HTTP carguen, que agregue acá el caso
 * `contenedorCon({})` y compare contra `catalogoMemoria` con `not.toBe`.
 */

describe('EXPO_PUBLIC_PUERTOS_MEMORIA — volver un puerto a memoria', () => {
  it('nombrar el catálogo lo devuelve a memoria', async () => {
    const { repositorioCatalogo } = await contenedorCon({ EXPO_PUBLIC_PUERTOS_MEMORIA: 'catalogo' });
    const { catalogoMemoria } = await import('./adaptadores/catalogo-memoria');

    expect(repositorioCatalogo).toBe(catalogoMemoria);
  });

  it('nombrar UNO no arrastra a los demás', async () => {
    const c = await contenedorCon({ EXPO_PUBLIC_PUERTOS_MEMORIA: 'catalogo' });
    const { sesionApi } = await import('./adaptadores/sesion-api');

    expect(c.repositorioSesion).toBe(sesionApi);
  });

  it('`*` manda todo a memoria: desarrollar sin backend', async () => {
    const c = await contenedorCon({ EXPO_PUBLIC_PUERTOS_MEMORIA: '*' });
    const { catalogoMemoria } = await import('./adaptadores/catalogo-memoria');
    const { sesionMemoria } = await import('./adaptadores/sesion-memoria');

    expect(c.repositorioCatalogo).toBe(catalogoMemoria);
    expect(c.repositorioSesion).toBe(sesionMemoria);
  });

  it('tolera espacios y mayúsculas: "  CATALOGO , sesion "', async () => {
    const c = await contenedorCon({ EXPO_PUBLIC_PUERTOS_MEMORIA: '  CATALOGO , sesion ' });
    const { catalogoMemoria } = await import('./adaptadores/catalogo-memoria');
    const { sesionMemoria } = await import('./adaptadores/sesion-memoria');

    expect(c.repositorioCatalogo).toBe(catalogoMemoria);
    expect(c.repositorioSesion).toBe(sesionMemoria);
  });

  it('un nombre que no es un puerto no rompe nada ni cambia nada', async () => {
    const { repositorioCatalogo } = await contenedorCon({ EXPO_PUBLIC_PUERTOS_MEMORIA: 'inexistente' });
    const { catalogoApi } = await import('./adaptadores/catalogo-api');

    expect(repositorioCatalogo).toBe(catalogoApi);
  });
});

describe('EXPO_PUBLIC_PUERTOS_HTTP — forzar HTTP en los que son locales por negocio', () => {
  it('PUERTOS_MEMORIA le gana a PUERTOS_HTTP en el catálogo', async () => {
    // Con el catálogo ya en `elegir`, `PUERTOS_HTTP` no lo mira: la única
    // palanca es `PUERTOS_MEMORIA`. Que las dos juntas manden a memoria evita
    // que alguien crea que `PUERTOS_HTTP=catalogo` lo protege.
    const c = await contenedorCon({
      EXPO_PUBLIC_PUERTOS_MEMORIA: 'catalogo',
      EXPO_PUBLIC_PUERTOS_HTTP: 'catalogo',
    });
    const { catalogoMemoria } = await import('./adaptadores/catalogo-memoria');

    expect(c.repositorioCatalogo).toBe(catalogoMemoria);
  });
});
