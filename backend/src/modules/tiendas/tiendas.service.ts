/** Unico archivo del modulo que toca Prisma (regla de capas dura). */

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import type { ActualizarTiendaInput, CrearTiendaInput } from './tiendas.schema';

export interface TiendaDto {
  id: number;
  nombre: string;
  activa: boolean;
  direccion: string | null;
  telefono: string | null;
  colaboradores: number;
}

function aDto(t: {
  id: number;
  nombre: string;
  activa: boolean;
  direccion: string | null;
  telefono: string | null;
  _count: { colaboradores: number };
}): TiendaDto {
  return {
    id: t.id,
    nombre: t.nombre,
    activa: t.activa,
    direccion: t.direccion,
    telefono: t.telefono,
    colaboradores: t._count.colaboradores,
  };
}

/** Solo administrador entra a este modulo (ver tiendas.routes.ts): incluye inactivas a proposito. */
export async function listar(): Promise<TiendaDto[]> {
  const tiendas = await prisma.sucursal.findMany({
    orderBy: { id: 'asc' },
    include: { _count: { select: { colaboradores: true } } },
  });
  return tiendas.map(aDto);
}

export async function crear(actor: ColaboradorAutenticado, input: CrearTiendaInput): Promise<TiendaDto> {
  const creada = await prisma.sucursal.create({
    // `exactOptionalPropertyTypes` no deja pasar `undefined` explicito en
    // una prop opcional de Prisma -- se omite la clave cuando no vino.
    data: {
      nombre: input.nombre,
      ...(input.direccion !== undefined ? { direccion: input.direccion } : {}),
      ...(input.telefono !== undefined ? { telefono: input.telefono } : {}),
    },
    include: { _count: { select: { colaboradores: true } } },
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'sucursal.creada',
    entidad: 'sucursal',
    entidadId: creada.id,
    detalle: { nombre: creada.nombre },
  });

  return aDto(creada);
}

export async function actualizar(
  actor: ColaboradorAutenticado,
  id: number,
  input: ActualizarTiendaInput,
): Promise<TiendaDto> {
  const existe = await prisma.sucursal.findUnique({ where: { id } });
  if (!existe) throw new NoEncontrado('Tienda no encontrada.');

  const actualizada = await prisma.sucursal.update({
    where: { id },
    // Mismo motivo que en crear(): reconstruir el objeto filtra las claves
    // en `undefined` en vez de mandarlas explicitas.
    data: {
      ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
      ...(input.direccion !== undefined ? { direccion: input.direccion } : {}),
      ...(input.telefono !== undefined ? { telefono: input.telefono } : {}),
      ...(input.activa !== undefined ? { activa: input.activa } : {}),
    },
    include: { _count: { select: { colaboradores: true } } },
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'sucursal.actualizada',
    entidad: 'sucursal',
    entidadId: id,
    detalle: input,
  });

  return aDto(actualizada);
}
