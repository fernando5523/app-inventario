/**
 * Adaptador en memoria de RepositorioInventario.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts). El
 * inventario de Market Central Luzuriaga arranca ya sembrado (160
 * hojas, 34 finalizadas, la #002 en proceso) en ./_compartido.ts —
 * mismo dataset validado en mobile/design/hojas.html, mis-hojas.html y
 * conteo.html.
 */

import {
  asignarHojasEnInventario,
  crearHojasEnInventario,
  obtenerInventario,
  obtenerInventarioDeSucursal,
  simularLatencia,
} from './_compartido';
import { sesionMemoria } from './sesion-memoria';
import type { RepositorioInventario } from '../puertos/repositorios';

export const inventarioMemoria: RepositorioInventario = {
  async traerSnapshot(sucursalId) {
    await simularLatencia();

    // Idempotente: no puede haber dos inventarios activos para la misma
    // sucursal. Si ya existe (Luzuriaga arranca sembrada), se devuelve
    // tal cual en vez de crear uno nuevo.
    const existente = await obtenerInventarioDeSucursal(sucursalId);
    if (existente) {
      return { inventarioId: existente.id, items: existente.snapshotItems, tomadoEn: existente.snapshotTomadoEn };
    }

    // Ninguna otra sucursal tiene todavía un desglose de catálogo
    // validado por el cliente (solo Luzuriaga lo tiene, ver
    // mobile/design/hojas.html) — se avisa en vez de inventar un total
    // de items para Carhuaz/Bolívar/Sucre.
    throw new Error('Todavía no hay catálogo de Dynamics cargado para esta sucursal.');
  },

  async crearHojas(inventarioId, tamano) {
    await simularLatencia();
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado: traé el snapshot primero.`);
    return crearHojasEnInventario(inventario, tamano);
  },

  async asignarHojas(inventarioId, colaboradorIds) {
    await simularLatencia();
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

    const colaboradores = await sesionMemoria.colaboradores(inventario.sucursalId);
    return asignarHojasEnInventario(inventario, colaboradorIds, colaboradores);
  },

  async activo(sucursalId) {
    await simularLatencia();
    const inventario = await obtenerInventarioDeSucursal(sucursalId);
    if (!inventario) return null;

    return {
      inventarioId: inventario.id,
      items: inventario.snapshotItems,
      tomadoEn: inventario.snapshotTomadoEn,
      tamanoHoja: inventario.tamanoHoja,
      totalHojas: inventario.hojas.length,
    };
  },
};
