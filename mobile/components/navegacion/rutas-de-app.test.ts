/**
 * LAS RUTAS QUE EXISTEN EN `app/` CONTRA LAS QUE LA WEB PUEDE ABRIR.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * El 2026-09-30 se pasaron días creyendo que "el comparativo mensual no se
 * puede abrir en el navegador" era un misterio de esa pantalla. Era el grupo
 * entero: CUALQUIER url profunda del Auditor caía en el primer acceso del rol
 * (la causa completa está en `rescate-de-ruta.ts`). `tsc --noEmit` daba 0 y
 * las 1.284 pruebas estaban en verde con el bug adentro, porque ninguna miraba
 * la pregunta que importaba: ¿se puede LLEGAR a esta pantalla?
 *
 * Este archivo la mira, y la mira sin navegador: arma el árbol de rutas con el
 * mismo `getRoutes` de expo-router que usa la app en caliente, alimentado con
 * las MISMAS expresiones regulares que Metro usa para juntar los archivos
 * (`expo-router/_ctx.web.js` y `_ctx.android.js`). Si mañana una pantalla se
 * cae del bundle de web, o el árbol de web deja de ser el del teléfono, o una
 * ruta del grupo se vuelve inalcanzable por url, falla acá.
 *
 * Hermano de `app-sin-tests.test.ts`, que cuida lo otro que Metro no perdona:
 * que en `app/` no entre nada que no sea una pantalla.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getRoutes } from 'expo-router/build/getRoutes';
import type { RouteNode } from 'expo-router/build/Route';
import type { RequireContext } from 'expo-router/build/types';

import { ACCESOS_POR_ROL } from './accesos';
import { destinoDesdeLaRaizDelGrupo } from './rescate-de-ruta';

const RAIZ_APP = resolve(process.cwd(), 'app');

/**
 * Las dos expresiones son COPIA de `expo-router/_ctx.web.js` y
 * `_ctx.android.js`. Se copian en vez de importarse porque esos módulos leen
 * `process.env.EXPO_ROUTER_APP_ROOT` y llaman a `require.context`, que existe
 * en Metro y no en Node. Si una versión de expo-router las cambia, este test
 * deja de estar midiendo lo que mide la app -- y esa es justamente la clase de
 * cosa que conviene que se note en un `npm run test` y no en producción.
 */
const CTX_WEB = /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+middleware)|(?:\+(html|native-intent))))\.[tj]sx?$).*(?:\.android|\.ios|\.native)?\.[tj]sx?$/;
const CTX_ANDROID = /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)|(?:\+middleware)))\.[tj]sx?$).*(?:\.ios|\.web)?\.[tj]sx?$/;

/** Todos los archivos bajo `app/`, recursivo, como claves `./grupo/pantalla.tsx`. */
function clavesDeApp(directorio = RAIZ_APP): string[] {
  return readdirSync(directorio).flatMap((entrada) => {
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) return clavesDeApp(ruta);
    return [`./${relative(RAIZ_APP, ruta)}`];
  });
}

/** El `require.context` que Metro le pasa a expo-router, hecho a mano. */
function contextoDe(filtro: RegExp): RequireContext {
  const claves = clavesDeApp().filter((clave) => filtro.test(clave)).sort();
  const contexto = (() => ({ default: () => null })) as unknown as RequireContext;
  contexto.keys = () => claves;
  contexto.resolve = (id: string) => id;
  contexto.id = 'test';
  return contexto;
}

/** Las rutas navegables del árbol, en la forma `auditor/comparativo`. */
function rutasDelArbol(nodo: RouteNode | null, prefijo = ''): string[] {
  if (nodo === null) return [];
  const propia = nodo.route === '' ? prefijo : prefijo === '' ? nodo.route : `${prefijo}/${nodo.route}`;
  if (nodo.children.length === 0) return [propia];
  return nodo.children.flatMap((hija) => rutasDelArbol(hija, propia));
}

function arbolDe(plataforma: 'web' | 'android'): string[] {
  const arbol = getRoutes(contextoDe(plataforma === 'web' ? CTX_WEB : CTX_ANDROID), {
    // Las mismas opciones con las que la app arma su árbol en caliente, ver
    // `expo-router/build/global-state/router-store.js#useStore`.
    skipGenerated: true,
    ignoreEntryPoints: true,
    platform: plataforma,
    preserveRedirectAndRewrites: true,
  });
  return rutasDelArbol(arbol).sort();
}

/**
 * Lo que DEBERÍA haber, leído de los nombres de archivo y nada más:
 * `app/auditor/comparativo.tsx` y `app/auditor/auditoria.web.tsx` son la misma
 * ruta `auditor/auditoria`; los `_layout` no son rutas.
 */
function rutasEsperadas(): string[] {
  const rutas = clavesDeApp()
    .filter((clave) => /\.[tj]sx?$/.test(clave))
    .map((clave) => clave.replace(/^\.\//, '').replace(/\.(web|ios|android|native)?\.?[tj]sx?$/, ''))
    .filter((ruta) => !ruta.endsWith('_layout'));
  return [...new Set(rutas)].sort();
}

describe('el árbol de rutas de la web', () => {
  const enWeb = arbolDe('web');

  it('encuentra el árbol (si esto falla, el test se quedó sin qué mirar)', () => {
    expect(enWeb.length).toBeGreaterThan(10);
  });

  it('tiene TODAS las pantallas que hay en app/, ni una menos', () => {
    // Una pantalla que se cae del árbol de web no da error, no da warning y no
    // rompe ningún test: simplemente no se puede abrir.
    expect(enWeb).toEqual(rutasEsperadas());
  });

  it('es el MISMO árbol que el del teléfono', () => {
    // Si un día difieren, la diferencia es la explicación de por qué algo abre
    // en el emulador y no en el navegador -- que fue la pista falsa que costó
    // más tiempo en este bug.
    expect(enWeb).toEqual(arbolDe('android'));
  });

  it('las dos que arrastraban el bug siguen en el árbol', () => {
    expect(enWeb).toContain('auditor/comparativo');
    expect(enWeb).toContain('auditor/ajustes-negativos');
  });
});

describe('toda ruta de un grupo se puede abrir escribiendo su url', () => {
  const roles = Object.keys(ACCESOS_POR_ROL) as Array<keyof typeof ACCESOS_POR_ROL>;

  for (const rol of roles) {
    it(`${rol}: ninguna pantalla depende de estar en el menú`, () => {
      const inicio = `/${rol}`;
      const primero = ACCESOS_POR_ROL[rol][0]?.ruta;
      const delGrupo = arbolDe('web')
        .filter((ruta) => ruta.startsWith(`${rol}/`))
        .map((ruta) => `/${ruta}`)
        // `index` es la raíz del grupo, y en web esa SÍ manda al primer acceso.
        .filter((ruta) => !ruta.endsWith('/index'));

      expect(delGrupo.length).toBeGreaterThan(0);

      const inalcanzables = delGrupo.filter(
        (ruta) => destinoDesdeLaRaizDelGrupo({ pedida: ruta, inicio, primero }) !== ruta,
      );
      expect(inalcanzables).toEqual([]);
    });
  }
});
