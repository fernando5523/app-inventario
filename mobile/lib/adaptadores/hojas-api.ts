/**
 * Adaptador HTTP de RepositorioHojas. Mismo puerto que hojas-memoria.ts.
 *
 * ⚠️ ESTE ES LA MITAD REMOTA, NO EL REEMPLAZO DE LA LOCAL.
 *
 * El puerto dice, textual, sobre `guardarConteo`: "Debe resolver contra el
 * almacenamiento local y devolver de inmediato: el operario esta parado
 * frente a la gondola y no puede esperar a la red". Este archivo NO hace
 * eso — hace el viaje a la red. Es correcto que así sea: `repositorios.ts`
 * declara DOS implementaciones reales por puerto (la local, que manda, y la
 * remota) y un `Sincronizador` que las orquesta. Ese compositor todavía no
 * existe.
 *
 * Consecuencia práctica, y hay que decirla: enchufar este adaptador solo en
 * contenedor.ts deja el conteo dependiendo de la WiFi de la tienda, que es
 * justo lo que el cliente NO puede tener. Sirve para probar el backend de
 * punta a punta; no para salir a producción sin la mitad local + cola.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — ADIVINADO. NO VERIFICADO. Esperá antes de encenderlo.
 * ---------------------------------------------------------------------------
 * El backend NO tiene módulo de hojas: `backend/src/config/app.ts` monta hoy
 * `/api/sesion`, `/api/usuarios`, `/api/tiendas` y `/api/config`, nada más.
 * Las rutas de abajo están DEDUCIDAS de la convención que fijaron los cuatro
 * módulos que sí existen (REST bajo `/api/<recurso>`, errores `{ error }`,
 * `requiereSesion` + `requiereRol` en el router) y del schema de Prisma.
 *
 * Cuánto vale esa deducción, medido: de los 4 módulos que ya se pudieron
 * contrastar, acerté los prefijos y los cuerpos, y erré DOS sub-rutas de
 * usuarios (`/:id/estado` y `/:id/resetear-pin`, que yo había puesto como
 * `/:id` y `/:id/pin`). O sea: esperá diferencias en los sufijos.
 *
 * Todas las rutas están juntas en `RUTAS`, abajo, para que corregirlas sea
 * un solo lugar y no una cacería por el archivo.
 *
 *   GET  /api/inventarios/:inventarioId/hojas          → todas()
 *   GET  /api/inventarios/:inventarioId/hojas/mias     → mias()
 *   GET  /api/inventarios/:inventarioId/hojas/numero/:numero → porNumero()
 *   PUT  /api/hojas/:hojaId/conteos/:productoId        → guardarConteo()
 *   POST /api/hojas/:hojaId/finalizar                  → finalizar()
 *
 * Dos decisiones que NO son cosméticas:
 *
 *  - `mias` es una ruta propia y no `?mias=1`: quién soy sale del token, no
 *    de un parámetro. Un Contador que pudiera pedir las hojas de otro
 *    rompería el conteo ciego.
 *  - `guardarConteo` es PUT sobre `(hoja, producto)`, no POST a una
 *    colección. Es idempotente a propósito: la cola offline va a reintentar
 *    el mismo conteo N veces cuando vuelva la señal, y con POST cada
 *    reintento sería un renglón nuevo. El `@@unique([hojaId, productoId])`
 *    del schema dice exactamente lo mismo del lado de la base.
 */

import type { Conteo, HojaConteo } from '../dominio/tipos';
import type { RepositorioHojas } from '../puertos/repositorios';
import { ErrorApi, pedir, pedirSinCuerpo } from './_http';

const RUTAS = {
  todas: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas`,
  mias: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas/mias`,
  porNumero: (inventarioId: number, numero: string) =>
    `/api/inventarios/${inventarioId}/hojas/numero/${encodeURIComponent(numero)}`,
  conteo: (hojaId: number, productoId: number) => `/api/hojas/${hojaId}/conteos/${productoId}`,
  finalizar: (hojaId: number) => `/api/hojas/${hojaId}/finalizar`,
};

export const hojasApi: RepositorioHojas = {
  async mias(inventarioId) {
    return pedir<HojaConteo[]>(RUTAS.mias(inventarioId));
  },

  async todas(inventarioId) {
    return pedir<HojaConteo[]>(RUTAS.todas(inventarioId));
  },

  async porNumero(inventarioId, numero) {
    // El puerto pide `null`, no una excepción: "no existe esa hoja" es una
    // respuesta válida de esta consulta, no una falla. Solo el 404 se
    // traduce — un 401 o un 500 tienen que seguir subiendo.
    try {
      return await pedir<HojaConteo>(RUTAS.porNumero(inventarioId, numero));
    } catch (error) {
      if (error instanceof ErrorApi && error.clase === 'no-encontrado') return null;
      throw error;
    }
  },

  async guardarConteo(hojaId, conteo: Conteo) {
    // `productoId` viaja en la URL (es la identidad del recurso) y también
    // dentro del cuerpo, porque el `Conteo` del dominio lo lleva. El backend
    // debe tomar el de la URL como autoritativo.
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
    // Punto de no retorno: se devuelve la hoja como quedó del lado del
    // servidor, nunca una versión armada acá. Si el backend rechazó por
    // "ya estaba finalizada", eso llega como ErrorApi de clase `validacion`
    // con el mensaje del servidor — igual que en hojas-memoria.ts.
    return pedir<HojaConteo>(RUTAS.finalizar(hojaId), { metodo: 'POST' });
  },
};
