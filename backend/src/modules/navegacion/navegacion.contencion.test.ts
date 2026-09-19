/**
 * LA CONTENCION: ningun rol puede terminar con una pantalla de otro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE TEST NO ES UNA FORMALIDAD
 * ---------------------------------------------------------------------------
 * Lo que sostiene es el CONTEO CIEGO, que es la regla sobre la que se apoya el
 * producto entero: tres pasadas sobre 8.000 items, 160 hojas, once personas un
 * mes -- todo existe para que quien cuenta no sepa contra que numero se lo
 * compara. Si el Administrador pudiera darle al Coordinador el "Panel de
 * auditoria", le alcanzaria con decir "fijate que ahi tendrian que ser 120"
 * para que el inventario cuadre sin haberse contado.
 *
 * La lista blanca que lo impide son los GRUPOS DE RUTA: cada rol solo puede
 * tener las pantallas que viven en `mobile/app/<rol>/`. No es una convencion
 * que alguien tenga que recordar -- `app/auditor/auditoria.tsx` no existe
 * dentro de `app/coordinador/`.
 *
 * La primera version de esta funcionalidad iba a derivar la lista blanca de
 * los `requiereRol` de cada router, Y ESO ESTABA MAL: el router de auditoria
 * declara `requiereRol('administrador', 'auditor', 'coordinador')` -- el
 * coordinador SI pasa esa puerta. Lo que le esconde el stock es
 * `puedeVerLaMatriz`, que es mas fino (solo inventarios ya cerrados). Con los
 * `requiereRol` como fuente, el Administrador habria podido darle el panel al
 * Coordinador. Este test existe para que ese camino no se reabra en silencio.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ROMPERIA LA CONTENCION EL DIA QUE PASE
 * ---------------------------------------------------------------------------
 * Una pantalla COMPARTIDA que viva en un solo grupo y la usen dos roles. Hoy
 * no existe: cuando dos roles hacen lo mismo hay dos archivos
 * (`/administrador/historial` y `/auditor/historial`, que ademas comparten
 * componente). No se resolvio por adelantado a proposito -- cualquier
 * mecanismo inventado para un caso que no existe va a ser el equivocado --, y
 * este test es el que va a romper primero, que es justamente lo que se quiere.
 * Ver navegacion.lista-blanca.ts.
 */

import { describe, expect, it } from 'vitest';
import type { Rol } from '../../shared/tipos';
import { ACCESOS_CATALOGO, TABS_CATALOGO } from './navegacion.catalogo';
import { PREFIJO_POR_ROL, rolAdmiteAcceso, rolDeLaRuta } from './navegacion.lista-blanca';

const ROLES: Rol[] = ['administrador', 'coordinador', 'conteo', 'auditor'];

describe('contencion: cada acceso cae dentro del grupo de su rol', () => {
  /** CONDICION 1: todo acceso configurado esta dentro de las rutas de su grupo. */
  it.each(ROLES)('los accesos de %s empiezan con su propio prefijo', (rol) => {
    for (const acceso of ACCESOS_CATALOGO[rol]) {
      expect(acceso.ruta.startsWith(PREFIJO_POR_ROL[rol])).toBe(true);
      expect(rolAdmiteAcceso(rol, acceso.ruta)).toBe(true);
    }
  });

  /**
   * CONDICION 2: ningun rol puede terminar con una ruta del grupo de otro.
   *
   * Es el caso concreto que motivo toda la decision. Si alguien mueve una
   * pantalla de carpeta -- o agrega un acceso al catalogo del rol equivocado
   * -- rompe acá y no en la pantalla de una tienda.
   */
  it.each(ROLES)('a %s no se le puede dar una pantalla de otro rol', (rol) => {
    const ajenas = ROLES.filter((otro) => otro !== rol).flatMap((otro) =>
      ACCESOS_CATALOGO[otro].map((a) => a.ruta),
    );
    for (const ruta of ajenas) {
      expect(rolAdmiteAcceso(rol, ruta)).toBe(false);
    }
  });

  it('el caso que motivo la regla: el panel de auditoria NO es del coordinador', () => {
    // El backend SI lo deja pasar por `requiereRol` (administrador, auditor,
    // coordinador); lo que lo frena mas adelante es `puedeVerLaMatriz`. Acá
    // ni siquiera llega a plantearse: la ruta no es de su grupo.
    expect(rolAdmiteAcceso('coordinador', '/auditor/auditoria')).toBe(false);
    expect(rolAdmiteAcceso('conteo', '/auditor/auditoria')).toBe(false);
  });

  it('una ruta que no cae en ningun grupo no es de nadie', () => {
    expect(rolDeLaRuta('/otra-cosa')).toBeNull();
    expect(rolDeLaRuta('')).toBeNull();
    // Y el prefijo tiene que ser el completo: "/administradorX/" no cuela.
    expect(rolDeLaRuta('/administradorX/usuarios')).toBeNull();
  });

  it('los cuatro prefijos son distintos y ninguno contiene a otro', () => {
    // Si un prefijo fuera prefijo de otro, `rolDeLaRuta` devolveria el
    // primero que matchee y la contencion se caeria sin que nadie lo note.
    const prefijos = Object.values(PREFIJO_POR_ROL);
    for (const a of prefijos) {
      for (const b of prefijos) {
        if (a !== b) expect(a.startsWith(b)).toBe(false);
      }
    }
  });
});

describe('contencion: los tabs', () => {
  /**
   * Un tab se resuelve por NOMBRE DE ARCHIVO dentro de `app/<rol>/`, no por
   * ruta absoluta, asi que la contencion es estructural: expo-router busca
   * `app/<rol>/<name>.tsx` y no puede salir de esa carpeta. Lo que si hay que
   * cuidar es que el nombre no venga con barras -- eso si permitiria escapar.
   */
  it.each(ROLES)('los tabs de %s son nombres de archivo, no rutas', (rol) => {
    for (const tab of TABS_CATALOGO[rol]) {
      expect(tab.name).not.toContain('/');
      expect(tab.name).not.toContain('..');
      expect(tab.name.trim()).toBe(tab.name);
      expect(tab.name.length).toBeGreaterThan(0);
    }
  });
});
