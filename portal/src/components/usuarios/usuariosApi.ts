import api, { sesionApi } from '../../services/api'
import type { CuerpoDeAlta, CuerpoDeEdicion, SucursalElegible, UsuarioDto } from './usuariosTipos'

/**
 * LAS LLAMADAS DE "USUARIOS DE MI SUCURSAL".
 *
 * Viven acá y no en `services/api.ts` por el mismo motivo que `cicloApi.ts` y
 * `corregir/api.ts`: ese archivo es zona compartida y hay otros agentes
 * escribiendo en el portal. Reusan la MISMA instancia de axios (su token, su
 * timeout y su 401 → login), que es lo único que no se puede duplicar sin
 * partir la sesión en dos.
 *
 * Las seis rutas salen de `backend/src/modules/usuarios/usuarios.routes.ts`,
 * todas detrás de `requiereSesion` + `requiereRol('administrador', 'auditor')`.
 * El recorte fino (un auditor no toca a otro auditor ni sale de su sucursal)
 * lo hace el servidor en `usuarios.service.ts`; la pantalla solo evita
 * ofrecerlo, y si igual llega un 403 lo muestra tal cual.
 *
 * Ninguna "rellena" un fallo: si el servidor falla, falla, y la pantalla lo
 * dice. Una lista vacía por un error se leería como "esta tienda no tiene
 * cuentas", que es una afirmación falsa.
 */
export const usuariosApi = {
  /**
   * `GET /api/usuarios[?sucursalId=]` → `UsuarioDto[]`, ordenadas por id.
   *
   * Para un auditor el servidor IGNORA el filtro y responde siempre las de su
   * propia sucursal (`usuarios.service.ts#listar`). Se manda igual, como hace
   * el teléfono: si algún día ese recorte se rompiera del lado del servidor,
   * el pedido seguiría diciendo qué se quería ver.
   */
  listar: async (sucursalId?: number): Promise<UsuarioDto[]> =>
    (
      await api.get<UsuarioDto[]>('/usuarios', {
        params: sucursalId === undefined ? undefined : { sucursalId },
      })
    ).data,

  /** `POST /api/usuarios` → 201 con la cuenta creada. */
  crear: async (cuerpo: CuerpoDeAlta): Promise<UsuarioDto> => (await api.post<UsuarioDto>('/usuarios', cuerpo)).data,

  /** `PATCH /api/usuarios/:id` → la cuenta como quedó. */
  editar: async (id: number, cuerpo: CuerpoDeEdicion): Promise<UsuarioDto> =>
    (await api.patch<UsuarioDto>(`/usuarios/${id}`, cuerpo)).data,

  /**
   * `PATCH /api/usuarios/:id/estado` con `{ activo }` → la cuenta como quedó.
   * Una cuenta deshabilitada no puede entrar, y sus sesiones abiertas dejan de
   * servir en el siguiente pedido (`sesion.service.ts#verificarToken`).
   */
  cambiarEstado: async (id: number, activo: boolean): Promise<UsuarioDto> =>
    (await api.patch<UsuarioDto>(`/usuarios/${id}/estado`, { activo })).data,

  /**
   * `POST /api/usuarios/:id/resetear-pin` con `{ pin }` → 204 sin cuerpo.
   * No hay un GET del PIN ni lo habrá: se guarda con argon2 y no se puede
   * leer, solo reemplazar.
   */
  resetearPin: async (id: number, pin: string): Promise<void> => {
    await api.post(`/usuarios/${id}/resetear-pin`, { pin })
  },

  /** `DELETE /api/usuarios/:id` → 204 sin cuerpo. Ver el diálogo de borrado. */
  eliminar: async (id: number): Promise<void> => {
    await api.delete(`/usuarios/${id}`)
  },

  /**
   * Las tiendas que el ADMINISTRADOR puede elegir al crear o editar.
   *
   * Sale de `GET /api/sesion/sucursales` (pública, ya en `services/api.ts`, y
   * la misma que usa `CorregirConteos`) y no de `GET /api/tiendas`, que es la
   * que usa el teléfono: devuelve solo las ACTIVAS, que es exactamente el
   * filtro `activa !== false` que el teléfono aplica a mano, y no obliga a
   * declarar un contrato nuevo. El auditor no la pide nunca: no elige
   * sucursal, crea para la suya.
   */
  sucursales: async (): Promise<SucursalElegible[]> =>
    (await sesionApi.sucursales()).map((s) => ({ id: s.id, nombre: s.nombre })),
}
