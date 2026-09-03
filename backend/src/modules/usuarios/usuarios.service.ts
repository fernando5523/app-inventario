/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * sesion.service.ts). La matriz de "quien puede crear/gestionar a quien"
 * vive en usuarios.permisos.ts -- pura, sin Prisma, para poder testearla
 * sin base de datos (ver usuarios.permisos.test.ts).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import { hashearPin } from '../../shared/pin';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import { validarAlcanceDeGestion, validarPermisoDeAlta } from './usuarios.permisos';
import type { CrearUsuarioInput } from './usuarios.schema';

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
