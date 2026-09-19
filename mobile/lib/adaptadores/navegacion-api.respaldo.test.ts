/**
 * EL RESPALDO, CONTRA EL STACK HTTP DE VERDAD.
 *
 * `navegacion-api.test.ts` mockea `pedir` y prueba la lógica. Este NO mockea
 * nada: usa `fetch` real contra un puerto donde no hay nadie escuchando, que
 * es exactamente lo que le pasa a la app cuando el backend está caído o la
 * tienda se quedó sin WiFi.
 *
 * Existe porque el mock puede mentir. Un `pedir` mockeado que rechaza prueba
 * que el `catch` funciona; lo que no prueba es que el error de red REALMENTE
 * llegue como una excepción hasta ahí -- si `_http` lo convirtiera en una
 * respuesta vacía, en un `null`, o si el timeout colgara para siempre, el
 * test con mock seguiría en verde y la app en la góndola quedaría en blanco.
 *
 * Es la prueba que el usuario pidió ("bajá el backend y abrí la app"), hecha
 * sin bajar el backend compartido ni tocar el emulador: apuntando a un puerto
 * muerto se obtiene la misma condición.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Se mockean SOLO las dos hojas de React Native que `_http.ts` toca para
 * resolver la URL base (`Platform.OS` y `expo-constants`): no parsean bajo
 * vitest por la sintaxis Flow, y no tienen nada que ver con la red.
 *
 * Lo que NO se mockea es lo que importa: `_http` entero y `fetch` son los de
 * verdad. El error de conexión viaja por el mismo camino que en la app.
 */
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

vi.mock('lucide-react-native', () => ({
  BarChart3: 'BarChart3',
  ClipboardList: 'ClipboardList',
  Home: 'Home',
  Layers: 'Layers',
  LayoutGrid: 'LayoutGrid',
  Settings: 'Settings',
  ShieldCheck: 'ShieldCheck',
  Store: 'Store',
  Users: 'Users',
}));

import { ACCESOS_POR_ROL } from '../../components/navegacion/accesos';
import { TABS_POR_ROL } from '../../components/navegacion/tabs';
import { traerNavegacion } from './navegacion-api';

/**
 * Puerto alto y sin nadie detrás. No es "un puerto que suponemos libre": el
 * test falla igual de bien si alguien estuviera escuchando ahí, porque lo que
 * se afirma es el RESULTADO (el mapa compilado), no el error.
 */
const PUERTO_MUERTO = 'http://127.0.0.1:59517';

let urlPrevia: string | undefined;

beforeAll(() => {
  urlPrevia = process.env['EXPO_PUBLIC_API_URL'];
  process.env['EXPO_PUBLIC_API_URL'] = PUERTO_MUERTO;
});

afterAll(() => {
  if (urlPrevia === undefined) delete process.env['EXPO_PUBLIC_API_URL'];
  else process.env['EXPO_PUBLIC_API_URL'] = urlPrevia;
});

describe('el backend no contesta: fetch real contra un puerto muerto', () => {
  it.each(['administrador', 'coordinador', 'conteo', 'auditor'] as const)(
    '%s ve su home de siempre, completo',
    async (rol) => {
      const nav = await traerNavegacion(rol);

      expect(nav.esRespaldo).toBe(true);
      // No "algo": EXACTAMENTE lo que la app mostraba antes de que esto fuera
      // configurable. Un respaldo parcial sería una pantalla distinta, y la
      // persona que la usa todos los días lo notaría.
      expect(nav.accesos).toEqual(ACCESOS_POR_ROL[rol]);
      expect(nav.tabs).toEqual(TABS_POR_ROL[rol]);
    },
  );

  it('no lanza, no cuelga y no devuelve vacío', async () => {
    // Las tres formas de arruinarle la jornada a alguien: una excepción que
    // rompe el render, una promesa que nunca resuelve (spinner eterno), o una
    // lista vacía (home en blanco).
    const nav = await traerNavegacion('conteo');
    expect(nav.accesos.length).toBeGreaterThan(0);
    expect(nav.tabs.length).toBeGreaterThan(0);
  });

  it('responde rápido: el arranque no espera al timeout de red', async () => {
    // Si esperara los 15s de TIMEOUT_MS, la app arrancaría con el home
    // correcto pero después de un cuarto de minuto en blanco. Contra un
    // puerto cerrado el sistema operativo rechaza la conexión al instante;
    // este test lo fija para que un cambio en _http no lo convierta en una
    // espera larga sin que nadie lo note.
    const inicio = Date.now();
    await traerNavegacion('coordinador');
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });
});
