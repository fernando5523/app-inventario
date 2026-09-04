/**
 * Adaptador HTTP de RepositorioInventario. Mismo puerto que
 * inventario-memoria.ts. Es el wizard de 3 pasos del Coordinador
 * (pantalla 2) más la lectura de `activo`.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — NO VERIFICADO. El endpoint todavía no existe.
 * ---------------------------------------------------------------------------
 * `backend/src/config/app.ts` monta hoy `/api/sesion`, `/api/usuarios`,
 * `/api/tiendas` y `/api/config`. NO hay módulo de inventario ni de d365, y
 * backend/README.md no documenta ninguna de estas rutas todavía.
 *
 * Las de abajo están DEDUCIDAS de la convención de los cuatro módulos que sí
 * existen y del módulo de referencia del proyecto hermano
 * (D:\Documentos\monorepo\inventario\backend\src\modules\d365\). Cuando
 * min-1 documente las reales, se corrigen todas en `RUTAS` — un solo lugar.
 *
 *   POST /api/sucursales/:sucursalId/inventarios/snapshot → traerSnapshot()
 *   GET  /api/sucursales/:sucursalId/inventarios/snapshot/estado → progreso
 *   GET  /api/sucursales/:sucursalId/inventarios/activo   → activo()
 *   POST /api/inventarios/:inventarioId/hojas             → crearHojas()
 *   POST /api/inventarios/:inventarioId/hojas/asignar     → asignarHojas()
 *
 * ---------------------------------------------------------------------------
 * SOLO LECTURA DE DYNAMICS. No se negocia.
 * ---------------------------------------------------------------------------
 * El snapshot LEE el catálogo del ERP y escribe únicamente en NUESTRA base.
 * El ajuste automático hacia Dynamics es fase 2 por decisión del cliente
 * (ver puertos/repositorios.ts#RepositorioLacrado, que solo registra que TI
 * lo cargó a mano).
 *
 * El módulo de referencia del proyecto hermano expone `POST /sync/export`
 * (→ `d365-sync.service.ts#exportInventoryCount`), que ESCRIBE conteos en
 * Dynamics. Este archivo NO lo consume y no debe hacerlo. Si el backend
 * llegara a exponer algo equivalente, no se enchufa acá sin decisión
 * explícita del cliente: un ajuste automático mal calculado corrige stock
 * real en el ERP de la empresa, y eso no se deshace con un botón.
 *
 * ---------------------------------------------------------------------------
 * PROGRESO Y CANCELACIÓN
 * ---------------------------------------------------------------------------
 * `traerSnapshotConProgreso` es la versión completa: reporta avance y se
 * puede cancelar de verdad. `traerSnapshot` (el método del puerto tal como
 * está declarado HOY) delega en ella ignorando el progreso.
 *
 * Cuando min-2 cambie la firma de `RepositorioInventario.traerSnapshot` para
 * aceptar avance y señal, el cambio acá es pasar los dos argumentos que ya
 * están implementados — no escribir nada nuevo.
 */

import type { HojaConteo, TamanoHoja } from '../dominio/tipos';
import type { RepositorioInventario } from '../puertos/repositorios';
import { ErrorApi, pedir, sondear, TIMEOUT_LARGO_MS } from './_http';

const RUTAS = {
  snapshot: (sucursalId: number) => `/api/sucursales/${sucursalId}/inventarios/snapshot`,
  snapshotEstado: (sucursalId: number) => `/api/sucursales/${sucursalId}/inventarios/snapshot/estado`,
  activo: (sucursalId: number) => `/api/sucursales/${sucursalId}/inventarios/activo`,
  crearHojas: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas`,
  asignarHojas: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas/asignar`,
};

/** Lo que devuelven snapshot y activo. */
interface SnapshotDto {
  inventarioId: number;
  items: number;
  tomadoEn: string;
}

interface InventarioActivoDto extends SnapshotDto {
  tamanoHoja: TamanoHoja | null;
  totalHojas: number;
}

/**
 * Estado de una traída en curso. `total` puede ser null hasta que Dynamics
 * conteste cuántos items hay — no se inventa un total para poder dibujar una
 * barra: una barra que miente es peor que un spinner honesto.
 */
export interface AvanceSnapshot {
  procesados: number;
  total: number | null;
  terminado: boolean;
  /** Presente solo cuando `terminado` es true. */
  resultado?: SnapshotDto;
}

export interface OpcionesSnapshot {
  /** Se llama en cada vuelta del sondeo: es el "1.200 de 8.000" de la pantalla. */
  alAvanzar?: (avance: AvanceSnapshot) => void;
  /** El botón "Cancelar". Aborta el sondeo de verdad, no deja de mirar. */
  senal?: AbortSignal;
}

/**
 * Paso 1 del Coordinador, completo.
 *
 * Arranca la traída y después sondea el avance. El POST inicial va con
 * `TIMEOUT_LARGO_MS` igual — si el backend resuelve rápido y devuelve el
 * resultado de una, no hace falta sondear nada y se corta ahí.
 *
 * REINTENTOS: el POST no se reintenta solo (`_http.ts` nunca reintenta
 * escrituras). Pero el puerto declara esta operación IDEMPOTENTE — "si la
 * sucursal ya tiene un inventario en curso, lo devuelve tal cual en vez de
 * crear uno nuevo" — así que volver a invocarla desde la pantalla es seguro
 * y NO crea un segundo inventario. Esa garantía es del backend: si el
 * endpoint real no la cumple, este adaptador no puede arreglarlo desde acá y
 * hay que decirlo antes de poner un botón de "reintentar".
 */
export async function traerSnapshotConProgreso(
  sucursalId: number,
  opciones: OpcionesSnapshot = {},
): Promise<SnapshotDto> {
  const { alAvanzar, senal } = opciones;

  const arranque = await pedir<AvanceSnapshot | SnapshotDto>(RUTAS.snapshot(sucursalId), {
    metodo: 'POST',
    msTimeout: TIMEOUT_LARGO_MS,
    senal,
  });

  // Camino corto: el backend ya devolvió el inventario armado.
  if ('inventarioId' in arranque) {
    alAvanzar?.({ procesados: arranque.items, total: arranque.items, terminado: true, resultado: arranque });
    return arranque;
  }

  alAvanzar?.(arranque);

  const final = await sondear<AvanceSnapshot>({
    consultar: (senalDelSondeo) =>
      pedir<AvanceSnapshot>(RUTAS.snapshotEstado(sucursalId), { senal: senalDelSondeo }),
    termino: (estado) => estado.terminado,
    alAvanzar,
    senal,
  });

  if (!final.resultado) {
    // Terminó pero no trajo el inventario: no hay con qué encadenar
    // crearHojas/asignarHojas, así que es un error del contrato, no un
    // éxito a medias que rompe tres pantallas después.
    throw new ErrorApi('respuesta-invalida', {
      mensaje: 'El servidor dijo que terminó de traer el catálogo pero no devolvió el inventario.',
    });
  }
  return final.resultado;
}

export const inventarioApi: RepositorioInventario = {
  async traerSnapshot(sucursalId) {
    // La firma actual del puerto no acepta avance ni señal. Se delega igual
    // en la implementación completa para no tener dos caminos distintos que
    // mantener — el día que min-2 amplíe la firma, esto pasa los argumentos
    // y nada más cambia.
    return traerSnapshotConProgreso(sucursalId);
  },

  async crearHojas(inventarioId, tamano) {
    return pedir<HojaConteo[]>(RUTAS.crearHojas(inventarioId), {
      metodo: 'POST',
      cuerpo: { tamano },
    });
  },

  async asignarHojas(inventarioId, colaboradorIds) {
    // El ORDEN del array es el orden de reparto (el primero se lleva el
    // primer bloque, ver dominio/lote.ts#repartir): se manda tal cual, sin
    // ordenar ni deduplicar acá.
    return pedir<HojaConteo[]>(RUTAS.asignarHojas(inventarioId), {
      metodo: 'POST',
      cuerpo: { colaboradorIds },
    });
  },

  async activo(sucursalId) {
    // null = "el Coordinador todavía no trajo el snapshot", que es un estado
    // normal de la pantalla de inicio, no un error.
    try {
      return await pedir<InventarioActivoDto>(RUTAS.activo(sucursalId));
    } catch (error) {
      if (error instanceof ErrorApi && error.clase === 'no-encontrado') return null;
      throw error;
    }
  },
};
