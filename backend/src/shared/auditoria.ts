/**
 * Escritura de RegistroAuditoria, compartida por los modulos de
 * administracion (usuarios, tiendas, config). No es un modulo con rutas
 * propias -- nadie pidio un endpoint para LEER el log todavia, asi que no
 * se inventa uno (ver AGENTS.md/CLAUDE.md: no construir para lo que no se
 * pidio); esto es solo el punto unico de escritura para que ningun
 * service arme el insert a mano y se olvide un campo.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

export interface RegistroAuditoriaInput {
  actorId: number;
  accion: string;
  entidad: string;
  entidadId: number;
  /** Nunca un PIN ni ningun secreto -- ver prisma/schema.prisma#RegistroAuditoria. */
  detalle: Record<string, unknown> | null;
}

export async function registrarAuditoria(input: RegistroAuditoriaInput): Promise<void> {
  await prisma.registroAuditoria.create({
    data: {
      actorId: input.actorId,
      accion: input.accion,
      entidad: input.entidad,
      entidadId: input.entidadId,
      // `exactOptionalPropertyTypes` no deja pasar `undefined` explicito
      // en una prop opcional -- si no hay detalle, se omite la clave
      // entera en vez de mandarla en `undefined`.
      // Cast a InputJsonValue: Prisma no infiere que un Record<string, unknown>
      // hecho a mano cumple su union recursiva de JSON, aunque en runtime
      // sea un objeto plano serializable sin vueltas.
      ...(input.detalle !== null ? { detalle: input.detalle as Prisma.InputJsonValue } : {}),
    },
  });
}
