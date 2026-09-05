/**
 * El adaptador en memoria del ciclo de rondas. No simula el cuadre contra el
 * ERP (no existe en memoria), pero SÍ tiene que respetar el portón que importa
 * para desarrollar la pantalla: no se cierra una ronda con hojas sin finalizar.
 *
 * El inventario de Market Central Luzuriaga arranca sembrado con hojas sin
 * finalizar (ver _compartido.ts), así que es el caso "no se puede cerrar" — el
 * que la pantalla tiene que dibujar con el botón deshabilitado y el motivo.
 */

import { describe, expect, it } from 'vitest';

import { inventarioMemoria } from './inventario-memoria';
import { obtenerInventarioDeSucursal } from './_compartido';

const SUCURSAL_LUZURIAGA = 1;

async function inventarioSembrado(): Promise<number> {
  const inv = await obtenerInventarioDeSucursal(SUCURSAL_LUZURIAGA);
  if (!inv) throw new Error('El inventario sembrado de Luzuriaga no está disponible en memoria.');
  return inv.id;
}

describe('inventarioMemoria.resumenRonda', () => {
  it('refleja el estado REAL de finalización: con hojas a medias, no se puede cerrar', async () => {
    const id = await inventarioSembrado();
    const r = await inventarioMemoria.resumenRonda(id, 1);

    expect(r.inventarioId).toBe(id);
    expect(r.ronda).toBe(1);
    // El dataset sembrado tiene hojas sin finalizar.
    expect(r.hojasSinFinalizar.length).toBeGreaterThan(0);
    expect(r.sePuedeCerrar).toBe(false);
    // `contados + sinContar` siempre cierra contra el total (misma invariante
    // que el backend).
    expect(r.contados + r.sinContar).toBe(r.total);
  });

  it('no inventa cuadre contra el ERP: sin stock, todo queda como sinDatoErp', async () => {
    const id = await inventarioSembrado();
    const r = await inventarioMemoria.resumenRonda(id, 1);
    // Memoria no tiene el stock de Dynamics: no puede afirmar que algo cuadró.
    expect(r.cuadrados).toBe(0);
    expect(r.sinDatoErp).toBe(r.total);
  });

  it('rechaza un inventario inexistente', async () => {
    await expect(inventarioMemoria.resumenRonda(999999, 1)).rejects.toThrow();
  });
});

describe('inventarioMemoria.cerrarRonda', () => {
  it('el mismo portón que el backend: no cierra con hojas sin finalizar', async () => {
    const id = await inventarioSembrado();
    await expect(inventarioMemoria.cerrarRonda(id, 1)).rejects.toThrow(/sin finalizar/i);
  });
});
