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

  async resumenRonda(inventarioId, ronda) {
    await simularLatencia();
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);
    if (inventario.hojas.length === 0) {
      throw new Error(`El inventario ${inventarioId} no tiene hojas de la ronda ${ronda}.`);
    }

    // Lo que el mock SÍ puede saber de verdad: finalización y cuánto se
    // contó. Sale de las hojas reales del inventario sembrado.
    const total = inventario.hojas.reduce((n, h) => n + h.productos.length, 0);
    const contados = inventario.hojas.reduce((n, h) => n + h.conteos.length, 0);
    const pendientes = inventario.hojas.filter((h) => h.estado !== 'finalizada');

    // Lo que NO puede saber: el cuadre contra el ERP. El stock de Dynamics no
    // existe en memoria, así que no se inventa un "cuadrados": todo queda como
    // `sinDatoErp` (no hay contra qué comparar) en vez de un número falso que
    // se leería como "tantos cuadraron". El embudo real se prueba contra el
    // backend; acá alcanza para desarrollar la UI de finalización/bloqueo.
    return {
      inventarioId,
      ronda,
      total,
      contados,
      sinContar: total - contados,
      cuadrados: 0,
      aRecontar: 0,
      sinDatoErp: total,
      porcentajeCuadrado: 0,
      hojasSinFinalizar: pendientes.map((h) => ({
        id: h.id,
        numero: h.numero,
        estado: h.estado,
        zona: h.zona,
        asignada: h.asignados.length > 0,
      })),
      sePuedeCerrar: pendientes.length === 0,
      siguienteRonda: null,
      motivoSinSiguiente: 'El adaptador en memoria no compara contra el ERP: probá el ciclo de rondas contra el backend.',
    };
  },

  async cerrarRonda(inventarioId, ronda) {
    await simularLatencia();
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

    // El mismo portón que el backend: una hoja sin finalizar es una hoja que
    // alguien todavía está contando. No se cierra con un conteo a medias.
    const pendientes = inventario.hojas.filter((h) => h.estado !== 'finalizada');
    if (pendientes.length > 0) {
      const cuales = pendientes.slice(0, 5).map((h) => h.numero).join(', ');
      throw new Error(
        `No se puede cerrar la ronda ${ronda}: quedan ${pendientes.length} hoja(s) sin finalizar (${cuales}${pendientes.length > 5 ? '…' : ''}).`,
      );
    }

    // Sin ERP no se puede decidir qué ítems vuelven ni materializar la ronda
    // siguiente de forma fiel: el mock no simula eso. Devuelve un cierre sin
    // ronda nueva, dicho como lo que es. El camino completo (abrir la 2da con
    // lo que no cuadró) se ejercita contra el backend.
    return {
      inventarioId,
      rondaCerrada: ronda,
      resumen: { total: 0, contados: 0, sinContar: 0, cuadrados: 0, aRecontar: 0, sinDatoErp: 0, porcentajeCuadrado: 0 },
      rondaAbierta: null,
      motivoSinSiguiente: 'El adaptador en memoria no abre rondas: el ciclo completo se prueba contra el backend.',
      hojas: [],
    };
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
      // El mock solo tiene la ronda 1 sembrada: con hojas, la activa es la 1;
      // sin hojas, null (mismo momento que `tamanoHoja: null`).
      rondaActiva: inventario.hojas.length > 0 ? 1 : null,
    };
  },
};
