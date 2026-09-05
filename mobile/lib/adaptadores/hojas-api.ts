/**
 * Adaptador HTTP de RepositorioHojas. Mismo puerto que hojas-memoria.ts y
 * hojas-sqlite.ts.
 *
 * ⚠️ ESTE ES LA MITAD REMOTA, NO EL REEMPLAZO DE LA LOCAL.
 *
 * El puerto dice, textual, sobre `guardarConteo`: "Debe resolver contra el
 * almacenamiento local y devolver de inmediato: el operario esta parado
 * frente a la gondola y no puede esperar a la red". Este archivo NO hace
 * eso — hace el viaje a la red.
 *
 * Es correcto que así sea: la mitad que manda es `hojas-sqlite.ts`, y quien
 * las orquesta es `sincronizador.ts`, que usa ESTE archivo para vaciar la
 * cola cuando hay señal. Enchufar este adaptador solo en contenedor.ts
 * dejaría el conteo dependiendo de la WiFi de la tienda, que es justo lo que
 * el cliente no puede tener.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra backend/README.md §Hojas y conteos
 * ---------------------------------------------------------------------------
 *   GET  /api/hojas?inventarioId=&alcance=mias|todas&ronda=&numero=
 *   GET  /api/hojas/:id
 *   PUT  /api/hojas/:id/conteos/:productoId   { empaques, sueltas, confirmadoPorEscaner, contadoEn }
 *   POST /api/hojas/:id/finalizar
 *
 * Las rutas que yo había adivinado antes de que el módulo existiera estaban
 * mal (`/api/inventarios/:id/hojas/mias`, `/api/hojas/:id/conteos/:pid` con
 * otra forma de listado); quedaron corregidas contra el backend real.
 */

import type { Conteo, HojaConteo } from '../dominio/tipos';
import type { RepositorioHojas } from '../puertos/repositorios';
import { ErrorApi, pedir, pedirSinCuerpo } from './_http';

const BASE = '/api/hojas';

const RUTAS = {
  /**
   * `alcance=mias` lo resuelve el SERVIDOR con el token, no un parámetro de
   * identidad: un Contador que pudiera pedir las hojas de otro rompería el
   * conteo ciego. Acá solo se dice "las mías".
   */
  listar: (inventarioId: number, alcance: 'mias' | 'todas', ronda: number, numero?: string) => {
    // `ronda` SIEMPRE explícita, no se deja al default del backend: la
    // pantalla decidió de qué ronda habla y ese dato tiene que viajar dicho.
    // Antes se omitía y el backend traía siempre la 1ra — el hueco que esto
    // cierra.
    const q = new URLSearchParams({ inventarioId: String(inventarioId), alcance, ronda: String(ronda) });
    if (numero) q.set('numero', numero);
    return `${BASE}?${q.toString()}`;
  },
  conteo: (hojaId: number, productoId: number) => `${BASE}/${hojaId}/conteos/${productoId}`,
  finalizar: (hojaId: number) => `${BASE}/${hojaId}/finalizar`,
};

export const hojasApi: RepositorioHojas = {
  async mias(inventarioId, ronda) {
    return pedir<HojaConteo[]>(RUTAS.listar(inventarioId, 'mias', ronda));
  },

  async todas(inventarioId, ronda) {
    return pedir<HojaConteo[]>(RUTAS.listar(inventarioId, 'todas', ronda));
  },

  async porNumero(inventarioId, numero, ronda) {
    // El backend resuelve `porNumero` como un filtro del listado: devuelve
    // una lista de 0 o 1. El puerto pide `null`, no una excepción — "no
    // existe esa hoja" es una respuesta válida de esta consulta.
    const hojas = await pedir<HojaConteo[]>(RUTAS.listar(inventarioId, 'mias', ronda, numero));
    return hojas[0] ?? null;
  },

  async guardarConteo(hojaId, conteo: Conteo) {
    /**
     * PUT sobre (hoja, producto), no POST a una colección. Es idempotente
     * por contrato del backend (upsert sobre `@@unique([hojaId, productoId])`,
     * ver backend/README.md): la cola offline reintenta el mismo conteo
     * cuando vuelve el WiFi, y con POST cada reintento sería un renglón
     * nuevo. Un conteo duplicado corrompe el inventario.
     *
     * `total` NO se manda aunque el dominio sepa calcularlo: el backend lo
     * ignora a propósito y lo recalcula. Un total que viaja al lado de sus
     * partes es un total que algún día no va a coincidir.
     */
    await pedirSinCuerpo(RUTAS.conteo(hojaId, conteo.productoId), {
      metodo: 'PUT',
      cuerpo: {
        empaques: conteo.empaques,
        sueltas: conteo.sueltas,
        confirmadoPorEscaner: conteo.confirmadoPorEscaner,
        contadoEn: conteo.contadoEn,
      },
    });
  },

  async finalizar(hojaId) {
    // También idempotente del lado del servidor: finalizar una hoja ya
    // finalizada devuelve la hoja, no un 409. Si no fuera así, el ítem de
    // la cola quedaría en error para siempre por haber hecho lo que se le
    // pidió.
    return pedir<HojaConteo>(RUTAS.finalizar(hojaId), { metodo: 'POST' });
  },
};

/** Re-exportado para que `sincronizador.ts` clasifique sin importar `_http` dos veces. */
export { ErrorApi };
