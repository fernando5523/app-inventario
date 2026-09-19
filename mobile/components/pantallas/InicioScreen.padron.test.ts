/**
 * QUE LA CARGA DEL PADRÓN NO DEJE UNA PROMESA SIN ATRAPAR.
 *
 * ---------------------------------------------------------------------------
 * EL BUG QUE ESTE ARCHIVO FIJA
 * ---------------------------------------------------------------------------
 * Encontrado en el emulador (2026-09-19) bajando el backend a propósito: la
 * app arrancaba bien —el home salía completo con el mapa compilado— pero
 * saltaba un toast rojo, "Uncaught (in promise): ErrorApi: Sin señal". Salía
 * de `InicioScreen`, que traía el padrón de sucursales con un `.then(...)` sin
 * `.catch(...)`. Solo le pasaba al Auditor, que es el único rol que lo pide.
 *
 * Lo que importa no es el recuadro rojo (en release no se ve): una promesa sin
 * atrapar NO es lo mismo que un error manejado. Quedarse sin señal es el
 * camino ESPERADO de esta app —se usa en tiendas con WiFi mala— y el camino
 * esperado no puede viajar como excepción. El día que se conecte un reporte de
 * errores, cada apertura sin señal generaría un reporte y ese ruido taparía
 * los errores de verdad.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE LEE EL ARCHIVO COMO TEXTO
 * ---------------------------------------------------------------------------
 * `InicioScreen.tsx` importa `react-native` directo, que no parsea bajo vitest
 * (sintaxis Flow), así que no se puede montar el componente para observar sus
 * efectos. Mismo criterio que `_pin-dev.test.mjs`, que lee `seed.ts` como
 * texto por una razón equivalente.
 *
 * La afirmación es deliberadamente TOLERANTE: exige que el pedido quede
 * manejado de ALGUNA forma (`.catch`, `await`, o `cargarSeguro`), no una
 * escritura en particular. Un test que exigiera exactamente `.catch(` fallaría
 * ante un refactor correcto, y un guard que castiga lo correcto termina
 * borrado.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * `_http.ts` toca `react-native` (`Platform`) y `expo-constants` solo para
 * resolver la URL base; ninguno de los dos parsea bajo vitest. Se mockean
 * antes de importar, mismo patrón que `BandaSync.test.ts`. Lo que se prueba
 * -- la clasificación del error -- no los usa.
 */
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import { ErrorApi, esFallaDeRed } from '../../lib/adaptadores/_http';

/**
 * El final de la sentencia que arranca en `desde`: el primer `;` que aparece
 * con los paréntesis y las llaves BALANCEADOS.
 *
 * Cortar en el primer `;` a secas no sirve: el de adentro del callback del
 * `.then(...)` llega antes que el `.catch(...)`, y la ventana se quedaría
 * justo con la mitad que no hay que mirar. Fue el primer intento y dio un
 * falso positivo.
 */
function finDeLaSentencia(fuente: string, desde: number): number {
  let parentesis = 0;
  let llaves = 0;
  for (let i = desde; i < fuente.length; i++) {
    const c = fuente[i];
    if (c === '(') parentesis += 1;
    else if (c === ')') parentesis -= 1;
    else if (c === '{') llaves += 1;
    else if (c === '}') llaves -= 1;
    else if (c === ';' && parentesis === 0 && llaves === 0) return i + 1;
  }
  return fuente.length;
}

describe('la carga del padrón de sucursales queda manejada', () => {
  it('el pedido de sucursales no deja una promesa suelta', () => {
    const fuente = readFileSync(resolve(process.cwd(), 'components/pantallas/InicioScreen.tsx'), 'utf8');

    // Se ancla en la LLAMADA, no en el nombre del repositorio: ese aparece
    // antes en el import y la ventana caería sobre la línea equivocada.
    const llamada = fuente.indexOf('.sucursales()');
    expect(llamada, 'ya no se pide el padrón acá: revisá si este test sigue teniendo sentido').toBeGreaterThan(-1);

    const inicio = fuente.lastIndexOf('repositorioSesion', llamada);
    const sentencia = fuente.slice(inicio, finDeLaSentencia(fuente, inicio));
    expect(sentencia).toContain('sucursales()');

    const manejada =
      sentencia.includes('.catch(') || sentencia.includes('await ') || sentencia.includes('cargarSeguro');
    expect(manejada, `la llamada quedó sin manejar:\n${sentencia}`).toBe(true);
  });
});

/**
 * LA POLÍTICA DEL `catch`: silencio para lo esperado, log para lo que no.
 *
 * Tragarse todo escondería un 500 —la barra mostraría el nombre equivocado y
 * nadie sabría por qué—; avisar de todo sería el mismo ruido que se quiso
 * sacar, una línea por cada apertura sin señal. `esFallaDeRed` es la que
 * separa las dos cosas, así que se prueba que separe de verdad.
 */
describe('esFallaDeRed separa lo esperado de lo que hay que mirar', () => {
  it('quedarse sin señal es esperado: va en silencio', () => {
    expect(esFallaDeRed(new ErrorApi('sin-red'))).toBe(true);
  });

  it('un timeout también: la WiFi de la tienda no da', () => {
    expect(esFallaDeRed(new ErrorApi('timeout'))).toBe(true);
  });

  it('un error del servidor NO es esperado: ese se registra', () => {
    expect(esFallaDeRed(new ErrorApi('servidor', { estado: 500 }))).toBe(false);
  });

  it('una respuesta inválida tampoco', () => {
    expect(esFallaDeRed(new ErrorApi('respuesta-invalida'))).toBe(false);
  });
});
