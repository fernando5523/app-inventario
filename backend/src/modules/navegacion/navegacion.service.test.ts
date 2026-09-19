/**
 * Lo que se configura acá es PRESENTACION, pero una perilla mal puesta deja a
 * alguien sin poder trabajar: si el Administrador apaga "Mis hojas", el
 * contador abre la app y no tiene por donde entrar. Estos tests cuidan las
 * tres formas de equivocarse -- darle a un rol lo de otro, dejar la barra sin
 * espacio, y perder el rastro de quien lo hizo.
 *
 * Prisma mockeado, sin base (igual que el resto de la suite).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  configuracionNavegacion: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn((arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as () => unknown)())),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

const registrarAuditoriaMock = vi.hoisted(() => vi.fn());
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: registrarAuditoriaMock }));

import { Conflicto, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { ACCESOS_CATALOGO, MAXIMO_TABS, TABS_CATALOGO } from './navegacion.catalogo';
import {
  configuracionDe,
  guardar,
  navegacionDe,
  restablecer,
  validarCantidadDeTabs,
} from './navegacion.service';

const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };

beforeEach(() => {
  vi.clearAllMocks();
  // Sin filas guardadas: el resolutor cae en el catalogo, que es la fabrica.
  prismaMock.configuracionNavegacion.findMany.mockResolvedValue([]);
  prismaMock.configuracionNavegacion.upsert.mockResolvedValue({});
  prismaMock.configuracionNavegacion.deleteMany.mockResolvedValue({ count: 0 });
});

describe('configuracionDe: sin nada guardado, la fabrica', () => {
  it('devuelve el catalogo completo, en su orden, todo prendido', async () => {
    const config = await configuracionDe('auditor');
    expect(config.accesos.map((a) => a.ruta)).toEqual(ACCESOS_CATALOGO.auditor.map((a) => a.ruta));
    expect(config.accesos.every((a) => a.visible)).toBe(true);
    expect(config.tabs.map((t) => t.name)).toEqual(TABS_CATALOGO.auditor.map((t) => t.name));
  });

  it('lleva el maximo de tabs, para que la pantalla lo pueda explicar', async () => {
    expect((await configuracionDe('coordinador')).maximoTabs).toBe(MAXIMO_TABS);
  });

  it('lleva las notas del catalogo: es lo que el admin necesita ANTES de mover algo', async () => {
    const config = await configuracionDe('auditor');
    const liquidacion = config.accesos.find((a) => a.ruta === '/auditor/liquidacion');
    expect(liquidacion?.nota).toContain('2026-09-11');
  });
});

describe('configuracionDe: con lo guardado encima', () => {
  it('respeta el orden guardado, no el del catalogo', async () => {
    prismaMock.configuracionNavegacion.findMany.mockResolvedValue([
      { tipo: 'acceso', clave: '/conteo/mi-cuenta', orden: 1, visible: true },
      { tipo: 'acceso', clave: '/conteo/mis-hojas', orden: 2, visible: true },
    ]);
    const config = await configuracionDe('conteo');
    expect(config.accesos.map((a) => a.ruta)).toEqual(['/conteo/mi-cuenta', '/conteo/mis-hojas']);
  });

  it('un elemento apagado SIGUE APARECIENDO para el admin: apagado no es borrado', async () => {
    // Si desapareciera de la pantalla de configuracion, no habria forma de
    // volver a prenderlo.
    prismaMock.configuracionNavegacion.findMany.mockResolvedValue([
      { tipo: 'acceso', clave: '/conteo/mi-cuenta', orden: 2, visible: false },
    ]);
    const config = await configuracionDe('conteo');
    expect(config.accesos.find((a) => a.ruta === '/conteo/mi-cuenta')?.visible).toBe(false);
    expect(config.accesos).toHaveLength(ACCESOS_CATALOGO.conteo.length);
  });

  it('una fila huerfana (pantalla que ya no existe) se ignora en silencio', async () => {
    // Devolverla seria ofrecer una tarjeta que lleva a una ruta borrada.
    prismaMock.configuracionNavegacion.findMany.mockResolvedValue([
      { tipo: 'acceso', clave: '/conteo/pantalla-que-se-saco', orden: 1, visible: true },
    ]);
    const config = await configuracionDe('conteo');
    expect(config.accesos.map((a) => a.ruta)).not.toContain('/conteo/pantalla-que-se-saco');
  });

  it('un elemento nuevo del catalogo, sin fila, nace VISIBLE y al final', async () => {
    // Nacer apagado lo convertiria en una funcionalidad que se entrega y
    // nadie encuentra.
    prismaMock.configuracionNavegacion.findMany.mockResolvedValue([
      { tipo: 'acceso', clave: '/conteo/mi-cuenta', orden: 1, visible: true },
    ]);
    const config = await configuracionDe('conteo');
    const nuevo = config.accesos.find((a) => a.ruta === '/conteo/mis-hojas');
    expect(nuevo?.visible).toBe(true);
    expect(config.accesos[config.accesos.length - 1]?.ruta).toBe('/conteo/mis-hojas');
  });
});

describe('navegacionDe: lo que arma la app', () => {
  it('trae SOLO lo prendido: filtrar no es tarea de la app', async () => {
    // Si viajaran los apagados, una version vieja del movil que no filtre
    // seguiria mostrando lo que el admin apago.
    prismaMock.configuracionNavegacion.findMany.mockResolvedValue([
      { tipo: 'acceso', clave: '/conteo/mi-cuenta', orden: 2, visible: false },
      { tipo: 'tab', clave: 'contar', orden: 3, visible: false },
    ]);
    const nav = await navegacionDe('conteo');
    expect(nav.accesos.map((a) => a.ruta)).toEqual(['/conteo/mis-hojas']);
    expect(nav.tabs.map((t) => t.name)).toEqual(['index', 'mis-hojas']);
  });
});

describe('guardar: LA LISTA BLANCA', () => {
  /**
   * EL CASO QUE SOSTIENE EL CONTEO CIEGO. El backend deja pasar al
   * coordinador por `requiereRol` en el router de auditoria; lo que lo frena
   * acá es que la ruta no es de su grupo.
   */
  it('rechaza darle al coordinador una pantalla del auditor', async () => {
    await expect(
      guardar(admin, 'coordinador', 'acceso', [{ clave: '/auditor/auditoria', visible: true }]),
    ).rejects.toThrow(SolicitudInvalida);
    expect(prismaMock.configuracionNavegacion.upsert).not.toHaveBeenCalled();
  });

  it('el mensaje dice POR QUE, no solo que no se puede', async () => {
    await expect(
      guardar(admin, 'conteo', 'acceso', [{ clave: '/auditor/auditoria', visible: true }]),
    ).rejects.toThrow(/no existen para el rol conteo|conteo ciego/);
  });

  it('rechaza una clave que no existe en ningun catalogo', async () => {
    await expect(
      guardar(admin, 'conteo', 'acceso', [{ clave: '/conteo/inventada', visible: true }]),
    ).rejects.toThrow(SolicitudInvalida);
  });

  it('rechaza elementos repetidos: seria la misma tarjeta dos veces', async () => {
    await expect(
      guardar(admin, 'conteo', 'acceso', [
        { clave: '/conteo/mis-hojas', visible: true },
        { clave: '/conteo/mis-hojas', visible: true },
      ]),
    ).rejects.toThrow(SolicitudInvalida);
  });
});

describe('EL LIMITE DE TABS', () => {
  it(`deja pasar ${MAXIMO_TABS} prendidos`, () => {
    expect(() => validarCantidadDeTabs(MAXIMO_TABS)).not.toThrow();
    expect(() => validarCantidadDeTabs(1)).not.toThrow();
    expect(() => validarCantidadDeTabs(0)).not.toThrow();
  });

  /**
   * Se prueba con la funcion suelta y no por `guardar`: hoy ningun rol tiene
   * cinco tabs en el catalogo, asi que por ese camino la rama no se alcanza
   * con datos validos. Probarla igual es el punto -- es la guarda que va a
   * frenar al que agregue un quinto tab dentro de seis meses.
   */
  it('rechaza el quinto', () => {
    expect(() => validarCantidadDeTabs(MAXIMO_TABS + 1)).toThrow(Conflicto);
  });

  it('y EXPLICA la razon fisica, no dice "maximo 4"', () => {
    // "máximo 4" no le dice nada a quien lo lee; "Armar hojas no entra sin
    // cortarse" le dice que el limite es la pantalla, no una politica.
    expect(() => validarCantidadDeTabs(5)).toThrow(/no entra sin cortarse/);
  });

  it('los cuatro roles entran hoy en el limite', async () => {
    for (const rol of ['administrador', 'coordinador', 'conteo', 'auditor'] as const) {
      expect(TABS_CATALOGO[rol].length).toBeLessThanOrEqual(MAXIMO_TABS);
      const tabs = TABS_CATALOGO[rol].map((t) => ({ clave: t.name, visible: true }));
      await expect(guardar(admin, rol, 'tab', tabs)).resolves.toBeDefined();
    }
  });
});

describe('guardar: la escritura y el rastro', () => {
  it('escribe orden consecutivo desde 1, en el orden que llego', async () => {
    await guardar(admin, 'conteo', 'acceso', [
      { clave: '/conteo/mi-cuenta', visible: true },
      { clave: '/conteo/mis-hojas', visible: false },
    ]);
    const llamadas = prismaMock.configuracionNavegacion.upsert.mock.calls.map((c) => (c[0] as any).update);
    expect(llamadas).toEqual([
      { orden: 1, visible: true, actualizadoPorId: admin.colaboradorId },
      { orden: 2, visible: false, actualizadoPorId: admin.colaboradorId },
    ]);
  });

  /**
   * Sacarle un acceso a un rol puede dejar a alguien sin poder trabajar un
   * lunes a las 7 de la mañana. La pregunta es quien lo hizo y que habia
   * antes, y las dos tienen que estar en el log.
   */
  it('audita con el ANTES y el DESPUES completos, no solo lo que cambio', async () => {
    await guardar(admin, 'conteo', 'acceso', [{ clave: '/conteo/mis-hojas', visible: false }]);
    const [registro] = registrarAuditoriaMock.mock.calls[0] as [any];
    expect(registro.actorId).toBe(admin.colaboradorId);
    expect(registro.accion).toBe('navegacion.actualizada');
    expect(registro.detalle.rol).toBe('conteo');
    expect(Array.isArray(registro.detalle.antes)).toBe(true);
    expect(Array.isArray(registro.detalle.despues)).toBe(true);
    expect(registro.detalle.antes.length).toBeGreaterThan(0);
  });
});

describe('restablecer: la salida cuando alguien se equivoca', () => {
  it('borra las filas del rol y tipo: sin filas, manda el catalogo', async () => {
    // Borrar y no reescribir, para que no haya dos definiciones de "como
    // venia de fabrica" que puedan separarse.
    await restablecer(admin, 'auditor', 'acceso');
    expect(prismaMock.configuracionNavegacion.deleteMany).toHaveBeenCalledWith({
      where: { rol: 'auditor', tipo: 'acceso' },
    });
  });

  it('deja rastro de lo que habia antes de volver a fabrica', async () => {
    await restablecer(admin, 'auditor', 'tab');
    const [registro] = registrarAuditoriaMock.mock.calls[0] as [any];
    expect(registro.accion).toBe('navegacion.restablecida');
    expect(registro.detalle.tipo).toBe('tab');
  });

  it('no toca el otro tipo: restablecer los tabs no desordena los accesos', async () => {
    await restablecer(admin, 'auditor', 'tab');
    expect(prismaMock.configuracionNavegacion.deleteMany).toHaveBeenCalledTimes(1);
  });
});
