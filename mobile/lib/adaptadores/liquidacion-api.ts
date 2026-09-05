/**
 * Adaptador HTTP de RepositorioLiquidacion. Mismo puerto que liquidacion-memoria.ts.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra el servidor vivo
 * ---------------------------------------------------------------------------
 * Llamado con curl contra http://localhost:3000 el 2026-09-04, con la base
 * sembrada, sesión real de Gilmer (103):
 *
 *   GET /api/liquidacion/sucursales/:sucursalId  → Liquidacion | null
 *   GET /api/liquidacion/sucursales/:sucursalId/conciliacion → Conciliacion | null
 *       — verificado contra liquidacion.service.ts#conciliacion (devuelve
 *       un Record<string, unknown> con dos formas según `calculable`; acá se
 *       tipa como unión discriminada, sin traducir ningún nombre de campo).
 *
 * La respuesta calza EXACTO con `Liquidacion`/`Conciliacion` del puerto —
 * mismos nombres, mismos tipos, misma forma de la planilla. No hay nada que
 * traducir, y ese es el motivo de que este archivo sea tan corto: el backend
 * se escribió espejando el puerto del front (backend/README.md §Liquidación),
 * no al revés. Un adaptador que no traduce nada es la señal de que el
 * contrato está bien puesto, no de que sobre.
 *
 * Detrás de `requiereSesion` + `requiereRol('administrador', 'auditor',
 * 'coordinador')`. El Contador recibe 403: la planilla dice cuánto se le
 * descuenta a cada uno, y el conteo ciego no sobrevive a que quien cuenta
 * vea el resultado.
 *
 * EL `null` NO ES UN ERROR, en NINGUNO de los dos métodos. El servidor
 * responde `200` con body `null` cuando la sucursal todavía no tiene ningún
 * ciclo cerrado, y el puerto lo declara así. Se pasa derecho: convertirlo en
 * excepción obligaría a la pantalla a tratar un estado normal como una
 * falla, y devolver una planilla de ceros sería peor — se lee como "no se
 * descuenta nada", que es una afirmación muy distinta de "todavía no hay
 * nada que liquidar".
 */

import type { Conciliacion, Liquidacion, RepositorioLiquidacion } from '../puertos/repositorios';
import { pedir } from './_http';

export const liquidacionApi: RepositorioLiquidacion = {
  async deSucursal(sucursalId) {
    return await pedir<Liquidacion | null>(`/api/liquidacion/sucursales/${sucursalId}`);
  },

  async conciliacion(sucursalId) {
    return await pedir<Conciliacion | null>(`/api/liquidacion/sucursales/${sucursalId}/conciliacion`);
  },
};
