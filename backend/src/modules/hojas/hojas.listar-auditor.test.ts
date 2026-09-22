/**
 * EL AUDITOR PUEDE LISTAR LAS HOJAS DE CUALQUIER SUCURSAL.
 *
 * Hallazgo del emulador: Teresa (auditora de la sucursal 26) abrio "Corregir
 * lo contado" sobre un inventario de OTRA tienda y la pantalla mostro
 * "0 items sin cuadrar de 0". No era que la ronda estuviera vacia: el listado
 * de hojas le devolvia 404, asi que no habia contra que corregir -- y ese
 * listado es el que da el `hojaId` que pide el PATCH de correccion.
 *
 * LA INCOHERENCIA QUE CERRO ESTE ARREGLO: desde que el Auditor entro a
 * `ROLES_QUE_CORRIGEN`, podia ESCRIBIR una correccion sobre un conteo que no
 * podia LEER. El PATCH le funcionaba (verificado por API) y el GET no.
 *
 * Prisma mockeado, sin base.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  hojaConteo: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { NoEncontrado, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { listar } from './hojas.service';

const SUCRE = 26;
const OTRA = 47;

// Teresa: auditora con la sucursal vieja en la ficha. El auditor no pertenece
// a ninguna tienda (decision del cliente), pero su fila puede tener una.
const teresa: ColaboradorAutenticado = { colaboradorId: 1071, sucursalId: SUCRE, rol: 'auditor' };
const auditorSinTienda: ColaboradorAutenticado = { colaboradorId: 9, sucursalId: null, rol: 'auditor' };
const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const coordDeSucre: ColaboradorAutenticado = { colaboradorId: 1068, sucursalId: SUCRE, rol: 'coordinador' };
const contadorDeSucre: ColaboradorAutenticado = { colaboradorId: 1069, sucursalId: SUCRE, rol: 'conteo' };

const QUERY = { inventarioId: 8060, alcance: 'todas' as const, ronda: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  // El inventario es de OTRA sucursal, no la de la ficha de Teresa.
  prismaMock.inventario.findUnique.mockResolvedValue({ id: 8060, sucursalId: OTRA });
  prismaMock.hojaConteo.findMany.mockResolvedValue([]);
});

describe('listar: el cerco por sucursal', () => {
  it('el Auditor lista las hojas de una tienda que no es la de su ficha', async () => {
    await expect(listar(teresa, QUERY)).resolves.toEqual([]);
    expect(prismaMock.hojaConteo.findMany).toHaveBeenCalled();
  });

  it('y el auditor sin tienda en la ficha, tambien', async () => {
    await expect(listar(auditorSinTienda, QUERY)).resolves.toEqual([]);
  });

  it('el administrador sigue pasando', async () => {
    await expect(listar(admin, QUERY)).resolves.toEqual([]);
  });

  /**
   * EL RECORTE SIGUE EN PIE PARA LOS ROLES DE TIENDA: sin esto, cualquier
   * coordinador leeria el inventario de otra tienda cambiando un id en la URL.
   */
  it('el Coordinador de otra tienda sigue recibiendo 404', async () => {
    await expect(listar(coordDeSucre, QUERY)).rejects.toThrow(NoEncontrado);
    expect(prismaMock.hojaConteo.findMany).not.toHaveBeenCalled();
  });

  /**
   * EL ORDEN IMPORTA Y ES EL CORRECTO: al rol `conteo` lo corta primero el
   * conteo ciego (`validarAlcance`, 403) y recien despues el cerco de
   * sucursal. Pidiendo solo LO SUYO (`alcance=mias`) llega al cerco y ahi
   * recibe el 404 -- que es lo que este test fija.
   */
  it('el rol conteo de otra tienda, 404 aun pidiendo solo lo suyo', async () => {
    await expect(listar(contadorDeSucre, { ...QUERY, alcance: 'mias' })).rejects.toThrow(NoEncontrado);
    expect(prismaMock.hojaConteo.findMany).not.toHaveBeenCalled();
  });

  it('y el conteo ciego se valida ANTES que la sucursal: `todas` da 403, no 404', async () => {
    await expect(listar(contadorDeSucre, QUERY)).rejects.toThrow(Prohibido);
  });

  it('y el Coordinador SI entra a la suya', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 8040, sucursalId: SUCRE });
    await expect(listar(coordDeSucre, { ...QUERY, inventarioId: 8040 })).resolves.toEqual([]);
  });

  /**
   * El cerco se levanta por SUCURSAL, no el del conteo ciego: un contador
   * sigue sin poder pedir el lote entero, ni de su propia tienda.
   */
  it('el rol conteo sigue sin poder pedir `alcance=todas`', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 8040, sucursalId: SUCRE });
    await expect(listar(contadorDeSucre, { ...QUERY, inventarioId: 8040 })).rejects.toThrow(Prohibido);
  });
});

/**
 * LA RONDA VIAJA TAL CUAL A LA CONSULTA. Es lo que va a necesitar el selector
 * de ronda de la pantalla: pedir la ronda 1 con la 2 ya abierta tiene que
 * devolver las hojas de la 1, que son las que se corrigen.
 */
describe('listar: se puede pedir una ronda anterior', () => {
  it('filtra por la ronda pedida, no por la mas alta', async () => {
    await listar(teresa, { ...QUERY, ronda: 1 });

    expect(prismaMock.hojaConteo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ inventarioId: 8060, numeroConteo: 1 }) }),
    );
  });

  it('y una ronda extra del Auditor tambien', async () => {
    await listar(teresa, { ...QUERY, ronda: 5 });

    expect(prismaMock.hojaConteo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ numeroConteo: 5 }) }),
    );
  });
});
