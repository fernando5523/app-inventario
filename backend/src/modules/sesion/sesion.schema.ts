import { z } from 'zod';

export const parametrosSucursalSchema = z.object({
  sucursalId: z.coerce.number().int().positive(),
});
export type ParametrosSucursal = z.infer<typeof parametrosSucursalSchema>;

/** RepositorioSesion.ingresar(colaboradorId, pin) -- PIN de 6 digitos. */
export const ingresarSchema = z.object({
  colaboradorId: z.number().int().positive(),
  pin: z.string().regex(/^\d{6}$/, 'El PIN debe tener 6 digitos.'),
});
export type IngresarInput = z.infer<typeof ingresarSchema>;
