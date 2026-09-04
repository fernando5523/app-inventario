/** Unico archivo del modulo que toca Prisma (regla de capas dura). */

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { NoEncontrado, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { listarAlmacenes } from '../d365/d365-catalogo.service';
import { resolverAlmacen, type AlmacenResuelto } from './tiendas.almacen';
import type { ActualizarTiendaInput, CrearTiendaInput } from './tiendas.schema';

export interface TiendaDto {
  id: number;
  nombre: string;
  activa: boolean;
  direccion: string | null;
  telefono: string | null;
  /** `WarehouseId` de Dynamics. null = todavia no se configuro. */
  almacenId: string | null;
  almacenNombre: string | null;
  /**
   * false = esta tienda NO puede traer stock del ERP todavia. Se expone
   * para que la pantalla lo diga al listar, en vez de que el Coordinador se
   * entere recien cuando aprieta "traer snapshot" y falla.
   */
  puedeTraerStock: boolean;
  colaboradores: number;
}

function aDto(t: {
  id: number;
  nombre: string;
  activa: boolean;
  direccion: string | null;
  telefono: string | null;
  almacenId: string | null;
  almacenNombre: string | null;
  _count: { colaboradores: number };
}): TiendaDto {
  return {
    id: t.id,
    nombre: t.nombre,
    activa: t.activa,
    direccion: t.direccion,
    telefono: t.telefono,
    almacenId: t.almacenId,
    almacenNombre: t.almacenNombre,
    puedeTraerStock: t.almacenId !== null && t.almacenId !== '',
    colaboradores: t._count.colaboradores,
  };
}

/**
 * Traduce el codigo pedido a {codigo, nombre} verificandolo contra la lista
 * REAL de Dynamics. Es la unica parte de este modulo que toca la red, y por
 * eso esta aislada: si Dynamics no contesta, el alta de la tienda falla con
 * un mensaje claro en vez de guardar un almacen sin verificar.
 *
 * Que el codigo se verifique aca y no solo en el schema es lo que impide el
 * error caro: "MD11_CNET" pasa cualquier validacion de formato y trae el
 * stock de otra tienda -- o de ninguna -- sin que nadie se entere hasta que
 * el inventario no cuadra (ver tiendas.almacen.ts).
 */
async function verificarAlmacen(codigo: string): Promise<AlmacenResuelto> {
  let disponibles;
  try {
    disponibles = await listarAlmacenes();
  } catch (err) {
    throw new SolicitudInvalida(
      'No se pudo consultar la lista de almacenes de Dynamics para verificar el codigo. ' +
        'Revisá la conexion con el ERP e intentá de nuevo: no se guarda un almacen sin confirmar que existe. ' +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return resolverAlmacen(codigo, disponibles);
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
  const almacen = input.almacenId !== undefined ? await verificarAlmacen(input.almacenId) : null;

  const creada = await prisma.sucursal.create({
    // `exactOptionalPropertyTypes` no deja pasar `undefined` explicito en
    // una prop opcional de Prisma -- se omite la clave cuando no vino.
    data: {
      nombre: input.nombre,
      ...(input.direccion !== undefined ? { direccion: input.direccion } : {}),
      ...(input.telefono !== undefined ? { telefono: input.telefono } : {}),
      // Se guarda el codigo TAL CUAL viene del ERP, no como lo tipeo el
      // cliente: si se guardara lo del cliente, dos tiendas podrian quedar
      // con "md11_cent" y "MD11_CENT" para el mismo almacen.
      ...(almacen !== null ? { almacenId: almacen.almacenId, almacenNombre: almacen.almacenNombre } : {}),
    },
    include: { _count: { select: { colaboradores: true } } },
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'sucursal.creada',
    entidad: 'sucursal',
    entidadId: creada.id,
    detalle: { nombre: creada.nombre, almacenId: creada.almacenId },
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

  // `null` explicito DESASOCIA el almacen; un codigo lo verifica y lo
  // cambia; `undefined` (no vino) lo deja como estaba.
  let almacen: AlmacenResuelto | null | undefined;
  if (input.almacenId === null) almacen = null;
  else if (input.almacenId !== undefined) almacen = await verificarAlmacen(input.almacenId);

  const actualizada = await prisma.sucursal.update({
    where: { id },
    // Mismo motivo que en crear(): reconstruir el objeto filtra las claves
    // en `undefined` en vez de mandarlas explicitas.
    data: {
      ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
      ...(input.direccion !== undefined ? { direccion: input.direccion } : {}),
      ...(input.telefono !== undefined ? { telefono: input.telefono } : {}),
      ...(input.activa !== undefined ? { activa: input.activa } : {}),
      ...(almacen === null ? { almacenId: null, almacenNombre: null } : {}),
      ...(almacen !== null && almacen !== undefined
        ? { almacenId: almacen.almacenId, almacenNombre: almacen.almacenNombre }
        : {}),
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
