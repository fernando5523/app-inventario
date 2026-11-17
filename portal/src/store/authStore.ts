import { create } from 'zustand'
import { CLAVE_TOKEN, sesionApi } from '../services/api'
import type { Colaborador, Rol, Sucursal } from '../tipos'

/**
 * LA SESIÓN DEL PORTAL. Zustand, como todo el estado de app_pdv: nada de
 * Context API.
 *
 * Diferencia de fondo con el `authStore` de app_pdv: ahí la sesión se
 * rehidrata con `GET /auth/me`, que devuelve el usuario y sus permisos a
 * partir del token. Este backend NO tiene un endpoint equivalente -- el
 * ingreso es el único que devuelve quién sos. Así que la identidad se guarda
 * junto al token y se relee de `localStorage` al arrancar; `checkAuth` no es
 * una llamada al servidor, es leer lo guardado.
 *
 * Lo que eso cuesta, dicho explícitamente: un token vencido o revocado se
 * descubre en el PRIMER pedido real (401 -> el interceptor limpia y manda al
 * login), no al cargar la página. Es aceptable porque el 401 ya tiene camino;
 * lo que no sería aceptable es fabricar un `/me` que el servidor no tiene.
 */

/** Lo que se guarda junto al token para no perder quién es al recargar. */
interface SesionGuardada {
  colaborador: Colaborador
  sucursal: Sucursal | null
}

const CLAVE_SESION = 'inventario_sesion'

function leerGuardado(): SesionGuardada | null {
  try {
    const crudo = localStorage.getItem(CLAVE_SESION)
    if (!crudo) return null
    const valor = JSON.parse(crudo) as SesionGuardada
    // Un JSON viejo o a medias no es una sesión: mejor mandar al login que
    // dibujar un menú con `undefined` de rol.
    if (!valor?.colaborador?.id || !valor.colaborador.rol) return null
    return valor
  } catch {
    return null
  }
}

function guardar(token: string, sesion: SesionGuardada): void {
  try {
    localStorage.setItem(CLAVE_TOKEN, token)
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion))
  } catch {
    // Sin almacenamiento la sesión vive solo en memoria: funciona hasta que se
    // recargue la página. No es motivo para no dejar entrar.
  }
}

function olvidar(): void {
  try {
    localStorage.removeItem(CLAVE_TOKEN)
    localStorage.removeItem(CLAVE_SESION)
  } catch {
    // Nada que borrar.
  }
}

function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN)
  } catch {
    return null
  }
}

interface AuthState {
  colaborador: Colaborador | null
  /** null para el administrador: es del sistema, no de una tienda. */
  sucursal: Sucursal | null
  token: string | null
  rol: Rol | null
  isAuthenticated: boolean
  /** Arranca en `true`: hasta leer lo guardado no se sabe si hay sesión. */
  isLoading: boolean
  ingresar: (colaboradorId: number, pin: string) => Promise<void>
  salir: () => void
  /** Rehidrata desde `localStorage`. Se llama una vez, al montar la app. */
  checkAuth: () => void
  /**
   * `administrador` entra a todo: es la única jerarquía del padrón de roles
   * (ver `backend/src/middleware/autorizacion.middleware.ts`).
   */
  tieneRol: (roles: Rol[]) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  colaborador: null,
  sucursal: null,
  token: null,
  rol: null,
  isAuthenticated: false,
  isLoading: true,

  ingresar: async (colaboradorId: number, pin: string) => {
    const sesion = await sesionApi.ingresar(colaboradorId, pin)
    guardar(sesion.token, { colaborador: sesion.colaborador, sucursal: sesion.sucursal })
    set({
      colaborador: sesion.colaborador,
      sucursal: sesion.sucursal,
      token: sesion.token,
      rol: sesion.colaborador.rol,
      isAuthenticated: true,
      isLoading: false,
    })
  },

  salir: () => {
    olvidar()
    set({ colaborador: null, sucursal: null, token: null, rol: null, isAuthenticated: false, isLoading: false })
  },

  checkAuth: () => {
    const token = leerToken()
    const guardado = leerGuardado()
    // Las dos cosas o ninguna: un token sin identidad no permite dibujar el
    // menú, y una identidad sin token no permite pedir nada.
    if (!token || !guardado) {
      olvidar()
      set({ colaborador: null, sucursal: null, token: null, rol: null, isAuthenticated: false, isLoading: false })
      return
    }
    set({
      colaborador: guardado.colaborador,
      sucursal: guardado.sucursal,
      token,
      rol: guardado.colaborador.rol,
      isAuthenticated: true,
      isLoading: false,
    })
  },

  tieneRol: (roles: Rol[]) => {
    const rol = get().rol
    if (rol === null) return false
    return rol === 'administrador' || roles.includes(rol)
  },
}))
