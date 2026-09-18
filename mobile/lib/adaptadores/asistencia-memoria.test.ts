/**
 * La asistencia registrada es la base de la multa por día faltado: cada marca
 * que sobra o falta acá es plata que se le descuenta (o no) a alguien del
 * sueldo. Estos tests cubren justamente lo que costaría dinero si se
 * rompiera.
 *
 * Hasta este cambio la asistencia se DEDUCÍA de las hojas con conteos, y
 * quien venía y no llegaba a contar figuraba como ausente. Si alguno de estos
 * tests se pone verde aflojando una guarda, vuelve la misma clase de error
 * con otra cara.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { registrarInventario } from './_compartido';
import { asistenciaMemoria, limpiarAsistenciaMemoria } from './asistencia-memoria';
import { sesionMemoria } from './sesion-memoria';

/** Padrón de Market Bolívar (sucursal 3), ver sesion-memoria.ts. */
const BOLIVAR = 3;
const OSCAR = 301; // coordinador
const SILVIA = 302; // conteo
const JORGE = 303; // auditor -- NO es personal de tienda
const DELIA = 304; // conteo

/** Market Carhuaz (sucursal 2): su coordinadora no puede tocar Bolívar. */
const ANA = 201; // coordinadora de Carhuaz
const ADMIN = 1000;

const PIN = '123456';

const DIA_1 = '2026-09-14';
const DIA_2 = '2026-09-15';
const DIA_3 = '2026-09-16';

/** Un inventario NUEVO por test: estrenar id es lo que aísla un caso del anterior. */
function inventarioNuevo(sucursalId = BOLIVAR): number {
  return registrarInventario(sucursalId, 4000, new Date().toISOString()).id;
}

beforeEach(async () => {
  limpiarAsistenciaMemoria();
  await sesionMemoria.cerrar();
});

describe('asistenciaMemoria.deInventario', () => {
  it('sin ninguna marca devuelve el padrón completo y cero días: un inventario que no empezó', async () => {
    const inventarioId = inventarioNuevo();

    const asistencia = await asistenciaMemoria.deInventario(inventarioId);

    expect(asistencia.dias).toEqual([]);
    expect(asistencia.marcas).toEqual([]);
    expect(asistencia.personal.map((p) => p.id)).toContain(SILVIA);
  });

  /** Regla del cliente desde 233f4b7: el auditor no es personal de tienda. */
  it('el padrón NO incluye al auditor: no se le marca asistencia ni se le cobra multa', async () => {
    const asistencia = await asistenciaMemoria.deInventario(inventarioNuevo());

    expect(asistencia.personal.map((p) => p.id)).not.toContain(JORGE);
    expect(asistencia.personal.every((p) => p.rol === 'coordinador' || p.rol === 'conteo')).toBe(true);
  });

  it('los días vienen ordenados y sin repetir: son la duración del inventario, no la lista de marcas', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);
    // A propósito fuera de orden y con dos personas el mismo día.
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_3);
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);
    await asistenciaMemoria.marcar(inventarioId, DELIA, DIA_1);

    const asistencia = await asistenciaMemoria.deInventario(inventarioId);

    expect(asistencia.dias).toEqual([DIA_1, DIA_3]);
    expect(asistencia.marcas).toHaveLength(3);
  });

  it('cada inventario tiene su propia asistencia: una marca no se filtra al de al lado', async () => {
    const unInventario = inventarioNuevo();
    const otroInventario = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);
    await asistenciaMemoria.marcar(unInventario, SILVIA, DIA_1);

    expect((await asistenciaMemoria.deInventario(otroInventario)).marcas).toEqual([]);
  });
});

describe('asistenciaMemoria.marcar — quién puede y a quién', () => {
  it('el Coordinador registra la entrada con su hora', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);

    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);

    const { marcas } = await asistenciaMemoria.deInventario(inventarioId);
    expect(marcas).toHaveLength(1);
    expect(marcas[0]).toMatchObject({ colaboradorId: SILVIA, dia: DIA_1 });
    // Una marca sin cuándo no es auditable.
    expect(Number.isNaN(Date.parse(marcas[0].registradoEn))).toBe(false);
  });

  it('el Administrador también: entra a todas las tiendas', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(ADMIN, PIN);

    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);

    expect((await asistenciaMemoria.deInventario(inventarioId)).marcas).toHaveLength(1);
  });

  it('sin sesión NO se puede marcar: quién registró es parte del hecho', async () => {
    const inventarioId = inventarioNuevo();

    await expect(asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1)).rejects.toThrow(/sesión activa/i);
  });

  it('quien cuenta no puede marcarse a sí mismo', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(SILVIA, PIN);

    await expect(asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1)).rejects.toThrow(/Coordinador o un Administrador/i);
  });

  it('el auditor tampoco: la asistencia la lleva el Coordinador', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(JORGE, PIN);

    await expect(asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1)).rejects.toThrow(/Coordinador o un Administrador/i);
  });

  it('un Coordinador de OTRA tienda no puede marcar en esta', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(ANA, PIN);

    await expect(asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1)).rejects.toThrow(/sucursal del inventario/i);
  });

  it('no se le puede marcar asistencia al auditor: está afuera de la planilla', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);

    await expect(asistenciaMemoria.marcar(inventarioId, JORGE, DIA_1)).rejects.toThrow(/personal de tienda/i);
  });

  it('ni a alguien de otra tienda', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);

    await expect(asistenciaMemoria.marcar(inventarioId, ANA, DIA_1)).rejects.toThrow(/personal de tienda/i);
  });
});

describe('asistenciaMemoria.marcar — idempotencia', () => {
  /**
   * La hora que vale es la de cuando la persona LLEGÓ. Si un segundo toque la
   * pisara, bastaría con que el Coordinador volviera a tocar el botón a la
   * tarde para que la entrada de la mañana desapareciera del registro.
   */
  it('marcar dos veces el mismo día no duplica la marca ni mueve la hora de entrada', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);
    const primera = (await asistenciaMemoria.deInventario(inventarioId)).marcas[0].registradoEn;

    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);

    const { marcas, dias } = await asistenciaMemoria.deInventario(inventarioId);
    expect(marcas).toHaveLength(1);
    expect(marcas[0].registradoEn).toBe(primera);
    expect(dias).toEqual([DIA_1]);
  });

  it('la misma persona en días distintos son dos marcas: dos días trabajados', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);

    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_2);

    const { marcas, dias } = await asistenciaMemoria.deInventario(inventarioId);
    expect(marcas).toHaveLength(2);
    expect(dias).toEqual([DIA_1, DIA_2]);
  });
});

describe('asistenciaMemoria.quitar', () => {
  it('borra solo la marca de esa persona ese día', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_2);
    await asistenciaMemoria.marcar(inventarioId, DELIA, DIA_1);

    await asistenciaMemoria.quitar(inventarioId, SILVIA, DIA_1);

    const { marcas } = await asistenciaMemoria.deInventario(inventarioId);
    expect(marcas.map((m) => `${m.colaboradorId}|${m.dia}`).sort()).toEqual([`${SILVIA}|${DIA_2}`, `${DELIA}|${DIA_1}`]);
  });

  it('quitar el último presente de un día saca ese día del inventario: los días salen de las marcas', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);
    await asistenciaMemoria.marcar(inventarioId, DELIA, DIA_2);

    await asistenciaMemoria.quitar(inventarioId, DELIA, DIA_2);

    expect((await asistenciaMemoria.deInventario(inventarioId)).dias).toEqual([DIA_1]);
  });

  it('quitar una marca que no existe no truena: un reintento tras un timeout no puede fallar', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);

    await expect(asistenciaMemoria.quitar(inventarioId, SILVIA, DIA_1)).resolves.toBeUndefined();
  });

  it('pide los mismos permisos que marcar: no se borra una jornada desde otra tienda', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(OSCAR, PIN);
    await asistenciaMemoria.marcar(inventarioId, SILVIA, DIA_1);
    await sesionMemoria.cerrar();
    await sesionMemoria.ingresar(ANA, PIN);

    await expect(asistenciaMemoria.quitar(inventarioId, SILVIA, DIA_1)).rejects.toThrow(/sucursal del inventario/i);
    await sesionMemoria.cerrar();
    await sesionMemoria.ingresar(OSCAR, PIN);
    expect((await asistenciaMemoria.deInventario(inventarioId)).marcas).toHaveLength(1);
  });
});
