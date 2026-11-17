import api from '../../services/api'
import type { EstadoLacrado, ListadoDelHistorial, VerificacionDelSello } from './lacradoTipos'

/**
 * LAS LLAMADAS DEL LACRADO QUE `services/api.ts` TODAVÍA NO TIENE.
 *
 * Viven acá por indicación del orquestador: ese archivo lo está tocando otro
 * agente. Usan la MISMA instancia de axios -- el token, el 401 que vuelve al
 * login y el `baseURL` salen de ahí y no se reconfiguran. Mismo criterio que
 * `ciclo/cicloApi.ts`; cuando esta pantalla se integre, se mudan a un
 * `lacradoApi` de `services/api.ts`.
 *
 * Ninguna rellena un fallo con datos vacíos. En esta pantalla eso sería lo
 * peor posible: un estado en blanco se leería como "no hay firmas" sobre un
 * inventario que sí las tiene, o al revés.
 *
 * LAS TRES ESCRITURAS HACEN POST Y DESPUÉS RE-LEEN EL ESTADO, y eso es
 * deliberado, no un descuido. Los `POST` contestan 201 con su propio DTO --
 * `AprobacionDto`, `LacradoDto`, el del registro -- y ninguno de los tres trae
 * `todoSincronizado`, que es justo el campo que habilita el botón de lacrar.
 * Armar el estado nuevo a partir de esas respuestas sería inventar la mitad de
 * los campos en la pantalla del punto de no retorno; un GET extra sobre una
 * acción que pasa dos veces por mes es un precio ridículo al lado de eso. Es la
 * misma decisión que ya tomó `mobile/lib/adaptadores/lacrado-api.ts`.
 */
export const lacradoApi = {
  /**
   * El histórico de una sucursal, del más nuevo al más viejo. De acá sale el
   * inventario A LACRAR: `inventarios/activo` devolvería el ABIERTO, que es
   * justamente el único que no se puede sellar.
   *
   * La ruta es `/historial/inventarios`, no `/historial`. Solo entran
   * `administrador` y `auditor`.
   */
  historial: async (sucursalId: number): Promise<ListadoDelHistorial> =>
    (await api.get<ListadoDelHistorial>(`/historial/inventarios?sucursalId=${sucursalId}`)).data,

  estado: async (inventarioId: number): Promise<EstadoLacrado> =>
    (await api.get<EstadoLacrado>(`/historial/inventarios/${inventarioId}/lacrado/estado`)).data,

  /** Recalcula el hash y lo compara con el sellado. Solo tiene sentido ya lacrado. */
  verificacion: async (inventarioId: number): Promise<VerificacionDelSello> =>
    (await api.get<VerificacionDelSello>(`/historial/inventarios/${inventarioId}/lacrado/verificacion`)).data,

  /**
   * UNA firma, la de quien está en sesión. Sin cuerpo y sin id de aprobador:
   * el schema del servidor es `.strict()` y acepta solo `nota`, así que mandar
   * un `aprobadorId` da 400 en vez de ignorarse -- quien intente firmar por
   * otro se tiene que enterar. Esta pantalla no ofrece ese camino.
   */
  aprobar: async (inventarioId: number): Promise<EstadoLacrado> => {
    await api.post(`/historial/inventarios/${inventarioId}/aprobaciones`, {})
    return await lacradoApi.estado(inventarioId)
  },

  /**
   * IRREVERSIBLE. Exige las firmas requeridas, de personas distintas, y que no
   * queden hojas sin sincronizar.
   *
   * No lleva cuerpo: QUÉ se sella lo arma el backend leyendo el inventario, y
   * quién lacra sale de la sesión. Aceptar el contenido del cliente sería
   * dejar que el sellado declare lo que quiera haber sellado.
   */
  lacrar: async (inventarioId: number): Promise<EstadoLacrado> => {
    await api.post(`/historial/inventarios/${inventarioId}/lacrado`, {})
    return await lacradoApi.estado(inventarioId)
  },

  /**
   * CONSTANCIA DE UN REGISTRO QUE HIZO UNA PERSONA, no un envío.
   *
   * El backend NO escribe en Dynamics: el ajuste automático es fase 2. Alguien
   * de TI carga el resultado a mano en el ERP y acá deja dicho que lo hizo. La
   * pantalla tiene que decir exactamente eso y no insinuar que el sistema lo
   * mandó.
   *
   * `referencia` (el número de asiento del ERP) es opcional en el schema y esta
   * pantalla no la pide todavía: ver la nota en `AprobacionYLacrado.tsx`.
   */
  marcarRegistradoEnErp: async (inventarioId: number): Promise<EstadoLacrado> => {
    await api.post(`/historial/inventarios/${inventarioId}/lacrado/registro-erp`, {})
    return await lacradoApi.estado(inventarioId)
  },
}
