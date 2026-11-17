import api from '../../services/api'
import type {
  AjusteIniciado,
  InventarioActivo,
  ListadoDelHistorial,
  ResumenRonda,
  RondaExtraAbierta,
} from './cicloTipos'

/**
 * LAS LLAMADAS QUE ESTA PANTALLA NECESITA Y `services/api.ts` TODAVÍA NO TIENE.
 *
 * Viven acá por indicación del orquestador: `services/api.ts` lo está tocando
 * otro agente y se pisarían. Usan la MISMA instancia de axios -- el token, el
 * 401 que vuelve al login y el `baseURL` salen de ahí, no se reconfiguran.
 * Cuando esta pantalla se integre, estas cinco se mudan a `auditoriaApi` /
 * un `inventariosApi`.
 *
 * Ninguna "rellena" un fallo con datos vacíos: si el servidor falla, falla, y
 * la pantalla lo dice. Un embudo en cero sobre un inventario que sí se está
 * contando se lee como un dato y no como una falla, y es el peor error posible
 * acá.
 */
export const cicloApi = {
  /**
   * El inventario abierto de una sucursal, o `null` si no tiene ninguno.
   *
   * El 200 con cuerpo `null` es la respuesta normal: una tienda que todavía no
   * arrancó el mes. No es un 404 y no hay que tratarlo como error.
   */
  activo: async (sucursalId: number): Promise<InventarioActivo | null> =>
    (await api.get<InventarioActivo | null>(`/sucursales/${sucursalId}/inventarios/activo`)).data,

  /**
   * El embudo de una ronda. **Tira 404 si la ronda no tiene hojas todavía** --
   * quien llama lo atrapa y lo convierte en `null`, que es "esta pasada no
   * empezó". No se traga acá porque un 404 de OTRA causa (un inventarioId que
   * no existe) también llegaría por este camino y conviene que se vea.
   */
  resumenDeRonda: async (inventarioId: number, ronda: number): Promise<ResumenRonda> =>
    (await api.get<ResumenRonda>(`/inventarios/${inventarioId}/rondas/${ronda}/resumen`)).data,

  /**
   * Abre un 4to conteo, un 5to: los abre el Auditor, de a uno. Sin cuerpo.
   *
   * Responde 409 con el motivo escrito cuando no se puede -- "todavía queda
   * una hoja sin finalizar", "no queda nada por recontar" (que no es un error,
   * es el caso feliz). Ese texto se muestra tal cual.
   */
  abrirRondaExtra: async (inventarioId: number): Promise<RondaExtraAbierta> =>
    (await api.post<RondaExtraAbierta>(`/inventarios/${inventarioId}/rondas/abrir`)).data,

  /**
   * `en_curso` pasa a `ajuste_auditor`. Se puede una sola vez, y a partir de
   * ahí el Coordinador ya no corrige nada de ese inventario.
   */
  iniciarAjuste: async (inventarioId: number): Promise<AjusteIniciado> =>
    (await api.post<AjusteIniciado>(`/inventarios/${inventarioId}/ajuste/iniciar`)).data,

  /**
   * El histórico de una sucursal, del más nuevo al más viejo. Es el FALLBACK
   * del ciclo: sin inventario abierto, el ciclo que se muestra es el del
   * último inventario cerrado.
   *
   * La ruta es `/historial/inventarios`, no `/historial` (verificado: `/historial`
   * a secas devuelve 404). Solo entran `administrador` y `auditor`.
   */
  historial: async (sucursalId: number): Promise<ListadoDelHistorial> =>
    (await api.get<ListadoDelHistorial>(`/historial/inventarios?sucursalId=${sucursalId}`)).data,
}
