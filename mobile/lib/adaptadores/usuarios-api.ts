/**
 * Adaptador HTTP de RepositorioUsuarios. Mismo puerto que usuarios-memoria.ts.
 * Lo usan el Administrador (todas las cuentas) y el Auditor (solo las de su
 * sucursal).
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra backend/README.md y el código
 * ---------------------------------------------------------------------------
 * Cotejado contra backend/README.md §Usuarios y contra
 * backend/src/modules/usuarios/*.ts:
 *
 *   GET   /api/usuarios[?sucursalId=]      → UsuarioDto[]
 *   POST  /api/usuarios                    → 201 UsuarioDto
 *   PATCH /api/usuarios/:id/estado         body { activo } → UsuarioDto
 *   POST  /api/usuarios/:id/resetear-pin   body { pin }    → 204
 *
 * Todo el router va detrás de `requiereSesion` + `requiereRol('administrador',
 * 'auditor')`. Un Coordinador o un Contador reciben 403, que este cliente
 * traduce a `sin-permiso` (backend/src/shared/errores.ts#Prohibido = 403).
 *
 * DOS RUTAS QUE YO HABÍA ADIVINADO MAL, ya corregidas:
 *   - `PATCH /api/usuarios/:id`      → en realidad es `/:id/estado`
 *   - `POST  /api/usuarios/:id/pin`  → en realidad es `/:id/resetear-pin`
 * Los CUERPOS sí coincidían (`{ activo }` y `{ pin }`).
 *
 * `resetearPin` responde 204 sin cuerpo — por eso va con `pedirSinCuerpo`.
 *
 * No hay DELETE y no debe haberlo: el puerto dice "Nunca hay un `eliminar`:
 * un usuario borrado deja conteos huérfanos en un sistema que se audita".
 * El backend coincide — no expone la ruta.
 *
 * CHOQUE DE ADMINISTRADOR — RESUELTO, y a favor del puerto.
 * Cuando leí el zod suelto parecía que `sucursalId` era obligatorio siempre.
 * El README lo aclara: es **obligatorio si `rol !== "administrador"`** y
 * **prohibido si `rol === "administrador"`** (el request falla si viene).
 * O sea que omitir el campo para el administrador — que es lo que este
 * adaptador ya hacía por seguir al puerto — es exactamente lo correcto.
 * Haber mandado una sucursal inventada para esquivar el 400 habría fallado
 * igual, y encima por la razón opuesta.
 *
 * NULOS: el backend manda `sucursalId: null` para las filas de rol
 * administrador (README §Usuarios). El puerto lo declara `sucursalId?:
 * number`, o sea `undefined`. `null` y `undefined` NO son lo mismo para
 * TypeScript ni para un `if (x === undefined)` en una pantalla, así que se
 * normaliza acá — traducir entre la forma del backend y la del puerto es
 * literalmente el trabajo de un adaptador.
 */

import { puedeCrearRol } from '../dominio/roles';
import type { Rol, Usuario } from '../dominio/tipos';
import type { DatosEditarUsuario, DatosNuevoUsuario, RepositorioUsuarios } from '../puertos/repositorios';
import { pedir, pedirSinCuerpo } from './_http';

/**
 * La regla "qué rol puede crear qué rol" vive en lib/dominio/roles.ts —
 * regla de negocio pura, sin dependencias. Se importa en vez de
 * copiarla: dos copias de una regla de permisos es la forma más barata
 * de que algún día un Auditor pueda crear Administradores en una sola de
 * las dos. Y, a diferencia de importarla de usuarios-memoria.ts, este
 * adaptador HTTP no depende del adaptador de mock — puede vivir sin él.
 */

const RUTAS = {
  listar: (sucursalId?: number) =>
    sucursalId === undefined ? '/api/usuarios' : `/api/usuarios?sucursalId=${sucursalId}`,
  coleccion: '/api/usuarios',
  usuario: (usuarioId: number) => `/api/usuarios/${usuarioId}`,
  estado: (usuarioId: number) => `/api/usuarios/${usuarioId}/estado`,
  resetearPin: (usuarioId: number) => `/api/usuarios/${usuarioId}/resetear-pin`,
};

/**
 * Lo que manda el backend (README §Usuarios). Se declara aparte de `Usuario`
 * justamente porque NO es igual: `sucursalId` puede venir `null`, y trae dos
 * campos de auditoría que el puerto no pide.
 */
interface UsuarioDto {
  id: number;
  nombre: string;
  dni: string;
  rol: Rol;
  sucursalId: number | null;
  activo: boolean;
  creadoPorId: number | null;
  createdAt: string;
}

/**
 * `null` → ausente. Sin esto, una pantalla que pregunte
 * `usuario.sucursalId === undefined` para saber "¿es del sistema?" da false
 * para un administrador, que es justamente el caso que quería detectar.
 *
 * `creadoPorId` y `createdAt` se descartan: el puerto no los pide y colarlos
 * de contrabando en el objeto haría que una pantalla los use sin que estén
 * en el contrato — y el día que se enchufe el adaptador en memoria, no están.
 */
function aUsuario(dto: UsuarioDto): Usuario {
  return {
    id: dto.id,
    nombre: dto.nombre,
    dni: dto.dni,
    rol: dto.rol,
    ...(dto.sucursalId === null ? {} : { sucursalId: dto.sucursalId }),
    activo: dto.activo,
  };
}

export const usuariosApi: RepositorioUsuarios = {
  async listar(sucursalId) {
    return (await pedir<UsuarioDto[]>(RUTAS.listar(sucursalId))).map(aUsuario);
  },

  async crear(datos: DatosNuevoUsuario, creadoPorRol: Rol) {
    // Se valida ACÁ aunque la pantalla ya haya filtrado el selector — mismo
    // criterio que RepositorioLacrado.aprobar, lo pide el puerto. Falla
    // antes de gastar un viaje a la red y da un mensaje concreto.
    if (!puedeCrearRol(creadoPorRol, datos.rol)) {
      throw new Error(`Un ${creadoPorRol} no puede crear una cuenta de rol ${datos.rol}.`);
    }

    // OJO: `creadoPorRol` NO se manda al servidor, y está bien que así sea —
    // el backend lo saca del TOKEN (usuarios.controller.ts#actorDe, sobre
    // req.colaborador que cuelga auth.middleware.ts). Si lo tomara del
    // cuerpo, cualquiera con una sesión de Conteo podría mandar
    // `creadoPorRol: 'administrador'` y darse de alta como Administrador.
    // Esta validación local es comodidad de UX; la que manda es la del
    // servidor.
    return aUsuario(
      await pedir<UsuarioDto>(RUTAS.coleccion, {
        metodo: 'POST',
        cuerpo: {
          nombre: datos.nombre,
          dni: datos.dni,
          rol: datos.rol,
          // Para el administrador el campo se OMITE, no se manda null: el
          // backend rechaza el request si viene (README §Usuarios).
          ...(datos.rol === 'administrador' ? {} : { sucursalId: datos.sucursalId }),
          pin: datos.pin,
        },
      }),
    );
  },

  async editar(usuarioId, datos: DatosEditarUsuario) {
    return aUsuario(
      await pedir<UsuarioDto>(RUTAS.usuario(usuarioId), {
        metodo: 'PATCH',
        cuerpo: {
          ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
          ...(datos.dni !== undefined ? { dni: datos.dni } : {}),
          ...(datos.rol !== undefined ? { rol: datos.rol } : {}),
          ...(datos.rol === 'administrador'
            ? {}
            : datos.sucursalId !== undefined
              ? { sucursalId: datos.sucursalId }
              : {}),
        },
      }),
    );
  },

  async cambiarActivo(usuarioId, activo) {
    return aUsuario(await pedir<UsuarioDto>(RUTAS.estado(usuarioId), { metodo: 'PATCH', cuerpo: { activo } }));
  },

  async resetearPin(usuarioId, nuevoPin) {
    // 204 sin cuerpo: no hay nada que parsear y el puerto devuelve void.
    await pedirSinCuerpo(RUTAS.resetearPin(usuarioId), { metodo: 'POST', cuerpo: { pin: nuevoPin } });
  },

  async eliminar(usuarioId) {
    // 204 sin cuerpo
    await pedirSinCuerpo(RUTAS.usuario(usuarioId), { metodo: 'DELETE' });
  },
};
