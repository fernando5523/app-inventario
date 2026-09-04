/**
 * La doble validación del lacrado es un control de DOS PERSONAS, y estos
 * tests son lo que impide que vuelva a degradarse en un botón doble.
 *
 * Hasta el 2026-09-03 `aprobar()` recibía un `colaboradorId` por
 * parámetro: la pantalla mostraba los dos botones "Aprobar" a la vez y el
 * auditor logueado podía firmar por el otro. Dos firmas registradas, una
 * sola persona presente, en el acto que cierra el inventario del mes.
 *
 * La regla ahora es: la firma se registra contra el colaborador de la
 * SESIÓN ACTIVA. Si alguno de estos tests se vuelve verde aflojando esa
 * regla, el control dejó de valer.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { registrarInventario } from './_compartido';
import { lacradoMemoria } from './lacrado-memoria';
import { sesionMemoria } from './sesion-memoria';

/** Padrón de Market Central Luzuriaga (sucursal 1), ver sesion-memoria.ts. */
const GILMER = 103; // auditor
const ROSA = 106; // auditora
const MARIA = 102; // conteo
const JOSE = 101; // coordinador
const NILDA = 203; // auditora, pero de Market Carhuaz (sucursal 2)

const PIN = '123456';

/**
 * Un inventario NUEVO por test. El store de aprobaciones vive en un Map
 * de módulo indexado por inventarioId, así que estrenar id es lo que
 * aísla un caso del anterior sin exponer un `reset()` que en producción
 * no debería existir.
 */
function inventarioNuevo(sucursalId = 1): number {
  return registrarInventario(sucursalId, 8000, new Date().toISOString()).id;
}

beforeEach(async () => {
  await sesionMemoria.cerrar();
});

describe('lacradoMemoria.aprobar — la firma es de quien está en sesión', () => {
  it('registra la aprobación del auditor logueado, con su nombre y la fecha', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(GILMER, PIN);

    const estado = await lacradoMemoria.aprobar(inventarioId);

    expect(estado.aprobaciones).toHaveLength(1);
    expect(estado.aprobaciones[0].colaboradorId).toBe(GILMER);
    expect(estado.aprobaciones[0].nombre).toBe('Gilmer Quispe');
    // Una firma sin cuándo no es auditable.
    expect(Number.isNaN(Date.parse(estado.aprobaciones[0].fecha))).toBe(false);
  });

  it('el mismo auditor NO puede firmar dos veces — dos toques no son dos personas', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(GILMER, PIN);
    await lacradoMemoria.aprobar(inventarioId);

    await expect(lacradoMemoria.aprobar(inventarioId)).rejects.toThrow(/ya aprobó/i);

    const estado = await lacradoMemoria.estado(inventarioId);
    expect(estado.aprobaciones).toHaveLength(1);
  });

  it('completa la doble validación recién con DOS auditores distintos, en dos sesiones', async () => {
    const inventarioId = inventarioNuevo();

    await sesionMemoria.ingresar(GILMER, PIN);
    await lacradoMemoria.aprobar(inventarioId);
    await sesionMemoria.cerrar();

    await sesionMemoria.ingresar(ROSA, PIN);
    const estado = await lacradoMemoria.aprobar(inventarioId);

    expect(estado.aprobaciones).toHaveLength(estado.aprobacionesRequeridas);
    expect(estado.aprobaciones.map((a) => a.colaboradorId)).toEqual([GILMER, ROSA]);
    // Lo que el control promete: dos identidades distintas, no dos filas.
    expect(new Set(estado.aprobaciones.map((a) => a.colaboradorId)).size).toBe(2);
  });

  it('sin sesión activa no se puede firmar', async () => {
    const inventarioId = inventarioNuevo();

    await expect(lacradoMemoria.aprobar(inventarioId)).rejects.toThrow(/sesión activa/i);
  });

  it('un Conteo o un Coordinador logueado no puede firmar', async () => {
    const inventarioId = inventarioNuevo();

    await sesionMemoria.ingresar(MARIA, PIN);
    await expect(lacradoMemoria.aprobar(inventarioId)).rejects.toThrow(/solo un auditor/i);

    await sesionMemoria.cerrar();
    await sesionMemoria.ingresar(JOSE, PIN);
    await expect(lacradoMemoria.aprobar(inventarioId)).rejects.toThrow(/solo un auditor/i);

    const estado = await lacradoMemoria.estado(inventarioId);
    expect(estado.aprobaciones).toHaveLength(0);
  });

  it('un auditor de OTRA sucursal no puede firmar este inventario', async () => {
    const inventarioId = inventarioNuevo(1);

    await sesionMemoria.ingresar(NILDA, PIN);
    await expect(lacradoMemoria.aprobar(inventarioId)).rejects.toThrow(/sucursal/i);
  });

  it('una vez lacrado no se agregan más firmas', async () => {
    const inventarioId = inventarioNuevo();

    await sesionMemoria.ingresar(GILMER, PIN);
    await lacradoMemoria.aprobar(inventarioId);
    await sesionMemoria.cerrar();
    await sesionMemoria.ingresar(ROSA, PIN);
    await lacradoMemoria.aprobar(inventarioId);

    // Un inventario recién registrado no tiene hojas, así que "todo
    // sincronizado" se cumple y lacrar procede: acá lo que se prueba es
    // el portón de las firmas después del lacrado, no el de la sync.
    await lacradoMemoria.lacrar(inventarioId);

    await sesionMemoria.cerrar();
    await sesionMemoria.ingresar(GILMER, PIN);
    await expect(lacradoMemoria.aprobar(inventarioId)).rejects.toThrow(/ya está lacrado/i);
  });
});

describe('lacradoMemoria.lacrar — el portón no depende de la pantalla', () => {
  it('rechaza con una sola firma, aunque la pantalla hubiera habilitado el botón', async () => {
    const inventarioId = inventarioNuevo();
    await sesionMemoria.ingresar(GILMER, PIN);
    await lacradoMemoria.aprobar(inventarioId);

    await expect(lacradoMemoria.lacrar(inventarioId)).rejects.toThrow(/faltan aprobaciones/i);
  });
});
