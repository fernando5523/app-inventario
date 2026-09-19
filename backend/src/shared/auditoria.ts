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

/**
 * `tx` OPCIONAL, para cuando el hecho auditado va adentro de una transaccion.
 *
 * Sin esto, el registro se escribe con el cliente global y queda FUERA de la
 * transaccion de quien llama: si esa transaccion hace rollback, el log afirma
 * que paso algo que no paso. Es el caso de `sacarDeLaRondaSiguienteSiCuadro`,
 * donde el cambio de valor y la limpieza de la ronda son un solo hecho.
 *
 * Por defecto sigue siendo el cliente global, asi que los llamadores que no
 * estan en transaccion no cambian en nada.
 */
export async function registrarAuditoria(
  input: RegistroAuditoriaInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.registroAuditoria.create({
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
