import { z } from 'zod';

/**
 * Los tamaños de hoja que el sistema ofrece. Espeja
 * `mobile/lib/dominio/tipos.ts#TAMANOS_HOJA` -- el Coordinador elige entre
 * estos tres en la pantalla, y aceptar otro por HTTP significaria que la app
 * y el servidor no coinciden sobre que es un inventario valido.
 *
 * Salieron de la reunion con el cliente: 20, 30 o 50 items por hoja.
 */
export const TAMANOS_HOJA = [20, 30, 50] as const;

export const parametrosInventarioSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
});
export type ParametrosInventario = z.infer<typeof parametrosInventarioSchema>;

export const parametrosSucursalSchema = z.object({
  sucursalId: z.coerce.number().int().positive(),
});
export type ParametrosSucursal = z.infer<typeof parametrosSucursalSchema>;

export const crearHojasSchema = z
  .object({
    /**
     * `z.literal` en vez de un rango: 37 no es "un tamaño raro pero
     * aceptable", es un error. Si algun dia el cliente pide otro tamaño, se
     * agrega ACA y a TAMANOS_HOJA del movil, juntos.
     */
    tamano: z.union([z.literal(20), z.literal(30), z.literal(50)], {
      errorMap: () => ({ message: `El tamaño de hoja tiene que ser ${TAMANOS_HOJA.join(', ')}.` }),
    }),
  })
  .strict();
export type CrearHojasInput = z.infer<typeof crearHojasSchema>;

export const asignarHojasSchema = z
  .object({
    /**
     * Los presentes entre los que se reparte. Se piden ids y no nombres: dos
     * personas pueden llamarse igual, y una hoja asignada a la persona
     * equivocada es una gondola que nadie cuenta.
     */
    colaboradorIds: z.array(z.number().int().positive()).min(1, 'Elegí al menos una persona.'),
  })
  .strict();
export type AsignarHojasInput = z.infer<typeof asignarHojasSchema>;
