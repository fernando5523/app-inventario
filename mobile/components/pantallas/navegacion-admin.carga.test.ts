/**
 * QUE EL SPINNER NO SE PUEDA PRENDER SIN ARRANCAR UNA CARGA.
 *
 * ---------------------------------------------------------------------------
 * EL BUG QUE ESTE ARCHIVO FIJA
 * ---------------------------------------------------------------------------
 * Encontrado en el emulador (2026-09-19). El primer render de "Accesos y
 * menús" cargaba bien; tocar otro chip de rol dejaba el spinner girando PARA
 * SIEMPRE, y volver al rol que sí había cargado tampoco lo recuperaba. Sin
 * excepción, sin error de red, sin nada en logcat -- el backend contestaba los
 * cuatro roles en 3 ms.
 *
 * La causa: el handler del chip hacía `setCargando(true)` y confiaba en que
 * `useRefrescoAlEnfocar` recargara. Ese hook guarda `cargar` en un ref A
 * PROPOSITO y solo dispara al enfocar la pantalla o al volver a primer plano;
 * que `cargar` cambie de identidad no lo despierta, y con la pantalla ya
 * enfocada ese evento no vuelve a ocurrir.
 *
 * El arreglo no fue llamar a `cargar()` desde el handler -- eso se vuelve a
 * romper el día que se agregue otro disparador -- sino hacer que el EFECTO sea
 * el único dueño de `cargando`. Esto lo verifica.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SE LEE EL ARCHIVO COMO TEXTO
 * ---------------------------------------------------------------------------
 * La pantalla importa `react-native`, que no parsea bajo vitest (sintaxis
 * Flow), así que no se puede montar el componente para observar sus efectos.
 * Es la misma limitación que hizo que este bug solo apareciera en el emulador,
 * y la razón por la que toda funcionalidad se prueba también ahí.
 *
 * ---------------------------------------------------------------------------
 * Y POR QUE ESTE ARCHIVO NO PUEDE VIVIR EN `app/`
 * ---------------------------------------------------------------------------
 * Estuvo ahí y ROMPIO LA APP ENTERA (2026-09-19): `mobile/app/` es el árbol de
 * RUTAS de expo-router, así que Metro bundlea TODO lo que hay adentro como
 * pantalla. Este test importa `node:fs`, `node:path` y `vitest`, que en React
 * Native no existen -- el bundle dejó de compilar y la app no abría para
 * nadie, con una pantalla roja de Metro ("Unable to resolve module node:fs").
 *
 * `tsc` daba 0 y vitest verde igual: ninguna de las dos mira lo que Metro
 * puede empaquetar. Por eso vive acá, junto al resto de los tests de
 * pantallas, y por eso existe `app-sin-tests.test.ts`, que impide que alguien
 * vuelva a dejar un test adentro de `app/`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FUENTE = readFileSync(resolve(process.cwd(), 'app/administrador/navegacion.tsx'), 'utf8');

/** El cuerpo de una función declarada con `function <nombre>(`, con llaves balanceadas. */
function cuerpoDe(fuente: string, nombre: string): string {
  const inicio = fuente.indexOf(`function ${nombre}(`);
  if (inicio === -1) return '';
  const abre = fuente.indexOf('{', inicio);
  let llaves = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === '{') llaves += 1;
    else if (fuente[i] === '}') {
      llaves -= 1;
      if (llaves === 0) return fuente.slice(abre, i + 1);
    }
  }
  return fuente.slice(abre);
}

describe('el estado de carga tiene un solo dueño', () => {
  it('ningún handler prende el spinner: prenderlo sin pedir nada es la pantalla muerta', () => {
    for (const handler of ['cambiarRol', 'cambiarTipo']) {
      const cuerpo = cuerpoDe(FUENTE, handler);
      expect(cuerpo, `no se encontró ${handler}`).not.toBe('');
      expect(cuerpo.includes('setCargando'), `${handler} toca el estado de carga:\n${cuerpo}`).toBe(false);
    }
  });

  it('hay un efecto con el rol en las dependencias, que es lo que recarga', () => {
    // Sin esto, cambiar de rol no pide nada -- que es exactamente el bug.
    expect(FUENTE).toMatch(/useEffect\([\s\S]*?\}, \[rol\]\);/);
  });

  it('ese efecto prende Y apaga el spinner', () => {
    const inicio = FUENTE.indexOf('useEffect(');
    const fin = FUENTE.indexOf('}, [rol]);', inicio);
    expect(fin, 'no se encontró el efecto de carga').toBeGreaterThan(inicio);

    const efecto = FUENTE.slice(inicio, fin);
    expect(efecto).toContain('setCargando(true)');
    expect(efecto).toContain('setCargando(false)');
    // Y pide de verdad: un efecto que prende el spinner sin llamar al
    // servidor es la misma pantalla muerta con otra forma.
    expect(efecto).toContain('traerConfiguracion(rol)');
  });

  it('la carrera de tocar dos chips seguidos está cortada', () => {
    // Sin el guard, la respuesta lenta de un rol que ya no está en pantalla
    // pisa la del rol actual y se ve la lista equivocada.
    const inicio = FUENTE.indexOf('useEffect(');
    const efecto = FUENTE.slice(inicio, FUENTE.indexOf('}, [rol]);', inicio));
    expect(efecto).toContain('vigente');
  });
});
