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
  registrarInventario,
  simularLatencia,
} from './_compartido';
import { configDynamicsMemoria } from './config-dynamics-memoria';
import { sesionMemoria } from './sesion-memoria';
import { ErrorSnapshot, type RepositorioInventario } from '../puertos/repositorios';

const TOTAL_ITEMS_SNAPSHOT = 8000; // Market Central Luzuriaga — validado en mobile/design/hojas.html.
const TAMANO_PAGINA = 500; // simula el tamaño de página real de OData, no un número inventado suelto.
const MS_POR_PAGINA = 180;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const inventarioMemoria: RepositorioInventario = {
  async traerSnapshot(sucursalId, opciones) {
    await simularLatencia();

    // Idempotente: no puede haber dos inventarios activos para la misma
    // sucursal. Si ya existe (Luzuriaga arranca sembrada), se devuelve
    // tal cual en vez de crear uno nuevo — no hace falta volver a
    // "traer" nada.
    const existente = await obtenerInventarioDeSucursal(sucursalId);
    if (existente) {
      return { inventarioId: existente.id, items: existente.snapshotItems, tomadoEn: existente.snapshotTomadoEn };
    }

    // Igual que lo haría el adaptador HTTP real: sin credenciales
    // cargadas, ni siquiera vale la pena intentar el primer request.
    const config = await configDynamicsMemoria.obtener();
    if (!config.secretoConfigurado) {
      throw new ErrorSnapshot(
        'dynamics-no-configurado',
        'Todavía no hay credenciales de Dynamics configuradas para esta tienda.',
      );
    }

    // Ninguna otra sucursal tiene todavía un desglose de catálogo
    // validado por el cliente (solo Luzuriaga lo tiene, ver
    // mobile/design/hojas.html) — se avisa en vez de inventar un total
    // de items para Carhuaz/Bolívar/Sucre.
    if (sucursalId !== 1) {
      throw new ErrorSnapshot('desconocido', 'Todavía no hay catálogo de Dynamics cargado para esta sucursal.');
    }

    // Simula la paginación real de OData: llega de a TAMANO_PAGINA ítems
    // por vez, con una demora entre página y página — nunca salta de 0 a
    // 8.000. `signal` se chequea ENTRE páginas (no se puede cancelar un
    // fetch ya en vuelo con un mock, pero sí frenar antes de la próxima).
    let traidos = 0;
    while (traidos < TOTAL_ITEMS_SNAPSHOT) {
      if (opciones?.signal?.aborted) {
        throw new ErrorSnapshot('cancelado', 'Cancelado.');
      }
      await esperar(MS_POR_PAGINA);
      traidos = Math.min(traidos + TAMANO_PAGINA, TOTAL_ITEMS_SNAPSHOT);
      opciones?.onAvance?.({ traidos, total: TOTAL_ITEMS_SNAPSHOT });
    }
    if (opciones?.signal?.aborted) {
      throw new ErrorSnapshot('cancelado', 'Cancelado.');
    }

    const tomadoEn = new Date().toISOString();
    const inventario = registrarInventario(sucursalId, TOTAL_ITEMS_SNAPSHOT, tomadoEn);
    return { inventarioId: inventario.id, items: TOTAL_ITEMS_SNAPSHOT, tomadoEn };
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
