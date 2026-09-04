import { z } from 'zod';

export const parametrosTiendaSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ParametrosTienda = z.infer<typeof parametrosTiendaSchema>;

/**
 * Codigo de almacen de Dynamics (`WarehouseId`, ej. "MD11_CENT").
 *
 * El formato se valida, pero la validacion de forma NO alcanza y por eso el
 * service ademas lo verifica contra la lista real del ERP: "MD11_CENT" y
 * "MD11_CNET" tienen los dos la forma correcta, y el segundo traeria el
 * stock de otra tienda -- o de ninguna -- sin que nadie se entere hasta que
 * el inventario no cuadre a fin de mes.
 */
const almacenIdSchema = z
  .string()
  .trim()
  .min(1, 'El codigo de almacen no puede estar vacio.')
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/, 'El codigo de almacen solo lleva letras, numeros, guion y guion bajo.');

export const crearTiendaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
  direccion: z.string().trim().min(1).optional(),
  telefono: z.string().trim().min(1).optional(),
  /**
   * Opcional: una tienda se puede dar de alta antes de que alguien averigue
   * su almacen en Dynamics. Sin el no se puede traer snapshot, y eso se
   * rechaza al traerlo -- ver el comentario de Sucursal.almacenId.
   */
  almacenId: almacenIdSchema.optional(),
});
export type CrearTiendaInput = z.infer<typeof crearTiendaSchema>;

/** Todos los campos opcionales: PATCH parcial, no reemplaza lo que no venga. */
export const actualizarTiendaSchema = z
  .object({
    nombre: z.string().trim().min(1).optional(),
    direccion: z.string().trim().min(1).nullable().optional(),
    telefono: z.string().trim().min(1).nullable().optional(),
    activa: z.boolean().optional(),
    /**
     * `null` DESASOCIA el almacen (la tienda deja de poder traer stock);
     * un codigo lo cambia. Que se pueda desasociar es a proposito: si
     * alguien detecta que estaba mal configurado, dejarlo en null es mejor
     * que dejar uno equivocado -- el primero falla ruidosamente al pedir el
     * snapshot, el segundo trae numeros de otra tienda en silencio.
     */
    almacenId: almacenIdSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No mandaste ningun campo para actualizar.' });
export type ActualizarTiendaInput = z.infer<typeof actualizarTiendaSchema>;
