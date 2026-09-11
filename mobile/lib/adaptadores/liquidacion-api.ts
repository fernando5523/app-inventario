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
 * Detrás de `requiereSesion` + `requiereRol('auditor')`: la liquidación es
 * del Auditor desde el 2026-09-11 (backend liquidacion.permisos.ts). Los demás
 * roles reciben 403.
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
  CierreLiquidacion,
  Conciliacion,
  DatosAjustes,
  Liquidacion,
  ReporteGerencia,
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
   * `PUT` y no `POST`: es idempotente. Cargar dos veces lo mismo deja el mismo
   * estado, y corregir antes de liquidar tiene que poder hacerse.
   *
   * `montoEmpresa` NO viaja nunca (backend 48899bc): el faltante de empresa lo
   * calcula la clasificación de productos al liquidar. El cuerpo se arma campo
   * por campo, en vez de reenviar `datos`, para que un llamador viejo que
   * todavía lo mande no lo cuele.
   */
  async registrarAjustes(inventarioId, datos: DatosAjustes) {
    return await pedir<AjustesDelMes>(`/api/liquidacion/inventarios/${inventarioId}/ajustes`, {
      metodo: 'PUT',
      cuerpo: { montoNegativos: datos.montoNegativos, nota: datos.nota },
    });
  },

  /**
   * `POST /api/liquidacion/inventarios/:id/liquidar` → `CierreLiquidacion` (201).
   *
   * SIN CUERPO a propósito: quien liquida sale del TOKEN, nunca del body —
   * igual que quien firma el lacrado. No hay nada que el teléfono pueda
   * mandar que cambie de quién es la firma.
   *
   * Los 409 NO se traducen: el backend explica qué falta (los ajustes del
   * mes, que nadie registró conteos, que ya se liquidó) y la pantalla los
   * muestra tal cual. Un mensaje genérico acá borraría justo lo accionable.
   */
  async liquidar(inventarioId) {
    return await pedir<CierreLiquidacion>(`/api/liquidacion/inventarios/${inventarioId}/liquidar`, {
      metodo: 'POST',
    });
  },

  /**
   * `GET /api/liquidacion/inventarios/:id/reporte-gerencia` → `ReporteGerencia`,
   * sin traducir nada (el DTO calza con el puerto). El 409 de "todavía no se
   * liquidó" NO se traduce: su mensaje dice por qué no hay reporte.
   */
  async reporteGerencia(inventarioId) {
    return await pedir<ReporteGerencia>(`/api/liquidacion/inventarios/${inventarioId}/reporte-gerencia`);
  },

  /** El .xlsx crudo: mismo camino que historial-api.ts#exportarDiferencias. */
  async exportarReporteGerencia(inventarioId): Promise<ArrayBuffer> {
    return await pedir<ArrayBuffer>(`/api/liquidacion/inventarios/${inventarioId}/reporte-gerencia/exportar`, {
      binario: true,
    });
  },
};
