/**
 * Adaptador HTTP de RepositorioLacrado. Mismo puerto que lacrado-memoria.ts.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra el servidor vivo
 * ---------------------------------------------------------------------------
 * Las cuatro rutas se llamaron con curl contra http://localhost:3000 el
 * 2026-09-04, con sesión real de Gilmer (103) y la base sembrada:
 *
 *   GET  /api/historial/inventarios/:id/lacrado/estado   → EstadoLacrado
 *   POST /api/historial/inventarios/:id/aprobaciones     body {}  → 201
 *   POST /api/historial/inventarios/:id/lacrado          body {}  → 201
 *   POST /api/historial/inventarios/:id/lacrado/registro-erp      → 201
 *
 * El GET de estado calza exacto con `EstadoLacrado`, incluida la `fecha` de
 * cada aprobación. Detrás de `requiereSesion` + `requiereRol('administrador',
 * 'auditor')`.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA QUE GOBIERNA ESTE ARCHIVO: quien firma sale del TOKEN
 * ---------------------------------------------------------------------------
 * `aprobar()` no recibe un colaboradorId y **no manda ninguno**. El servidor
 * lo saca de la sesión. Se verificó de las tres formas que importan:
 *
 *   - Gilmer aprueba → 201, queda registrado como Gilmer.
 *   - Gilmer aprueba de nuevo → 409 *"Ya aprobaste el cierre de este
 *     inventario. La segunda aprobacion la tiene que dar OTRA persona,
 *     desde su propia sesion."*
 *   - Gilmer manda `{aprobadorId: 106}` para firmar por Rosa → 400, el
 *     schema es `.strict()` y solo acepta `nota`.
 *
 * Por eso este adaptador manda `{}` y nunca arma un cuerpo con identidad:
 * un cliente que mandara un id igual sería rechazado, pero el punto es que
 * ni siquiera exista el código que podría intentarlo.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ CADA ESCRITURA RE-PIDE EL ESTADO
 * ---------------------------------------------------------------------------
 * Los tres POST devuelven el resultado de SU operación (la aprobación
 * creada, el sello, la constancia), no el `EstadoLacrado` entero que el
 * puerto promete. Reconstruirlo a mano desde esas respuestas parciales sería
 * adivinar `todoSincronizado` y `aprobacionesRequeridas`, que no vienen ahí
 * — y `todoSincronizado` es justo el que decide si el botón de lacrar se
 * habilita. Un GET extra sobre una acción que pasa dos veces por mes es un
 * precio ridículo comparado con mostrar un estado inventado en la pantalla
 * del punto de no retorno.
 */

import type { EstadoLacrado, RepositorioLacrado } from '../puertos/repositorios';
import { pedir } from './_http';

const RUTAS = {
  estado: (id: number) => `/api/historial/inventarios/${id}/lacrado/estado`,
  aprobaciones: (id: number) => `/api/historial/inventarios/${id}/aprobaciones`,
  lacrado: (id: number) => `/api/historial/inventarios/${id}/lacrado`,
  registroErp: (id: number) => `/api/historial/inventarios/${id}/lacrado/registro-erp`,
};

export const lacradoApi: RepositorioLacrado = {
  async estado(inventarioId) {
    return await pedir<EstadoLacrado>(RUTAS.estado(inventarioId));
  },

  async aprobar(inventarioId) {
    // Cuerpo vacío: la identidad de quien firma sale del token. Ver arriba.
    await pedir<unknown>(RUTAS.aprobaciones(inventarioId), { metodo: 'POST', cuerpo: {} });
    return await pedir<EstadoLacrado>(RUTAS.estado(inventarioId));
  },

  async lacrar(inventarioId) {
    // `.strict()` del lado del servidor: el contenido a sellar lo arma él
    // leyendo el inventario. Aceptarlo del cliente sería dejar que el
    // sellado declare lo que quiere haber sellado.
    await pedir<unknown>(RUTAS.lacrado(inventarioId), { metodo: 'POST', cuerpo: {} });
    return await pedir<EstadoLacrado>(RUTAS.estado(inventarioId));
  },

  async marcarRegistradoEnDynamics(inventarioId) {
    // `referencia` es opcional en el backend y el puerto no la pide todavía:
    // la pantalla hoy solo deja constancia de que TI lo cargó. Cuando el
    // cliente pida capturar el número de asiento, se agrega al puerto y
    // entra acá — no se manda una referencia inventada mientras tanto.
    await pedir<unknown>(RUTAS.registroErp(inventarioId), { metodo: 'POST', cuerpo: {} });
    return await pedir<EstadoLacrado>(RUTAS.estado(inventarioId));
  },
};
