/**
 * EL AUDITOR SE ELIGE EN SU TIENDA -- y eso NO lo mete en la tienda.
 *
 * Decisión del usuario (2026-09-22): a Gilmer le resultaba raro entrar por el
 * grupo de arriba. Ahora aparece en los DOS lados. Lo que estos tests cuidan
 * es la mitad peligrosa: que elegirse ahí no lo convierta en personal de
 * tienda, porque ahí le empezarían a caer hojas de conteo, entraría a la
 * planilla de liquidación y habría que marcarle asistencia.
 *
 * Es paridad con `sesion.service.ts` del backend, donde la misma distinción
 * vive en dos constantes: `ROLES_DE_TIENDA` (quién pertenece) y
 * `ROLES_QUE_SE_ELIGEN_EN_LA_TIENDA` (quién aparece en esa lista del login).
 */

import { describe, expect, it } from 'vitest';

import { sesionMemoria } from './sesion-memoria';

/** Luzuriaga (1) tiene a Gilmer Quispe (103) y Rosa Melgarejo (106). */
const LUZURIAGA = 1;
const BOLIVAR = 2;
const GILMER = 103;

describe('colaboradores(sucursalId): quién se elige dentro de una tienda', () => {
  it('el auditor de Luzuriaga SALE en la lista de Luzuriaga', async () => {
    const lista = await sesionMemoria.colaboradores(LUZURIAGA);
    expect(lista.map((c) => c.id)).toContain(GILMER);
  });

  it('y NO sale en la lista de otra tienda', async () => {
    const lista = await sesionMemoria.colaboradores(BOLIVAR);
    expect(lista.map((c) => c.id)).not.toContain(GILMER);
  });

  it('sigue habiendo coordinador y conteo: el auditor se SUMA, no reemplaza', async () => {
    const roles = new Set((await sesionMemoria.colaboradores(LUZURIAGA)).map((c) => c.rol));
    expect(roles).toContain('coordinador');
    expect(roles).toContain('conteo');
    expect(roles).toContain('auditor');
  });

  /** El administrador es del sistema: no cuelga de ninguna tienda. */
  it('el administrador NO aparece bajo una sucursal', async () => {
    const roles = (await sesionMemoria.colaboradores(LUZURIAGA)).map((c) => c.rol);
    expect(roles).not.toContain('administrador');
  });
});

describe('administradores(): el grupo de arriba no cambió', () => {
  /**
   * ESTAR EN LOS DOS LADOS ES DELIBERADO: el auditor audita toda la cadena y
   * tiene que poder entrar sin elegir tienda.
   */
  it('el auditor SIGUE apareciendo en el grupo de arriba', async () => {
    const arriba = await sesionMemoria.administradores();
    expect(arriba.map((c) => c.id)).toContain(GILMER);
  });

  it('y el administrador también', async () => {
    const roles = (await sesionMemoria.administradores()).map((c) => c.rol);
    expect(roles).toContain('administrador');
  });
});

/**
 * EL SUBTÍTULO NO PUEDE PROMETER OTRO NÚMERO QUE EL DE LA LISTA. Es la
 * lección del bug de "11 acá y 9 allá": si el conteo y la lista se calculan
 * con filtros distintos, la tarjeta dice 9 y abre una lista de 10.
 */
describe('el conteo de la tarjeta coincide con la lista', () => {
  it('sucursales(): cada tienda cuenta exactamente lo que va a listar', async () => {
    const sucursales = await sesionMemoria.sucursales();
    for (const s of sucursales) {
      const lista = await sesionMemoria.colaboradores(s.id);
      expect(s.colaboradores).toBe(lista.length);
    }
  });

  it('la sucursal de la SESIÓN cuenta lo mismo que la tarjeta', async () => {
    const [tarjeta] = await sesionMemoria.sucursales();
    const sesion = await sesionMemoria.ingresar(GILMER, '123456');
    if (sesion.sucursal !== null && sesion.sucursal.id === tarjeta!.id) {
      expect(sesion.sucursal.colaboradores).toBe(tarjeta!.colaboradores);
    }
  });
});

/**
 * LA MITAD PELIGROSA DEL CAMBIO, verificada contra los adaptadores REALES.
 *
 * `colaboradores(sucursalId)` la usan cinco consumidores internos del modo
 * demo además del login. Si el auditor entrara ahí sin filtrar, aparecería
 * como alguien a quien marcarle asistencia, a quien liquidarle y a quien
 * repartirle hojas -- que es exactamente lo que `ROLES_DE_TIENDA` evita en el
 * backend. Cada uno filtra por su cuenta con `esDeTienda`, y esto lo prueba.
 */
describe('el auditor NO se coló en asistencia, usuarios ni liquidación', () => {
  it('la asistencia del inventario no lo incluye', async () => {
    const { asistenciaMemoria } = await import('./asistencia-memoria');
    const { inventarioMemoria } = await import('./inventario-memoria');
    const activo = await inventarioMemoria.activo(LUZURIAGA);
    if (activo === null) return;

    const { personal } = await asistenciaMemoria.deInventario(activo.inventarioId);
    expect(personal.map((p) => p.id)).not.toContain(GILMER);
    expect(personal.map((p) => p.rol)).not.toContain('auditor');
  });

  it('la planilla de liquidación no le cobra multa ni le paga cuota', async () => {
    const { liquidacionMemoria } = await import('./liquidacion-memoria');
    const liq = await liquidacionMemoria.deSucursal(LUZURIAGA);
    if (liq === null) return;

    // `planilla`: una fila por colaborador alcanzado. Al auditor no le toca
    // ni cuota ni multa, asi que no tiene fila.
    expect(liq.planilla.map((f) => f.colaboradorId)).not.toContain(GILMER);
    expect(liq.planilla.map((f) => f.rol)).not.toContain('auditor');
  });

  /**
   * Usuarios NO lo lista, y no cambió: esa semilla recorre las sucursales
   * tomando lo que devuelve `colaboradores()`, así que sin el filtro el
   * auditor habría aparecido ahí de rebote -- una pantalla nueva llena de
   * gente que nadie agregó.
   */
  it('Usuarios sigue listando solo personal de tienda', async () => {
    const { usuariosMemoria } = await import('./usuarios-memoria');
    const todos = await usuariosMemoria.listar(undefined);
    expect(todos.map((u) => u.id)).not.toContain(GILMER);
    expect(todos.map((u) => u.rol)).not.toContain('auditor');
  });
});
