/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * sesion.service.ts). La matriz de "quien puede crear/gestionar a quien"
 * vive en usuarios.permisos.ts -- pura, sin Prisma, para poder testearla
 * sin base de datos (ver usuarios.permisos.test.ts).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado, Prohibido } from '../../shared/errores';
import { hashearPin } from '../../shared/pin';
import { validarPinElegible } from '../sesion/sesion.pin';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import { ROLES_GESTIONABLES_POR_AUDITOR, validarAlcanceDeGestion, validarPermisoDeAlta } from './usuarios.permisos';
import type { CrearUsuarioInput, EditarUsuarioInput } from './usuarios.schema';

export interface UsuarioDto {
  id: number;
  nombre: string;
  dni: string;
  rol: Rol;
  /** null solo para rol=administrador -- ver prisma/schema.prisma#Colaborador.sucursalId. */
  sucursalId: number | null;
  activo: boolean;
  creadoPorId: number | null;
  createdAt: string;
}

function aDto(c: {
  id: number;
  nombre: string;
  dni: string;
  rol: Rol;
  sucursalId: number | null;
  activo: boolean;
  creadoPorId: number | null;
  createdAt: Date;
}): UsuarioDto {
  return {
    id: c.id,
    nombre: c.nombre,
    dni: c.dni,
    rol: c.rol,
    sucursalId: c.sucursalId,
    activo: c.activo,
    creadoPorId: c.creadoPorId,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listar(actor: ColaboradorAutenticado, sucursalIdFiltro?: number): Promise<UsuarioDto[]> {
  // Un auditor nunca ve fuera de su propia sucursal, pida lo que pida el query param.
  const sucursalId = actor.rol === 'auditor' ? actor.sucursalId : sucursalIdFiltro;

  const usuarios = await prisma.colaborador.findMany({
    // `exactOptionalPropertyTypes` no deja `where: undefined` explicito --
    // se omite la clave entera cuando no hay filtro de sucursal.
    ...(sucursalId ? { where: { sucursalId } } : {}),
    orderBy: { id: 'asc' },
  });
  return usuarios.map(aDto);
}

export async function crear(actor: ColaboradorAutenticado, input: CrearUsuarioInput): Promise<UsuarioDto> {
  validarPermisoDeAlta(actor, { rol: input.rol, sucursalId: input.sucursalId });

  // Sin colaboradorId: al crear, el id lo autogenera Prisma, asi que aca
  // solo se puede frenar el trivial (123456, 111111...). El predecible se
  // valida al resetear, que ya conoce el id. Ver validarPinElegible.
  validarPinElegible(input.pin);

  const pinHash = await hashearPin(input.pin);

  try {
    const creado = await prisma.colaborador.create({
      data: {
        nombre: input.nombre,
        dni: input.dni,
        rol: input.rol,
        // El schema (crearUsuarioSchema) ya garantizo que sucursalId viene
        // SIEMPRE que rol !== administrador, y NUNCA cuando rol ===
        // administrador -- null explicito ahi, nunca un valor inventado.
        sucursalId: input.rol === 'administrador' ? null : (input.sucursalId as number),
        pinHash,
        creadoPorId: actor.colaboradorId,
      },
    });

    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'colaborador.creado',
      entidad: 'colaborador',
      entidadId: creado.id,
      // Nunca el PIN aca -- ver comentario de prisma/schema.prisma#RegistroAuditoria.
      detalle: { nombre: creado.nombre, rol: creado.rol, sucursalId: creado.sucursalId },
    });

    return aDto(creado);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Conflicto('Ya existe un colaborador con ese DNI en esa sucursal.');
    }
    throw err;
  }
}

/**
 * Trae el colaborador objetivo y valida que `actor` tenga alcance sobre
 * el (usuarios.permisos.ts#validarAlcanceDeGestion).
 */
async function obtenerConAlcance(actor: ColaboradorAutenticado, id: number) {
  const objetivo = await prisma.colaborador.findUnique({ where: { id } });
  if (!objetivo) throw new NoEncontrado('Colaborador no encontrado.');

  validarAlcanceDeGestion(actor, { rol: objetivo.rol, sucursalId: objetivo.sucursalId });
  return objetivo;
}

export async function actualizarEstado(actor: ColaboradorAutenticado, id: number, activo: boolean): Promise<UsuarioDto> {
  await obtenerConAlcance(actor, id);

  const actualizado = await prisma.colaborador.update({ where: { id }, data: { activo } });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: activo ? 'colaborador.habilitado' : 'colaborador.deshabilitado',
    entidad: 'colaborador',
    entidadId: id,
    detalle: null,
  });

  return aDto(actualizado);
}

export async function resetearPin(actor: ColaboradorAutenticado, id: number, pinNuevo: string): Promise<void> {
  await obtenerConAlcance(actor, id);

  // Con el id a la vista: se frena el predecible (000<id>) Y el trivial. Un
  // reseteo que devuelve el PIN predecible reabre el agujero que la app vino
  // a cerrar.
  validarPinElegible(pinNuevo, id);

  const pinHash = await hashearPin(pinNuevo);
  await prisma.colaborador.update({ where: { id }, data: { pinHash } });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'colaborador.pin_reseteado',
    entidad: 'colaborador',
    entidadId: id,
    // Nunca el PIN nuevo aca -- ver comentario de prisma/schema.prisma#RegistroAuditoria.
    detalle: null,
  });
}

export async function editar(actor: ColaboradorAutenticado, id: number, input: EditarUsuarioInput): Promise<UsuarioDto> {
  await obtenerConAlcance(actor, id);

  if (actor.rol === 'auditor') {
    if (input.rol && !ROLES_GESTIONABLES_POR_AUDITOR.includes(input.rol)) {
      throw new Prohibido('Un auditor solo puede asignar roles coordinador o conteo.');
    }
    if (input.sucursalId !== undefined && input.sucursalId !== actor.sucursalId) {
      throw new Prohibido('Un auditor solo puede asignar cuentas de su propia sucursal.');
    }
  }

  const data: Prisma.ColaboradorUncheckedUpdateInput = {};
  if (input.nombre !== undefined) data.nombre = input.nombre;
  if (input.dni !== undefined) data.dni = input.dni;
  if (input.rol !== undefined) {
    data.rol = input.rol;
    if (input.rol === 'administrador') {
      data.sucursalId = null;
    }
  }
  if (input.sucursalId !== undefined) {
    data.sucursalId = input.rol === 'administrador' ? null : input.sucursalId;
  }

  try {
    const actualizado = await prisma.colaborador.update({
      where: { id },
      data,
    });

    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'colaborador.editado',
      entidad: 'colaborador',
      entidadId: id,
      detalle: {
        nombre: actualizado.nombre,
        dni: actualizado.dni,
        rol: actualizado.rol,
        sucursalId: actualizado.sucursalId,
      },
    });

    return aDto(actualizado);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Conflicto('Ya existe un colaborador con ese DNI en esa sucursal.');
    }
    throw err;
  }
}

export async function eliminar(actor: ColaboradorAutenticado, id: number): Promise<void> {
  const objetivo = await obtenerConAlcance(actor, id);

  if (actor.colaboradorId === id) {
    throw new Conflicto('No podés eliminar tu propia cuenta.');
  }

  // Elimina sesiones asociadas
  await prisma.sesionToken.deleteMany({ where: { colaboradorId: id } });

  // Limpiar referencias para evitar fallas por FK
  await prisma.colaborador.updateMany({ where: { creadoPorId: id }, data: { creadoPorId: null } });
  await prisma.hojaConteo.updateMany({ where: { asignadoAId: id }, data: { asignadoAId: null } });
  await prisma.hojaConteo.updateMany({ where: { asignadoA2Id: id }, data: { asignadoA2Id: null } });

  try {
    await prisma.colaborador.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new Conflicto('No se puede eliminar el usuario porque tiene registros históricos asociados.');
    }
    throw err;
  }

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'colaborador.eliminado',
    entidad: 'colaborador',
    entidadId: id,
    detalle: {
      nombre: objetivo.nombre,
      dni: objetivo.dni,
      rol: objetivo.rol,
      sucursalId: objetivo.sucursalId,
    },
  });
}

