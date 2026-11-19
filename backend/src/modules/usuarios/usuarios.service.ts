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

/**
 * Un DNI es una persona: no puede estar en dos cuentas habilitadas a la vez.
 *
 * El índice único de la base es por sucursal (sucursal_id, dni), así que no
 * frenaba el mismo DNI en dos tiendas, ni entre un administrador (sin
 * sucursal: Postgres trata cada NULL como distinto) y un empleado de tienda.
 * Visto en producción el 2026-11-18: el Administrador y el Contador de
 * Raymondi con el mismo DNI.
 *
 * Las cuentas DESHABILITADAS no cuentan, a propósito: quien se cambia de
 * tienda se deshabilita en la vieja y se da de alta en la nueva.
 */
async function validarDniLibre(dni: string, excluirId?: number): Promise<void> {
  const otra = await prisma.colaborador.findFirst({
    where: { dni, activo: true, ...(excluirId !== undefined ? { id: { not: excluirId } } : {}) },
    select: { sucursal: { select: { nombre: true } } },
  });
  if (!otra) return;
  const donde = otra.sucursal ? `en ${otra.sucursal.nombre}` : 'de administrador';
  throw new Conflicto(`Ese DNI ya está en otra cuenta habilitada ${donde}. Esa cuenta se tiene que deshabilitar primero.`);
}

export async function crear(actor: ColaboradorAutenticado, input: CrearUsuarioInput): Promise<UsuarioDto> {
  validarPermisoDeAlta(actor, { rol: input.rol, sucursalId: input.sucursalId });
  await validarDniLibre(input.dni);

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
  const objetivo = await obtenerConAlcance(actor, id);
  // Habilitar de nuevo no puede dejar dos cuentas habilitadas con el mismo DNI.
  if (activo && !objetivo.activo) await validarDniLibre(objetivo.dni, id);

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
  const objetivo = await obtenerConAlcance(actor, id);
  // Solo si el DNI CAMBIA: editar el nombre de una cuenta que ya comparte DNI
  // (datos de antes de esta regla) no tiene que fallar por eso.
  if (input.dni !== undefined && input.dni !== objetivo.dni && objetivo.activo) {
    await validarDniLibre(input.dni, id);
  }

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
    throw new Conflicto('No puedes eliminar tu propia cuenta.');
  }

  // Todo o nada. Si el borrado falla porque la persona tiene historia
  // (conteos, asistencia), nada de lo anterior queda hecho. Antes cada paso se
  // guardaba por separado: intentar eliminar a un Contador que ya contó
  // fallaba, pero le dejaba sus hojas sin asignar y la sesión cerrada, a mitad
  // del inventario. Comprobado en producción el 2026-11-19 con una
  // transacción deshecha: 22 hojas del Contador de Raymondi quedaban sin dueño.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sesionToken.deleteMany({ where: { colaboradorId: id } });
      // Limpiar referencias para evitar fallas por FK
      await tx.colaborador.updateMany({ where: { creadoPorId: id }, data: { creadoPorId: null } });
      await tx.hojaConteo.updateMany({ where: { asignadoAId: id }, data: { asignadoAId: null } });
      await tx.hojaConteo.updateMany({ where: { asignadoA2Id: id }, data: { asignadoA2Id: null } });
      await tx.colaborador.delete({ where: { id } });
    });
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

