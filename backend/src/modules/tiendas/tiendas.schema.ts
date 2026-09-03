import { z } from 'zod';

export const parametrosTiendaSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ParametrosTienda = z.infer<typeof parametrosTiendaSchema>;

export const crearTiendaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
  direccion: z.string().trim().min(1).optional(),
  telefono: z.string().trim().min(1).optional(),
});
export type CrearTiendaInput = z.infer<typeof crearTiendaSchema>;

/** Todos los campos opcionales: PATCH parcial, no reemplaza lo que no venga. */
export const actualizarTiendaSchema = z
  .object({
    nombre: z.string().trim().min(1).optional(),
    direccion: z.string().trim().min(1).nullable().optional(),
    telefono: z.string().trim().min(1).nullable().optional(),
    activa: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No mandaste ningun campo para actualizar.' });
export type ActualizarTiendaInput = z.infer<typeof actualizarTiendaSchema>;
