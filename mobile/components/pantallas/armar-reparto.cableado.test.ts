/**
 * QUE LA PANTALLA DE ARMAR NO VUELVA A DECIDIR EL AVISO POR SU CUENTA.
 *
 * El falso positivo del inventario 8073 (una hoja, cuatro presentes, "vuelve
 * a repartir" para siempre) nació de una condición escrita DENTRO de la
 * pantalla: comparaba el conjunto de gente con hoja contra el de presentes y
 * exigía que fueran iguales. La regla ya vive en
 * `lib/dominio/reparto-de-hojas.ts`, con sus casos probados; lo que se fija
 * acá es que la pantalla la USE, porque una copia local de la regla es
 * exactamente la forma en que el bug volvería.
 *
 * Se lee el archivo como TEXTO por lo mismo que `navegacion-refresco.test.ts`:
 * `app/coordinador/armar.tsx` importa `react-native` y `expo-router`, que no
 * parsean bajo vitest. Lo que se afirma es el CABLEADO; el comportamiento se
 * prueba de verdad en `lib/dominio/reparto-de-hojas.test.ts`.
 *
 * Y el archivo vive acá, no bajo `app/`: un test dentro de `app/` lo bundlea
 * Metro y rompe la app entera (pasó el 2026-09-20 con
 * `app/administrador/navegacion.carga.test.ts` -- ver
 * `components/navegacion/app-sin-tests.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fuente = readFileSync(resolve(process.cwd(), 'app/coordinador/armar.tsx'), 'utf8');

describe('el aviso de "vuelve a repartir" sale del dominio', () => {
  it('la pantalla importa las tres funciones del reparto', () => {
    expect(fuente).toContain("from '../../lib/dominio/reparto-de-hojas'");
    expect(fuente).toContain('estadoDelReparto');
    expect(fuente).toContain('textoRepartoDesactualizado');
    expect(fuente).toContain('textoRepartoHecho');
  });

  /**
   * LA PARTE QUE IMPORTA. Esta comparación de tamaños ES el bug: con 1 hoja y
   * 4 presentes los conjuntos nunca pueden ser iguales, así que el aviso
   * quedaba prendido para siempre en toda ronda de reconteo.
   */
  it('no queda ninguna comparación de conjuntos dentro de la pantalla', () => {
    expect(fuente).not.toContain('presentesAhora');
    expect(fuente).not.toContain('conHojas.size');
    expect(fuente).not.toMatch(/const repartoDesactualizado\s*=/);
  });

  it('el aviso y su botón se prenden con el mismo dato, y ese dato es el texto del dominio', () => {
    expect(fuente).toContain('const avisoReparto = estadoReparto ? textoRepartoDesactualizado(estadoReparto) : null;');
    // Dos veces: la tarjeta del aviso y el botón rojo que reparte de nuevo.
    expect(fuente.match(/\{avisoReparto \?/g)).toHaveLength(2);
  });

  /**
   * El texto viejo prometía un reparto que no ocurrió ("ya está repartida
   * entre los 4 contadores presentes" sobre una hoja en manos de una sola
   * persona). Ahora esa frase solo la puede armar el dominio, que es el
   * único que sabe si de verdad todos los presentes tienen hoja.
   */
  it('la pantalla ya no arma a mano la frase del reparto hecho', () => {
    expect(fuente).not.toContain('está repartida');
    expect(fuente).not.toContain('están repartidas');
    expect(fuente).not.toContain('La asistencia cambió después de repartir');
  });
});
