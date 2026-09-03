/** Unico archivo del modulo que toca Prisma (regla de capas dura). */

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { parsearValor, VALIDADORES } from './config.validadores';
import type { ClaveConfiguracion } from './config.schema';

export interface ConfiguracionDto {
  clave: string;
  valor: number | string;
  tipo: 'entero' | 'decimal' | 'texto';
  descripcion: string;
  updatedAt: string;
}

export async function listar(): Promise<ConfiguracionDto[]> {
  const filas = await prisma.configuracion.findMany({ orderBy: { clave: 'asc' } });
  return filas.map((f) => ({
    clave: f.clave,
    valor: parsearValor(f.valor, f.tipo),
    tipo: f.tipo,
    descripcion: f.descripcion,
    updatedAt: f.updatedAt.toISOString(),
  }));
}

export async function actualizar(
  actor: ColaboradorAutenticado,
  clave: ClaveConfiguracion,
  valorCrudo: string | number,
): Promise<ConfiguracionDto> {
  const existente = await prisma.configuracion.findUnique({ where: { clave } });
  if (!existente) throw new NoEncontrado(`No existe la configuracion "${clave}".`);

  const valor = VALIDADORES[clave](valorCrudo);

  const actualizada = await prisma.configuracion.update({ where: { clave }, data: { valor } });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'configuracion.actualizada',
    entidad: 'configuracion',
    entidadId: actualizada.id,
    detalle: { clave, valorAnterior: existente.valor, valorNuevo: valor },
  });

  return {
    clave: actualizada.clave,
    valor: parsearValor(actualizada.valor, actualizada.tipo),
    tipo: actualizada.tipo,
    descripcion: actualizada.descripcion,
    updatedAt: actualizada.updatedAt.toISOString(),
  };
}
