/**
 * Adaptador HTTP de RepositorioAjuste. Mismo puerto que ajuste-memoria.ts.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO
 * ---------------------------------------------------------------------------
 *   PATCH /api/hojas/:hojaId/conteos/:productoId/corregir  { empaques, sueltas, motivo }
 *   POST  /api/inventarios/:id/rondas/abrir
 *   POST  /api/inventarios/:id/ajuste/iniciar
 *   PATCH /api/inventarios/:id/ajuste/:productoId          { empaques, sueltas, motivo }
 *   POST  /api/inventarios/:id/ajuste/cerrar
 *
 * NINGUNA SE REINTENTA SOLA, y es lo contrario de lo que hacen la asistencia o
 * el conteo. Ver "Reintentos" en _http.ts: un reintento solo es seguro si
 * repetir la operación deja el mismo estado.
 *
 *  - Una corrección REEMPLAZA un valor. Repetirla con el mismo cuerpo daría el
 *    mismo valor, sí -- pero cada intento escribe una entrada en la bitácora
 *    de auditoría, y tres asientos "cambió 12 -> 14" por un timeout de WiFi
 *    convierten el rastro que defiende a la persona en ruido que hay que
 *    explicar.
 *  - `rondas/abrir` NO es idempotente en absoluto: dos intentos son dos
 *    rondas, y una ronda de más manda a once personas a recontar de nuevo.
 *  - `ajuste/iniciar` y `ajuste/cerrar` cambian el estado del inventario
 *    entero. Repetirlas ya falla del lado del servidor, y ese 409 dice algo
 *    verdadero que conviene mostrar en vez de tragarse.
 *
 * Todo devuelve `void`: el contrato no define cuerpo de respuesta, y la
 * pantalla vuelve a pedir el dato real (ver `RepositorioAjuste` en el puerto).
 * Los errores del servidor se muestran tal cual -- dicen qué regla se topó
 * ("el auditor ya empezó el ajuste"), y un mensaje genérico borraría justo eso.
 */

import type { CorreccionDeConteo, RepositorioAjuste, ResultadoCorreccion } from '../puertos/repositorios';
import { pedir, pedirSinCuerpo } from './_http';

/** Lo que viaja en el cuerpo de las dos correcciones. Mismo shape en las dos rutas. */
function cuerpoDe(correccion: CorreccionDeConteo): CorreccionDeConteo {
  return { empaques: correccion.empaques, sueltas: correccion.sueltas, motivo: correccion.motivo };
}

export const ajusteApi: RepositorioAjuste = {
  async corregirConteo(hojaId, productoId, correccion) {
    /**
     * `pedir` y no `pedirSinCuerpo`: la respuesta trae `salioDeLaRonda`, que
     * es lo que la pantalla necesita para decir "ya no sale en el 2do conteo".
     * Con `pedirSinCuerpo` la corrección funcionaba igual y el aviso se perdía
     * en el camino -- el servidor lo mandaba y nadie lo leía.
     */
    const r = await pedir<ResultadoCorreccion>(`/api/hojas/${hojaId}/conteos/${productoId}/corregir`, {
      metodo: 'PATCH',
      cuerpo: cuerpoDe(correccion),
    });
    // `?? null` y no `r.salioDeLaRonda` a secas: un backend viejo no manda la
    // clave, y `undefined` recorrería la pantalla hasta romper un `.codigo`.
    return { salioDeLaRonda: r.salioDeLaRonda ?? null };
  },

  async abrirRondaExtra(inventarioId) {
    await pedirSinCuerpo(`/api/inventarios/${inventarioId}/rondas/abrir`, { metodo: 'POST' });
  },

  async iniciarAjuste(inventarioId) {
    await pedirSinCuerpo(`/api/inventarios/${inventarioId}/ajuste/iniciar`, { metodo: 'POST' });
  },

  async ajustarItem(inventarioId, productoId, correccion) {
    await pedirSinCuerpo(`/api/inventarios/${inventarioId}/ajuste/${productoId}`, {
      metodo: 'PATCH',
      cuerpo: cuerpoDe(correccion),
    });
  },

  async cerrarAjuste(inventarioId) {
    await pedirSinCuerpo(`/api/inventarios/${inventarioId}/ajuste/cerrar`, { metodo: 'POST' });
  },
};
