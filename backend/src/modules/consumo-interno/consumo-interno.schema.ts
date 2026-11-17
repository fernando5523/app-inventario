import { z } from 'zod';

/** Numero de solicitud de Dynamics (ej. SCI-000031). */
const idSolicitud = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/, 'El numero de solicitud solo lleva letras, numeros y guion.');

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD.');

export const parametrosSolicitudSchema = z.object({ id: idSolicitud });
export type ParametrosSolicitud = z.infer<typeof parametrosSolicitudSchema>;

export const parametrosLineaSchema = z.object({
  id: idSolicitud,
  linea: z.coerce.number().positive(),
});
export type ParametrosLinea = z.infer<typeof parametrosLineaSchema>;

export const decisionSchema = z.object({
  aprobar: z.boolean(),
  comentario: z.string().trim().max(200, 'El comentario no puede pasar de 200 caracteres.').optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

export const historialSchema = z
  .object({
    desde: fechaIso.optional(),
    hasta: fechaIso.optional(),
    almacen: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9_-]*$/)
      .optional(),
    estado: z.enum(['registrada', 'rechazada', 'error-registro']).optional(),
    texto: z.string().trim().max(60).optional(),
  })
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, { message: 'La fecha "desde" no puede ser posterior a "hasta".' });
export type HistorialInput = z.infer<typeof historialSchema>;
