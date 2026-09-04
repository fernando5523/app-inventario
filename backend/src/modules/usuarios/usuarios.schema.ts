import { z } from 'zod';

/** Mismo shape de PIN que sesion.schema.ts#ingresarSchema: 6 digitos exactos. */
const pinSchema = z.string().regex(/^\d{6}$/, 'El PIN debe tener 6 digitos.');

/**
 * DNI: 4 a 8 digitos. El seed actual usa placeholders de 4 (ver
 * prisma/seed.ts) y un DNI peruano real tiene 8 -- se acepta el rango en
 * vez de forzar 8 para no romper el dataset de demo ya validado.
 */
const dniSchema = z.string().regex(/^\d{4,8}$/, 'El DNI debe tener entre 4 y 8 digitos.');

/**
 * El rol lo valida el schema (nunca "cualquier string"), pero CUAL de
 * estos 4 puede usar quien esta pidiendo la accion se decide en
 * usuarios.service.ts (matriz de permisos), no aca: zod solo garantiza
 * forma, nunca autorizacion.
 */
const rolSchema = z.enum(['administrador', 'coordinador', 'conteo', 'auditor']);

export const parametrosUsuarioSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ParametrosUsuario = z.infer<typeof parametrosUsuarioSchema>;

export const listarUsuariosQuerySchema = z.object({
  sucursalId: z.coerce.number().int().positive().optional(),
});
export type ListarUsuariosQuery = z.infer<typeof listarUsuariosQuerySchema>;

/**
 * sucursalId es opcional a nivel de forma porque su obligatoriedad
 * DEPENDE del rol: un administrador es del sistema, no de una tienda, y
 * gestiona las 4 sucursales por rol -- exigirle una sucursalId (real o
 * inventada) para poder crearlo seria forzar un dato falso solo para
 * pasar la validacion. Los otros 3 roles SI la necesitan siempre. La
 * regla vive aca (forma) porque es sobre el request, no sobre quien lo
 * pide -- la matriz de "quien puede crear a quien" sigue en
 * usuarios.service.ts, que es autorizacion, no forma.
 */
export const crearUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
    dni: dniSchema,
    rol: rolSchema,
    sucursalId: z.number().int().positive().optional(),
    pin: pinSchema,
  })
  .superRefine((datos, ctx) => {
    if (datos.rol === 'administrador') {
      if (datos.sucursalId !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['sucursalId'],
          message: 'Un administrador no pertenece a ninguna sucursal: no mandes sucursalId.',
        });
      }
      return;
    }
    if (datos.sucursalId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['sucursalId'], message: 'sucursalId es obligatorio para este rol.' });
    }
  });
export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;

export const editarUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(1, 'El nombre no puede estar vacio.').optional(),
    dni: dniSchema.optional(),
    rol: rolSchema.optional(),
    sucursalId: z.number().int().positive().nullable().optional(),
  })
  .superRefine((datos, ctx) => {
    if (datos.rol === 'administrador') {
      if (datos.sucursalId !== undefined && datos.sucursalId !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['sucursalId'],
          message: 'Un administrador no pertenece a ninguna sucursal: no mandes sucursalId.',
        });
      }
    }
  });
export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>;

export const actualizarEstadoSchema = z.object({
  activo: z.boolean(),
});
export type ActualizarEstadoInput = z.infer<typeof actualizarEstadoSchema>;

export const resetearPinSchema = z.object({
  pin: pinSchema,
});
export type ResetearPinInput = z.infer<typeof resetearPinSchema>;

