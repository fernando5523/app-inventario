/**
 * QUE EL REFRESCO DE LA NAVEGACION EXISTA Y NO PISE LO BUENO.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS PROBLEMAS QUE ESTO FIJA
 * ---------------------------------------------------------------------------
 * 1. `NavegacionProvider` pedía `/api/navegacion/mia` UNA vez por login (su
 *    efecto depende de `[rol]`, y el rol no cambia durante una sesión). Si el
 *    Administrador prendía, apagaba o reordenaba un acceso, nadie lo veía
 *    hasta cerrar y reabrir la app -- ni él mismo.
 * 2. `guardar()` en la pantalla del Administrador sólo tocaba su estado
 *    local: después de Guardar, su propia barra de tabs seguía siendo la
 *    vieja. Era el caso más fácil de reproducir, con un solo teléfono.
 *
 * Los dos los detectó min-4 leyendo el código (no reproducidos en el
 * emulador), y se arreglaron con `refrescar()` en el contexto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SE LEEN LOS ARCHIVOS COMO TEXTO
 * ---------------------------------------------------------------------------
 * El provider y las dos pantallas importan `react-native` / `expo-router`,
 * que no parsean bajo vitest (sintaxis Flow), así que no se pueden montar.
 * Mismo criterio que `InicioScreen.padron.test.ts`. Lo que se afirma es el
 * CABLEADO -- que el refresco esté conectado donde tiene que estar --; el
 * comportamiento ante un error de red se prueba de verdad en
 * `lib/adaptadores/navegacion-api.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const leer = (ruta: string): string => readFileSync(resolve(process.cwd(), ruta), 'utf8');

describe('el contexto expone un refresco que no pisa lo bueno', () => {
  const fuente = leer('lib/navegacion-contexto.tsx');

  it('hay un `refrescar` expuesto', () => {
    expect(fuente).toContain('useRefrescarNavegacion');
    expect(fuente).toContain('const refrescar = useCallback');
  });

  /**
   * LA PARTE QUE IMPORTA. El arranque SÍ cae al mapa compilado; el refresco
   * NO puede, porque ya hay una configuración buena en memoria y
   * reemplazarla por la de fábrica haría reaparecer un acceso que el
   * Administrador apagó, cada vez que la persona vuelve sin señal.
   */
  it('el refresco usa la lectura que AVISA cuando no se pudo, no la que cae al respaldo', () => {
    const inicio = fuente.indexOf('const refrescar = useCallback');
    const cuerpo = fuente.slice(inicio, fuente.indexOf('}, []);', inicio));
    expect(cuerpo).toContain('traerNavegacionSiSePuede');
    expect(cuerpo).not.toContain('navegacionDeRespaldo');
  });

  it('y sólo escribe cuando de verdad llegó algo', () => {
    const inicio = fuente.indexOf('const refrescar = useCallback');
    const cuerpo = fuente.slice(inicio, fuente.indexOf('}, []);', inicio));
    expect(cuerpo).toContain('traida !== null');
  });

  it('el arranque sigue cayendo al respaldo: nadie se queda con el home en blanco', () => {
    expect(fuente).toContain('traerNavegacion(rol)');
    expect(fuente).toContain('navegacionDeRespaldo(rol)');
  });
});

describe('quién dispara el refresco', () => {
  it('la pantalla del Administrador, después de guardar', () => {
    // Sin esto, el que configura es el único que NO ve su propio cambio.
    const fuente = leer('app/administrador/navegacion.tsx');
    expect(fuente).toContain('useRefrescarNavegacion');
    const guardar = fuente.slice(fuente.indexOf('async function guardar('));
    expect(guardar.slice(0, guardar.indexOf('}'))).toBeDefined();
    expect(fuente).toContain('refrescarNavegacion();');
  });

  it('y el Inicio al enfocar, para que los otros tres roles se enteren', () => {
    const fuente = leer('components/pantallas/InicioScreen.tsx');
    expect(fuente).toContain('useRefrescarNavegacion');
    expect(fuente).toContain('useRefrescoAlEnfocar(cargarTodo)');
  });
});

/**
 * Ciclo de conteos no tenía NINGÚN refresco: un `useEffect` que corría al
 * montar y nada más. El resumen de la ronda activa es el preview del cierre,
 * así que el Coordinador decidía si cerrar la ronda con un dato de cuando
 * abrió la pantalla.
 */
describe('Ciclo de conteos se refresca al enfocar', () => {
  const fuente = leer('components/pantallas/CicloScreen.tsx');

  it('usa el hook compartido, no un refresco propio', () => {
    expect(fuente).toContain('useRefrescoAlEnfocar(cargar');
  });

  it('y se pausa mientras hay una acción en curso, para no pisarla', () => {
    expect(fuente).toContain('cerrandoRonda || accionAuditor !== null');
  });
});

/**
 * Armar hojas usaba `useFocusEffect` a secas: disparaba al navegar pero no
 * al volver de segundo plano -- el caso exacto que reportó el usuario (salió
 * de la app mientras Dynamics sincronizaba).
 */
describe('Armar hojas usa el hook compartido y dice cuándo no pudo verificar', () => {
  const fuente = leer('app/coordinador/armar.tsx');

  it('ya no usa useFocusEffect suelto', () => {
    // La LLAMADA, no la palabra: el comentario que explica el cambio la
    // menciona, y un test que se rompa por eso se borra al primer refactor.
    expect(fuente).not.toContain('useFocusEffect(');
    expect(fuente).toContain('useRefrescoAlEnfocar(cargar');
  });

  it('consulta `ultimaDescarga`: `todas()` no lanza cuando la descarga falla', () => {
    // Sin esto el paso 3 afirmaba "las 26 hojas ya están repartidas" con el
    // reparto de ayer y sin ninguna marca de que no se habló con el servidor.
    expect(fuente).toContain('ultimaDescarga(');
    expect(fuente).toContain('setHojasSinVerificar');
  });
});
