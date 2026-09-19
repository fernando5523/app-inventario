/**
 * La ruta de CORRECCION del Coordinador:
 * `PATCH /api/hojas/:id/conteos/:productoId/corregir`.
 *
 * Los 4 roles entran al router de hojas -- el recorte fino no vive en la ruta
 * sino en `hojas.permisos.ts` y, para la correccion, en
 * `ajuste.permisos.ts#validarCorreccion`, porque depende del estado del
 * INVENTARIO y no solo del rol. Asi que lo que este archivo puede probar es
 * lo que solo se rompe en la capa HTTP: que la ruta exista, que exija sesion
 * y que el `motivo` se corte en el middleware, antes de tocar nada.
 *
 * Quien puede corregir y en que ventana se prueba sin base en
 * `ajuste.permisos.test.ts` y `hojas.correccion.test.ts`.
 */

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appDePrueba, autorizacion, controllerFalso, levantar } from '../../test-utils/http-test';

vi.mock('../sesion/sesion.service', () => ({
  verificarToken: async (token: string) => {
    try {
      return JSON.parse(token) as ColaboradorAutenticado;
    } catch {
      return null;
    }
  },
}));
vi.mock('./hojas.controller', () =>
  controllerFalso(['listar', 'detalle', 'productos', 'productoPorBarras', 'guardarConteo', 'finalizar', 'corregirConteo']),
);

import { hojasRouter } from './hojas.routes';

const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 301, sucursalId: 3, rol: 'coordinador' };

let cerrar: () => Promise<void>;
let baseUrl: string;

async function iniciar(): Promise<void> {
  ({ baseUrl, cerrar } = await levantar(appDePrueba('/api/hojas', hojasRouter)));
}

function corregir(actor: ColaboradorAutenticado | null, cuerpo: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/hojas/7/conteos/512/corregir`, {
    method: 'PATCH',
    headers: { ...(actor ? autorizacion(actor) : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

afterEach(async () => {
  await cerrar?.();
});

describe('PATCH /api/hojas/:id/conteos/:productoId/corregir', () => {
  const VALIDO = { empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }], sueltas: 3, motivo: 'Contó de más' };

  it('la ruta existe y deja pasar al Coordinador', async () => {
    await iniciar();
    // 404 aca significaria que el router nunca registro la ruta.
    expect((await corregir(COORDINADOR, VALIDO)).status).toBe(200);
  });

  it('sin sesion, 401', async () => {
    await iniciar();
    expect((await corregir(null, VALIDO)).status).toBe(401);
  });

  /**
   * EL MOTIVO SE CORTA EN EL MIDDLEWARE, antes de llegar al service. Estos
   * valores descuentan plata del sueldo de la gente y quedan sellados en el
   * lacrado: un cambio sin motivo es un descuento que nadie puede explicar
   * seis meses despues.
   */
  it('sin motivo, 400 antes de tocar nada', async () => {
    await iniciar();
    const { motivo: _omitido, ...sinMotivo } = VALIDO;
    expect((await corregir(COORDINADOR, sinMotivo)).status).toBe(400);
  });

  it('con un motivo de un caracter, 400: parece contestado y no dice nada', async () => {
    await iniciar();
    expect((await corregir(COORDINADOR, { ...VALIDO, motivo: '.' })).status).toBe(400);
  });

  /**
   * `contadoEn` es de quien conto en la gondola y `confirmadoPorEscaner` lo
   * pone el escaner: quien corrige no manda ninguno de los dos. El schema es
   * `.strict()` justamente para que un cliente que los mande se entere.
   */
  it('mandando contadoEn o confirmadoPorEscaner, 400', async () => {
    await iniciar();
    expect((await corregir(COORDINADOR, { ...VALIDO, contadoEn: new Date().toISOString() })).status).toBe(400);
    expect((await corregir(COORDINADOR, { ...VALIDO, confirmadoPorEscaner: true })).status).toBe(400);
  });

  /**
   * El PUT de la gondola sigue existiendo y es OTRA operacion: crea o
   * reemplaza el conteo, exige estar asignado y rechaza la hoja finalizada.
   * Dos verbos para dos reglas distintas sobre la misma fila.
   */
  it('el PUT de la gondola sigue montado aparte', async () => {
    await iniciar();
    const r = await fetch(`${baseUrl}/api/hojas/7/conteos/512`, {
      method: 'PUT',
      headers: { ...autorizacion(COORDINADOR), 'Content-Type': 'application/json' },
      body: JSON.stringify({ empaques: [], sueltas: 1, contadoEn: '2026-09-18T10:00:00.000Z' }),
    });
    expect(r.status).toBe(200);
  });
});
