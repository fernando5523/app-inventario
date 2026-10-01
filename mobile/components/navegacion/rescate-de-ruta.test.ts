/**
 * EL TEST QUE FALTÓ: que una url profunda de un grupo se pueda abrir en el
 * navegador aunque su pantalla NO esté en el menú.
 *
 * El bug que fija está contado entero en `rescate-de-ruta.ts`. Lo que importa
 * acá: el catálogo de navegación es CONFIGURABLE desde la base
 * (`backend/src/modules/navegacion/`), así que una pantalla puede salir del
 * menú sin dejar de existir, y hay pantallas que nunca estuvieron (se llega a
 * ellas desde otra pantalla). Ninguna de esas puede volverse inalcanzable por
 * url — que es exactamente lo que pasaba y nadie podía diagnosticar.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACCESOS_POR_ROL } from './accesos';
import { destinoDesdeLaRaizDelGrupo } from './rescate-de-ruta';

const PRIMER_ACCESO_AUDITOR = ACCESOS_POR_ROL.auditor[0]?.ruta;

describe('destinoDesdeLaRaizDelGrupo', () => {
  it('devuelve la pantalla que pidió el navegador, no el primer acceso', () => {
    // El caso medido: `/auditor/comparativo` terminaba en `/auditor/auditoria`.
    expect(
      destinoDesdeLaRaizDelGrupo({
        pedida: '/auditor/comparativo',
        inicio: '/auditor',
        primero: '/auditor/auditoria',
      }),
    ).toBe('/auditor/comparativo');
  });

  it('conserva los parámetros de la url', () => {
    // Sin el query, Ajustes del mes abre sin saber de qué inventario habla.
    expect(
      destinoDesdeLaRaizDelGrupo({
        pedida: '/auditor/ajustes-negativos?inventarioId=8078',
        inicio: '/auditor',
        primero: '/auditor/auditoria',
      }),
    ).toBe('/auditor/ajustes-negativos?inventarioId=8078');
  });

  it('NO consulta el catálogo: rescata pantallas que no están en el menú', () => {
    const enElMenu = new Set(ACCESOS_POR_ROL.auditor.map((acceso) => acceso.ruta));
    const fuera = ['/auditor/comparativo', '/auditor/ajustes-negativos'];
    expect(fuera.filter((ruta) => enElMenu.has(ruta))).toEqual([]);

    for (const ruta of fuera) {
      expect(
        destinoDesdeLaRaizDelGrupo({ pedida: ruta, inicio: '/auditor', primero: PRIMER_ACCESO_AUDITOR }),
      ).toBe(ruta);
    }
  });

  it('rescata una pantalla que todavía no existe (la lista no se toca al agregar rutas)', () => {
    expect(
      destinoDesdeLaRaizDelGrupo({
        pedida: '/auditor/una-pantalla-del-mes-que-viene',
        inicio: '/auditor',
        primero: '/auditor/auditoria',
      }),
    ).toBe('/auditor/una-pantalla-del-mes-que-viene');
  });

  it('entrar a la raíz del grupo sigue yendo al primer acceso del rol', () => {
    // El comportamiento de siempre: `/auditor` es donde cae el login y en web
    // no hay pantalla de Inicio.
    expect(
      destinoDesdeLaRaizDelGrupo({ pedida: '/auditor', inicio: '/auditor', primero: '/auditor/auditoria' }),
    ).toBe('/auditor/auditoria');
  });

  it('sin accesos y sin url profunda no redirige a ninguna parte', () => {
    expect(
      destinoDesdeLaRaizDelGrupo({ pedida: '/auditor', inicio: '/auditor', primero: undefined }),
    ).toBeNull();
  });

  it('el prefijo se corta en la barra: `/auditoria` no es del grupo `/auditor`', () => {
    // Con un `startsWith` pelado, un rol llamado `auditor` se quedaría con las
    // urls de cualquier otro que empiece igual.
    expect(
      destinoDesdeLaRaizDelGrupo({ pedida: '/auditoria/algo', inicio: '/auditor', primero: '/auditor/auditoria' }),
    ).toBe('/auditor/auditoria');
  });

  it('vale para los cuatro roles, no solo para el Auditor', () => {
    const casos: Array<[keyof typeof ACCESOS_POR_ROL, string]> = [
      ['administrador', '/administrador/comparativo'],
      ['coordinador', '/coordinador/asistencia'],
      ['conteo', '/conteo/mis-hojas'],
      ['auditor', '/auditor/matriz'],
    ];
    for (const [rol, pedida] of casos) {
      expect(
        destinoDesdeLaRaizDelGrupo({ pedida, inicio: `/${rol}`, primero: ACCESOS_POR_ROL[rol][0]?.ruta }),
      ).toBe(pedida);
    }
  });
});

/**
 * La función de arriba puede estar perfecta y el bug volver igual, si alguien
 * saca la llamada del layout. Esto lee el archivo como TEXTO -- misma técnica
 * que ya usa el backend contra `tabs.ts`, y la única posible: `RolTabsLayout`
 * es un componente de React Native con `<Slot>` adentro, no se puede montar
 * desde vitest sin un navegador.
 */
describe('el layout de web usa el rescate', () => {
  const fuente = readFileSync(
    resolve(process.cwd(), 'components/navegacion/RolTabsLayout.web.tsx'),
    'utf8',
  );

  it('llama a destinoDesdeLaRaizDelGrupo', () => {
    expect(fuente).toContain('destinoDesdeLaRaizDelGrupo(');
  });

  it('NO vuelve a redirigir derecho al primer acceso', () => {
    // La línea que causaba el bug era exactamente esta:
    //   if (ruta === inicio && primero !== undefined) return <Redirect href={primero ...
    expect(fuente).not.toMatch(/ruta === inicio && primero !== undefined/);
  });

  it('congela la url pedida en el primer render, que es cuando todavía existe', () => {
    expect(fuente).toMatch(/useRef\([\s\S]*?window\.location\.pathname \+ window\.location\.search/);
  });
});
