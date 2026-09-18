/**
 * Adaptador HTTP de RepositorioAsistencia. Mismo puerto que asistencia-memoria.ts.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO
 * ---------------------------------------------------------------------------
 *   GET    /api/inventarios/:id/asistencia                      → AsistenciaInventario
 *   POST   /api/inventarios/:id/asistencia   { colaboradorId, dia }
 *   DELETE /api/inventarios/:id/asistencia/:colaboradorId?dia=YYYY-MM-DD
 *
 * La respuesta del GET calza EXACTO con `AsistenciaInventario` del puerto —
 * mismos nombres, mismos tipos — así que no hay nada que traducir, igual que
 * en liquidacion-api.ts. Un adaptador que no traduce es la señal de que el
 * contrato está bien puesto, no de que sobre.
 *
 * Quién puede escribir lo decide el servidor (Coordinador o Administrador de
 * esa sucursal, y solo con el inventario en curso), y responde 403/409. Acá
 * no se replica esa decisión: una pantalla que esconde un botón no es un
 * control de acceso. Los mensajes del servidor se muestran tal cual — dicen
 * qué falta, y uno genérico borraría justo lo accionable.
 */

import type { AsistenciaInventario, RepositorioAsistencia } from '../puertos/repositorios';
import { pedir, pedirSinCuerpo } from './_http';

export const asistenciaApi: RepositorioAsistencia = {
  async deInventario(inventarioId) {
    return await pedir<AsistenciaInventario>(`/api/inventarios/${inventarioId}/asistencia`);
  },

  /**
   * `idempotente: true` y no es una promesa optimista: la protege el
   * `@@unique(inventarioId, colaboradorId, dia)` de la base, así que el
   * segundo POST no crea una segunda marca ni mueve la hora de la primera.
   *
   * Habilitar el reintento importa acá más que en otras escrituras: se marca
   * desde el piso de la tienda, con la WiFi cayéndose, y sin reintento un
   * timeout después de que el servidor ya guardó dejaría al Coordinador
   * marcando de nuevo a mano a once personas para averiguar cuáles entraron.
   */
  async marcar(inventarioId, colaboradorId, dia) {
    await pedirSinCuerpo(`/api/inventarios/${inventarioId}/asistencia`, {
      metodo: 'POST',
      cuerpo: { colaboradorId, dia },
      idempotente: true,
    });
  },

  /** Mismo criterio de idempotencia: borrar dos veces deja el mismo estado. */
  async quitar(inventarioId, colaboradorId, dia) {
    await pedirSinCuerpo(`/api/inventarios/${inventarioId}/asistencia/${colaboradorId}?dia=${dia}`, {
      metodo: 'DELETE',
      idempotente: true,
    });
  },
};
