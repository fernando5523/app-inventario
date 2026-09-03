/**
 * Adaptador HTTP de RepositorioInventario. Mismo puerto que
 * inventario-memoria.ts. Es el wizard de 3 pasos del Coordinador
 * (pantalla 2) más la lectura de `activo`.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — ADIVINADO. NO VERIFICADO (ver cabecera de hojas-api.ts).
 * El backend no tiene modulo de inventario: app.ts no monta /api/inventarios.
 * ---------------------------------------------------------------------------
 *   POST /api/sucursales/:sucursalId/inventarios/snapshot → traerSnapshot()
 *   GET  /api/sucursales/:sucursalId/inventarios/activo   → activo()
 *   POST /api/inventarios/:inventarioId/hojas             → crearHojas()
 *   POST /api/inventarios/:inventarioId/hojas/asignar     → asignarHojas()
 *
 * `traerSnapshot` es POST aunque el puerto lo describa como "lectura, nunca
 * escritura": lee de Dynamics, pero ESCRIBE el inventario de nuestro lado
 * (crea la fila en `inventarios`). Es idempotente por contrato — "si la
 * sucursal ya tiene un inventario en curso, lo devuelve tal cual" — así que
 * el POST repetido es seguro; lo que no sería honesto es llamarlo GET.
 *
 * `crearHojas` y `asignarHojas` van a rutas distintas y no a un PATCH del
 * inventario porque son los pasos 2 y 3 de un wizard, con precondiciones
 * propias: crear hojas es DESTRUCTIVO sobre el reparto anterior (lo dice el
 * puerto), asignar no.
 */

import type { HojaConteo, TamanoHoja } from '../dominio/tipos';
import type { RepositorioInventario } from '../puertos/repositorios';
import { ErrorApi, pedir } from './_http';

const RUTAS = {
  snapshot: (sucursalId: number) => `/api/sucursales/${sucursalId}/inventarios/snapshot`,
  activo: (sucursalId: number) => `/api/sucursales/${sucursalId}/inventarios/activo`,
  crearHojas: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas`,
  asignarHojas: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas/asignar`,
};

/** Lo que devuelven snapshot y activo. Se declara acá para no repetirlo inline. */
interface SnapshotDto {
  inventarioId: number;
  items: number;
  tomadoEn: string;
}

interface InventarioActivoDto extends SnapshotDto {
  tamanoHoja: TamanoHoja | null;
  totalHojas: number;
}

export const inventarioApi: RepositorioInventario = {
  async traerSnapshot(sucursalId) {
    // El snapshot de 8.000 items contra Dynamics no responde en 15s: el
    // timeout por defecto del cliente cortaría un pedido perfectamente sano.
    // Es la única llamada de toda la app que se sale del techo estándar, y
    // por eso el número está acá y no en _http.ts.
    return pedir<SnapshotDto>(RUTAS.snapshot(sucursalId), { metodo: 'POST', msTimeout: 60_000 });
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
