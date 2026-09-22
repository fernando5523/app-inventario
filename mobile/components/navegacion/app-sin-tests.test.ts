/**
 * QUE EN `mobile/app/` NO ENTRE NADA QUE METRO NO PUEDA EMPAQUETAR.
 *
 * ---------------------------------------------------------------------------
 * EL BUG QUE ESTE ARCHIVO FIJA -- rompió la app entera
 * ---------------------------------------------------------------------------
 * 2026-09-19: quedó un `navegacion.carga.test.ts` dentro de
 * `app/administrador/`. `mobile/app/` es el árbol de RUTAS de expo-router:
 * Metro bundlea TODO lo que hay adentro como pantalla de la app. Ese test
 * importaba `node:fs`, `node:path` y `vitest`, que en React Native no existen,
 * así que el bundle dejó de compilar y la app NO ABRIA PARA NADIE:
 *
 *     The development server returned response error code: 500
 *     UnableToResolveError: Unable to resolve module node:fs
 *
 * No era una pantalla rota: era la app sin arrancar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NINGUNA HERRAMIENTA LO VIO
 * ---------------------------------------------------------------------------
 * `tsc --noEmit` daba 0 y `vitest` estaba verde CON el archivo ahí. Las dos
 * tienen razón desde su lugar: el test compila y pasa. Ninguna de las dos mira
 * lo que METRO puede empaquetar, que es una tercera cosa.
 *
 * Por eso la funcionalidad se prueba también en el emulador -- esto no lo
 * encontraba ningún test --, y por eso existe este archivo: para que la
 * próxima vez sí lo encuentre uno.
 *
 * Vive fuera de `app/`, obviamente: si estuviera adentro sería el bug que
 * denuncia.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ_APP = resolve(process.cwd(), 'app');

/** Todos los archivos bajo `app/`, recursivo. */
function archivosDeApp(directorio = RAIZ_APP): string[] {
  return readdirSync(directorio).flatMap((entrada) => {
    const ruta = join(directorio, entrada);
    return statSync(ruta).isDirectory() ? archivosDeApp(ruta) : [ruta];
  });
}

/**
 * Módulos que existen en Node y NO en React Native. No es la lista completa
 * de builtins: son los que de verdad aparecen cuando alguien deja un test o
 * un script suelto ahí, que es el caso que se está previniendo.
 */
const SOLO_DE_NODE = ['node:fs', 'node:path', 'node:crypto', 'node:os', 'node:child_process', "from 'vitest'"];

describe('mobile/app/ solo tiene pantallas', () => {
  const archivos = archivosDeApp();

  it('encuentra el árbol de rutas (si esto falla, el test se quedó sin qué mirar)', () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  it('NINGUN archivo de test vive adentro de app/', () => {
    // Metro los bundlearía como pantalla. La convención del repo es que el
    // test va al lado del componente, nunca en la ruta.
    const tests = archivos.filter((ruta) => /\.(test|spec)\.[tj]sx?$/.test(ruta));
    expect(tests.map((ruta) => ruta.replace(`${process.cwd()}/`, ''))).toEqual([]);
  });

  it('nada bajo app/ importa un módulo que React Native no tiene', () => {
    // Cubre el caso general, no solo los tests: un helper con `node:crypto`
    // rompe el bundle igual de bien.
    const rotos = archivos
      .filter((ruta) => /\.[tj]sx?$/.test(ruta))
      .map((ruta) => ({ ruta, fuente: readFileSync(ruta, 'utf8') }))
      .flatMap(({ ruta, fuente }) =>
        SOLO_DE_NODE.filter((modulo) => fuente.includes(modulo)).map(
          (modulo) => `${ruta.replace(`${process.cwd()}/`, '')} importa ${modulo}`,
        ),
      );
    expect(rotos).toEqual([]);
  });
});
