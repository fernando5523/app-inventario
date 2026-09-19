/**
 * La siembra tiene una sola promesa y es la que mas facil se rompe sin que
 * nadie lo note: lo que ya estaba NO SE TOCA, y lo nuevo no puede quedar
 * peleando un lugar con lo viejo.
 *
 * Vive en prisma/ y no en src/ por el mismo motivo que
 * `sincronizar-secuencias.test.ts`: tsconfig solo compila los .ts de src/, y
 * vitest lo encuentra igual.
 */

import { describe, expect, it } from 'vitest';
import { ACCESOS_CATALOGO, TABS_CATALOGO } from '../src/modules/navegacion/navegacion.catalogo';
import { filasDeLaSiembra } from './sembrar-navegacion';

describe('filasDeLaSiembra', () => {
  it('siembra TODO el catalogo: un elemento de menos es una tarjeta que nadie ve', () => {
    const esperadas =
      Object.values(ACCESOS_CATALOGO).reduce((n, lista) => n + lista.length, 0) +
      Object.values(TABS_CATALOGO).reduce((n, lista) => n + lista.length, 0);
    expect(filasDeLaSiembra()).toHaveLength(esperadas);
  });

  it('el orden de cada rol es el del catalogo, desde 1 y de a uno', () => {
    // Es la mitad del pedido del cliente: el dia 1 los cuatro roles ven lo
    // mismo que veian antes, en el mismo orden.
    for (const [rol, accesos] of Object.entries(ACCESOS_CATALOGO)) {
      const delRol = filasDeLaSiembra().filter((f) => f.rol === rol && f.tipo === 'acceso');
      expect(delRol.map((f) => f.clave)).toEqual(accesos.map((a) => a.ruta));
      expect(delRol.map((f) => f.orden)).toEqual(accesos.map((_, i) => i + 1));
    }
  });

  it('no hay dos filas con la misma clave dentro de un rol y tipo', () => {
    // Chocarian contra el @@unique([rol, tipo, clave]) al sembrar.
    const vistas = new Set<string>();
    for (const f of filasDeLaSiembra()) {
      const id = `${f.rol}:${f.tipo}:${f.clave}`;
      expect(vistas.has(id)).toBe(false);
      vistas.add(id);
    }
  });

  it('ningun orden se repite dentro de un mismo rol y tipo', () => {
    /**
     * EL BUG QUE ESTE TEST FIJA. La primera version insertaba con el indice
     * del catalogo, asi que una pantalla agregada EN EL MEDIO -- "Accesos y
     * menus", entre "Configuracion" e "Historial" -- entraba con un orden que
     * otra fila ya tenia. Quedaban dos con orden 4 y cual iba primero pasaba a
     * depender de como las devolviera Postgres.
     */
    const porGrupo = new Map<string, number[]>();
    for (const f of filasDeLaSiembra()) {
      const grupo = `${f.rol}:${f.tipo}`;
      porGrupo.set(grupo, [...(porGrupo.get(grupo) ?? []), f.orden]);
    }
    for (const [grupo, ordenes] of porGrupo) {
      expect(new Set(ordenes).size, `ordenes repetidos en ${grupo}`).toBe(ordenes.length);
    }
  });
});
