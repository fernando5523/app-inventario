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

import type {
  AjustesDelMes,
  Conciliacion,
  DatosAjustes,
  Liquidacion,
  RepositorioLiquidacion,
} from '../puertos/repositorios';
import { ErrorApi, pedir } from './_http';

/**
 * "No hay ciclo cerrado en esta tienda" NO es un error, venga como venga.
 *
 * El backend lo dice con `200` + body `null`, y así está documentado. Pero un
 * `404` significaría exactamente lo mismo, y hoy llega como `ErrorApi` — o
 * sea, como excepción que la pantalla muestra como "No se pudo cargar la
 * liquidación", que es la falla que este helper existe para evitar.
 *
 * Se normaliza acá y no en la pantalla: el puerto declara `Promise<X | null>`,
 * así que traducir el transporte a ese `null` es trabajo del adaptador. Los
 * demás errores —sin red, sesión vencida, 500— siguen subiendo intactos: esos
 * SÍ son fallas y la pantalla tiene que ofrecer reintentar.
 */
async function nullSiNoHay<T>(promesa: Promise<T | null>): Promise<T | null> {
  try {
    return await promesa;
  } catch (error) {
    if (error instanceof ErrorApi && error.clase === 'no-encontrado') return null;
    throw error;
  }
}

export const liquidacionApi: RepositorioLiquidacion = {
  async deSucursal(sucursalId) {
    return await nullSiNoHay(pedir<Liquidacion | null>(`/api/liquidacion/sucursales/${sucursalId}`));
  },

  async conciliacion(sucursalId) {
    return await nullSiNoHay(pedir<Conciliacion | null>(`/api/liquidacion/sucursales/${sucursalId}/conciliacion`));
  },

  /**
   * `GET /api/liquidacion/inventarios/:id/ajustes` → `AjustesDelMes`.
   *
   * NUNCA null, al revés que los dos de arriba: un inventario sin ajustes
   * cargados devuelve `registrado: false` con los montos en null. La
   * diferencia importa — la pantalla tiene que poder decir "falta cargarlos"
   * en vez de "no hay nada acá".
   */
  async ajustes(inventarioId) {
    return await pedir<AjustesDelMes>(`/api/liquidacion/inventarios/${inventarioId}/ajustes`);
  },

  /**
   * `PUT` y no `POST`: es idempotente. Cargar dos veces el mismo monto deja
   * el mismo estado, y corregir uno mal tipeado antes de liquidar tiene que
   * poder hacerse.
   *
   * `montoEmpresa` se OMITE del cuerpo si no viene, en vez de mandarlo como
   * `undefined` o `0`: el backend conserva el calculado cuando la clave no
   * está, y lo pisa cuando llega en 0. Son dos cosas distintas y el
   * adaptador no puede confundirlas (ver DatosAjustes en el puerto).
   */
  async registrarAjustes(inventarioId, datos: DatosAjustes) {
    return await pedir<AjustesDelMes>(`/api/liquidacion/inventarios/${inventarioId}/ajustes`, {
      metodo: 'PUT',
      cuerpo: {
        montoNegativos: datos.montoNegativos,
        ...(datos.montoEmpresa !== undefined ? { montoEmpresa: datos.montoEmpresa } : {}),
        nota: datos.nota,
      },
    });
  },
};
