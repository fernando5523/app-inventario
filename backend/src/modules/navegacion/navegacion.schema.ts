import { z } from 'zod';

/** Los cuatro roles, tal cual el enum de Prisma. */
export const rolSchema = z.enum(['administrador', 'coordinador', 'conteo', 'auditor']);

export const parametrosRolSchema = z.object({ rol: rolSchema });
export type ParametrosRol = z.infer<typeof parametrosRolSchema>;

export const tipoNavegacionSchema = z.enum(['acceso', 'tab']);

/**
 * LA LISTA ENTERA Y EN ORDEN, no un diff -- ver `navegacion.service.ts#guardar`.
 *
 * `min(1)` a proposito: mandar una lista VACIA dejaria al rol sin una sola
 * tarjeta, que es exactamente el home en blanco que esta funcionalidad no
 * puede producir. Para esconder todo hay que apagar uno por uno, y ahi la
 * pantalla muestra lo que va a pasar.
 */
export const guardarNavegacionSchema = z
  .object({
    tipo: tipoNavegacionSchema,
    elementos: z
      .array(
        z
          .object({
            /** La ruta (acceso) o el nombre de archivo (tab). Ver el schema de Prisma. */
            clave: z.string().trim().min(1),
            visible: z.boolean(),
          })
          .strict(),
      )
      .min(1, 'La lista no puede venir vacía: un rol sin ningún elemento queda sin home.'),
  })
  .strict();
export type GuardarNavegacionInput = z.infer<typeof guardarNavegacionSchema>;

export const restablecerSchema = z.object({ tipo: tipoNavegacionSchema }).strict();
export type RestablecerInput = z.infer<typeof restablecerSchema>;
