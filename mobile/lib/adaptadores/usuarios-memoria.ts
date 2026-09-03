/**
 * Adaptador en memoria de RepositorioUsuarios.
 *
 * Sembrado a partir del MISMO padrón de sesion-memoria.ts (4 sucursales,
 * sus colaboradores) — no se inventa una lista paralela de personas. Se
 * le suma UNA cuenta de rol Administrador (id 999): no existe ningún
 * Administrador en el padrón de login todavía (sesion-memoria.ts no es
 * parte de esta tarea, lo agrega el agente de sesión/integración), así
 * que esta cuenta es gestionable acá pero, hoy, no puede entrar por el
 * login — ver el resumen de la tarea.
 *
 * `rolesQuePuedeCrear`/`puedeCrearRol` viven en lib/dominio/roles.ts (regla
 * de negocio pura, sin dependencias) — este adaptador solo la importa para
 * revalidar en `crear()`, nunca confiar en que la pantalla ya filtró el
 * selector.
 */

import { puedeCrearRol } from '../dominio/roles';
import type { Rol, Usuario } from '../dominio/tipos';
import type { DatosNuevoUsuario, RepositorioUsuarios } from '../puertos/repositorios';
import { simularLatencia } from './_compartido';
import { sesionMemoria } from './sesion-memoria';

// ---------------------------------------------------------------------------

/** Las mismas 4 sucursales de sesion-memoria.ts — se listan por id, sin duplicar sus nombres. */
const IDS_SUCURSAL = [1, 2, 3, 4];

const usuarios: Usuario[] = [
  {
    id: 999,
    nombre: 'Administrador General',
    dni: '0000',
    rol: 'administrador',
    activo: true,
  },
];
let proximoId = 1000;

let semillaPromise: Promise<void> | null = null;
function asegurarSemilla(): Promise<void> {
  if (!semillaPromise) {
    semillaPromise = (async () => {
      for (const sucursalId of IDS_SUCURSAL) {
        const colaboradores = await sesionMemoria.colaboradores(sucursalId);
        for (const c of colaboradores) {
          usuarios.push({ id: c.id, nombre: c.nombre, dni: c.dni, rol: c.rol, sucursalId, activo: true });
        }
      }
    })();
  }
  return semillaPromise;
}

export const usuariosMemoria: RepositorioUsuarios = {
  async listar(sucursalId) {
    await simularLatencia();
    await asegurarSemilla();
    if (sucursalId === undefined) return usuarios;
    return usuarios.filter((u) => u.sucursalId === sucursalId);
  },

  async crear(datos: DatosNuevoUsuario, creadoPorRol: Rol) {
    await simularLatencia();
    await asegurarSemilla();

    // Nunca confiar en que la pantalla ya filtró el selector — se vuelve
    // a chequear acá, mismo criterio que RepositorioLacrado.aprobar.
    if (!puedeCrearRol(creadoPorRol, datos.rol)) {
      throw new Error(`Un ${creadoPorRol} no puede crear una cuenta de rol ${datos.rol}.`);
    }
    if (datos.pin.length !== 6) {
      throw new Error('El PIN debe tener 6 dígitos.');
    }
    if (datos.rol !== 'administrador' && datos.sucursalId === undefined) {
      throw new Error('Falta la sucursal de la nueva cuenta.');
    }

    const nuevo: Usuario = {
      id: proximoId++,
      nombre: datos.nombre,
      dni: datos.dni,
      rol: datos.rol,
      sucursalId: datos.rol === 'administrador' ? undefined : datos.sucursalId,
      activo: true,
    };
    usuarios.push(nuevo);
    return nuevo;
  },

  async cambiarActivo(usuarioId, activo) {
    await simularLatencia();
    await asegurarSemilla();
    const usuario = usuarios.find((u) => u.id === usuarioId);
    if (!usuario) throw new Error(`Usuario ${usuarioId} no encontrado.`);
    usuario.activo = activo;
    return usuario;
  },

  async resetearPin(usuarioId, nuevoPin) {
    await simularLatencia();
    await asegurarSemilla();
    const usuario = usuarios.find((u) => u.id === usuarioId);
    if (!usuario) throw new Error(`Usuario ${usuarioId} no encontrado.`);
    if (nuevoPin.length !== 6) throw new Error('El PIN debe tener 6 dígitos.');
    // El PIN en sí no se modela acá (mismo criterio que sesion-memoria.ts:
    // no hay backend todavía, así que no hay dónde guardarlo de verdad) —
    // el punto de esta llamada es que exista un método real que el
    // adaptador HTTP pueda reemplazar sin tocar la pantalla.
  },
};
