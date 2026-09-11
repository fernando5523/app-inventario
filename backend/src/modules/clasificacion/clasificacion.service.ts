/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * usuarios.service.ts). La regla de "quien puede" vive en
 * clasificacion.permisos.ts -- pura, sin Prisma.
 *
 * ---------------------------------------------------------------------------
 * DE DONDE SALEN LOS PRODUCTOS BUSCABLES
 * ---------------------------------------------------------------------------
 * Del CATALOGO que ya esta en la base: los `codigo` distintos de
 * `CatalogoItem` (los snapshots de Dynamics ya tomados), tomando de cada uno
 * su fila MAS reciente (mayor `inventarioId`) para mostrar la descripcion,
 * categoria y responsable frescos. Tres razones:
 *   - `codigo` (ItemNumber) es la identidad estable entre periodos, y es
 *     justo por lo que se clasifica (ClasificacionProducto.codigo @unique);
 *   - son los productos que REALMENTE se inventariaron -- exactamente el
 *     conjunto que el Auditor necesita clasificar;
 *   - no hay llamada viva a Dynamics: la clasificacion es un flujo de base,
 *     se evalua al liquidar contra el catalogo, no contra el ERP de hoy.
 *
 * DOS DATOS QUE NO SE PISAN (pedido explicito): por producto se muestra lo que
 * dice Dynamics (`responsableDynamics`, del snapshot) Y lo que decidio el
 * Auditor (`clasificacion`, la fila viva de ClasificacionProducto), separados.
 */

import { Prisma, type ResponsableItem } from '@prisma/client';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarPermisoDeClasificacion } from './clasificacion.permisos';
import type { BuscarQuery, ClasificarInput } from './clasificacion.schema';

/** La decision del Auditor sobre un codigo (la fila viva de ClasificacionProducto). */
export interface ClasificacionDto {
  codigo: string;
  /** true = lo asume la empresa (excepcion a Dynamics); false = del empleado. */
  esEmpresa: boolean;
  nota: string | null;
  clasificadoPorId: number;
  clasificadoEn: string;
}

/** Un producto del catalogo, con lo de Dynamics y lo del Auditor por separado. */
export interface ProductoClasificableDto {
  codigo: string;
  descripcion: string;
  categoria: string | null;
  /** Lo que dice DYNAMICS (snapshot). El Auditor NO lo pisa. `null` = D365 dijo 'None'. */
  responsableDynamics: ResponsableItem | null;
  /** Lo que decidio el AUDITOR, o `null` si no hay excepcion (manda Dynamics). */
  clasificacion: ClasificacionDto | null;
}

export interface ListadoProductosDto {
  total: number;
  limite: number;
  desplazamiento: number;
  productos: ProductoClasificableDto[];
}

type FilaClasificacion = {
  codigo: string;
  esEmpresa: boolean;
  nota: string | null;
  clasificadoPorId: number;
  clasificadoEn: Date;
};

function aClasificacionDto(c: FilaClasificacion): ClasificacionDto {
  return {
    codigo: c.codigo,
    esEmpresa: c.esEmpresa,
    nota: c.nota,
    clasificadoPorId: c.clasificadoPorId,
    clasificadoEn: c.clasificadoEn.toISOString(),
  };
}

function aProductoDto(
  item: { codigo: string; descripcion: string; categoria: string | null; responsable: ResponsableItem | null },
  clasificacion: FilaClasificacion | undefined,
): ProductoClasificableDto {
  return {
    codigo: item.codigo,
    descripcion: item.descripcion,
    categoria: item.categoria,
    responsableDynamics: item.responsable,
    clasificacion: clasificacion ? aClasificacionDto(clasificacion) : null,
  };
}

export async function buscar(actor: ColaboradorAutenticado, query: BuscarQuery): Promise<ListadoProductosDto> {
  validarPermisoDeClasificacion(actor);

  const condiciones: Prisma.CatalogoItemWhereInput[] = [];
  if (query.q) {
    condiciones.push({
      OR: [
        { codigo: { contains: query.q, mode: 'insensitive' } },
        { descripcion: { contains: query.q, mode: 'insensitive' } },
        { categoria: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }
  if (query.soloClasificados) {
    const clasificados = await prisma.clasificacionProducto.findMany({ select: { codigo: true } });
    condiciones.push({ codigo: { in: clasificados.map((c) => c.codigo) } });
  }
  const where: Prisma.CatalogoItemWhereInput =
    condiciones.length === 0 ? {} : condiciones.length === 1 ? condiciones[0]! : { AND: condiciones };

  const [grupos, filas] = await Promise.all([
    // El total ES la cantidad de codigos DISTINTOS que matchean, no de filas
    // de catalogo (el mismo codigo esta repetido en cada snapshot).
    prisma.catalogoItem.groupBy({ by: ['codigo'], where, orderBy: { codigo: 'asc' } }),
    prisma.catalogoItem.findMany({
      where,
      // Un codigo, su snapshot mas reciente: DISTINCT ON (codigo) exige que
      // `codigo` vaya primero en el orderBy; `inventarioId desc` elige la
      // fila mas nueva de ese codigo.
      distinct: ['codigo'],
      orderBy: [{ codigo: 'asc' }, { inventarioId: 'desc' }],
      take: query.limite,
      skip: query.desplazamiento,
      select: { codigo: true, descripcion: true, categoria: true, responsable: true },
    }),
  ]);

  const codigos = filas.map((f) => f.codigo);
  const clasificaciones =
    codigos.length > 0 ? await prisma.clasificacionProducto.findMany({ where: { codigo: { in: codigos } } }) : [];
  const porCodigo = new Map(clasificaciones.map((c) => [c.codigo, c]));

  return {
    total: grupos.length,
    limite: query.limite,
    desplazamiento: query.desplazamiento,
    productos: filas.map((f) => aProductoDto(f, porCodigo.get(f.codigo))),
  };
}

export async function clasificar(
  actor: ColaboradorAutenticado,
  codigo: string,
  input: ClasificarInput,
): Promise<ClasificacionDto> {
  validarPermisoDeClasificacion(actor);

  const nota = input.nota ?? null;
  // Se lee ANTES del upsert para saber si es alta o cambio, y para dejar el
  // valor anterior en la auditoria cuando es un cambio.
  const anterior = await prisma.clasificacionProducto.findUnique({ where: { codigo } });
  const clasificadoEn = new Date();

  const fila = await prisma.clasificacionProducto.upsert({
    where: { codigo },
    create: { codigo, esEmpresa: input.esEmpresa, nota, clasificadoPorId: actor.colaboradorId, clasificadoEn },
    update: { esEmpresa: input.esEmpresa, nota, clasificadoPorId: actor.colaboradorId, clasificadoEn },
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: anterior ? 'clasificacion.actualizada' : 'clasificacion.creada',
    entidad: 'clasificacion_producto',
    entidadId: fila.id,
    detalle: anterior
      ? { codigo, esEmpresa: input.esEmpresa, nota, anterior: { esEmpresa: anterior.esEmpresa, nota: anterior.nota } }
      : { codigo, esEmpresa: input.esEmpresa, nota },
  });

  return aClasificacionDto(fila);
}

export async function desclasificar(actor: ColaboradorAutenticado, codigo: string): Promise<void> {
  validarPermisoDeClasificacion(actor);

  const anterior = await prisma.clasificacionProducto.findUnique({ where: { codigo } });
  if (!anterior) {
    throw new NoEncontrado(`No hay una clasificacion para el codigo ${codigo}.`);
  }

  await prisma.clasificacionProducto.delete({ where: { codigo } });

  // El RASTRO: la fila se borra a proposito (sin fila = sin excepcion, manda
  // Dynamics -- ver schema.prisma#ClasificacionProducto), pero la historia no
  // se pierde: queda QUE se quito, con su valor anterior, quien y cuando, en
  // RegistroAuditoria (el mismo lugar donde vive el historial de cambios).
  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'clasificacion.eliminada',
    entidad: 'clasificacion_producto',
    entidadId: anterior.id,
    detalle: { codigo, anterior: { esEmpresa: anterior.esEmpresa, nota: anterior.nota } },
  });
}
