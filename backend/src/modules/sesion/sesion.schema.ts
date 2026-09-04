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

/**
 * Cambio de PIN propio. NO lleva colaboradorId: quien cambia el PIN es el
 * de la sesion, y eso sale del token. `.strict()` para que un intento de
 * mandar un id ajeno falle con 400 en vez de ignorarse en silencio --
 * misma regla que la aprobacion del lacrado.
 */
export const cambiarPinSchema = z
  .object({
    pinActual: z.string().regex(/^\d{6}$/, 'El PIN actual debe tener 6 digitos.'),
    pinNuevo: z.string().regex(/^\d{6}$/, 'El PIN nuevo debe tener 6 digitos.'),
  })
  .strict('El cambio de PIN solo acepta pinActual y pinNuevo: quien cambia el PIN sale de la sesion.');
export type CambiarPinInput = z.infer<typeof cambiarPinSchema>;
