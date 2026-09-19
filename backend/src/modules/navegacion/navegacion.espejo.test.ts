/**
 * EL CATALOGO DEL BACKEND Y EL MAPA COMPILADO DEL MOVIL TIENEN QUE DECIR LO
 * MISMO.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HAY DOS COPIAS Y POR QUE NO SE PUEDEN SEPARAR
 * ---------------------------------------------------------------------------
 * El movil conserva `components/navegacion/{accesos,tabs}.ts` como RESPALDO:
 * cuando la configuracion no llega -- sin señal, backend caido, respuesta rara
 * -- arma el home con eso. No es codigo muerto. Un home en blanco es una
 * persona parada en la gondola sin poder contar, y estas tiendas tienen WiFi
 * mala.
 *
 * El backend tiene el mismo catalogo porque es lo que siembra y lo que le
 * muestra al Administrador.
 *
 * Si los dos se separan, el respaldo deja de ser el respaldo: la app sin señal
 * mostraria un home distinto del que mostraba con señal, y nadie se enteraria
 * hasta que le pase a alguien en una tienda. Este test compara los dos
 * archivos LEYENDO EL DEL MOVIL COMO TEXTO -- mismo criterio que
 * `scripts/_pin-dev.test.mjs`, que lee `seed.ts` como texto para que su copia
 * de los PINs no se desalinee.
 *
 * No se importa el modulo del movil directamente porque es otro proyecto de
 * TypeScript, con su propio tsconfig y dependencias de React Native
 * (`lucide-react-native` en tabs.ts) que no existen acá.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rol } from '../../shared/tipos';
import { ACCESOS_CATALOGO, TABS_CATALOGO } from './navegacion.catalogo';

/**
 * Se resuelve desde `process.cwd()` y no desde `import.meta.dirname`: el
 * tsconfig del backend compila a CommonJS y `import.meta` no existe ahi
 * (TS1343). vitest corre con el cwd en `backend/`, asi que el movil es el
 * hermano de al lado.
 */
const RAIZ_MOVIL = resolve(process.cwd(), '..', 'mobile', 'components', 'navegacion');
const ROLES: Rol[] = ['administrador', 'coordinador', 'conteo', 'auditor'];

/** El texto del bloque de un rol dentro de `Record<Rol, ...>`, sin comentarios. */
function bloqueDelRol(fuente: string, rol: Rol): string {
  const inicio = fuente.indexOf(`  ${rol}: [`);
  expect(inicio, `no se encontro el bloque de ${rol}`).toBeGreaterThan(-1);
  const fin = fuente.indexOf('\n  ],', inicio);
  expect(fin, `no se encontro el cierre del bloque de ${rol}`).toBeGreaterThan(inicio);
  return fuente.slice(inicio, fin);
}

/** Las rutas de un rol, EN ORDEN, tal como estan escritas en accesos.ts. */
function rutasDelMovil(rol: Rol): string[] {
  const fuente = readFileSync(resolve(RAIZ_MOVIL, 'accesos.ts'), 'utf8');
  return [...bloqueDelRol(fuente, rol).matchAll(/ruta:\s*'([^']+)'/g)].map((m) => m[1]!);
}

/** Los `name` de los tabs de un rol, EN ORDEN. */
function tabsDelMovil(rol: Rol): string[] {
  const fuente = readFileSync(resolve(RAIZ_MOVIL, 'tabs.ts'), 'utf8');
  return [...bloqueDelRol(fuente, rol).matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]!);
}

describe('el catalogo del backend espeja el mapa compilado del movil', () => {
  /**
   * EL ORDEN IMPORTA TANTO COMO EL CONTENIDO. El cliente pidio "dejar los
   * roles que ya tenemos y sus accesos": el dia 1 despues del cambio los
   * cuatro roles tienen que ver exactamente lo mismo, en el mismo orden. La
   * siembra sale de este catalogo, asi que un renglon corrido acá es un home
   * distinto en la tienda.
   */
  it.each(ROLES)('los accesos de %s coinciden, en el mismo orden', (rol) => {
    expect(ACCESOS_CATALOGO[rol].map((a) => a.ruta)).toEqual(rutasDelMovil(rol));
  });

  it.each(ROLES)('los tabs de %s coinciden, en el mismo orden', (rol) => {
    expect(TABS_CATALOGO[rol].map((t) => t.name)).toEqual(tabsDelMovil(rol));
  });

  it('el archivo del movil sigue existiendo: es el RESPALDO, no codigo muerto', () => {
    // Si alguien lo borra por "ya no se usa", la app se queda sin home cuando
    // el backend no contesta. El test falla al leerlo, que es lo que se busca.
    const accesos = readFileSync(resolve(RAIZ_MOVIL, 'accesos.ts'), 'utf8');
    expect(accesos).toContain('ACCESOS_POR_ROL');
    const tabs = readFileSync(resolve(RAIZ_MOVIL, 'tabs.ts'), 'utf8');
    expect(tabs).toContain('TABS_POR_ROL');
  });

  it('no hay rutas repetidas dentro de un mismo rol', () => {
    // Una ruta repetida seria dos tarjetas iguales, y ademas rompe el
    // @@unique([rol, tipo, clave]) al sembrar.
    for (const rol of ROLES) {
      const rutas = ACCESOS_CATALOGO[rol].map((a) => a.ruta);
      expect(new Set(rutas).size).toBe(rutas.length);
    }
  });
});
