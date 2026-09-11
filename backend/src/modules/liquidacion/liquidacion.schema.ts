import { z } from 'zod';

export const parametrosSucursalSchema = z.object({
  sucursalId: z.coerce.number().int().positive(),
});
export type ParametrosSucursal = z.infer<typeof parametrosSucursalSchema>;

export const parametrosInventarioSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
});
export type ParametrosInventario = z.infer<typeof parametrosInventarioSchema>;

/**
 * Los ajustes del mes que siguen siendo manuales: el monto de empresa y la
 * nota. `montoNegativos` ya NO se carga por acá -- lo reemplaza la
 * importación del Excel de Dynamics (liquidacion.ajustes-negativos.ts,
 * liquidacion.schema.ts#previsualizarAjustesNegativosQuerySchema más abajo).
 */
export const registrarAjustesSchema = z.object({
  /** Opcional: si no viene, se conserva el calculado al cerrar el conteo. */
  montoEmpresa: z.number().nonnegative('El monto de empresa no puede ser negativo.').optional(),
  /**
   * OBLIGATORIA. Un ajuste sin explicación es un número que nadie puede
   * auditar después -- y este número baja lo que se le descuenta a once
   * personas.
   */
  nota: z.string().trim().min(1, 'Contá de dónde salen estos ajustes: sin nota no se puede auditar después.').max(500),
});
export type RegistrarAjustesInput = z.infer<typeof registrarAjustesSchema>;

/** El nombre del archivo Excel que se está confirmando -- para dejarlo en `ImportacionAjustesDynamics.nombreArchivo`. */
export const confirmarAjustesNegativosQuerySchema = z.object({
  nombreArchivo: z.string().trim().min(1, 'Falta el nombre del archivo.').max(255),
});
export type ConfirmarAjustesNegativosQuery = z.infer<typeof confirmarAjustesNegativosQuerySchema>;

export const parametrosLineaAjusteSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
  lineaId: z.coerce.number().int().positive(),
});
export type ParametrosLineaAjuste = z.infer<typeof parametrosLineaAjusteSchema>;

export const motivoLineaAjusteSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(1, 'Contá por qué se excluye o se vuelve a incluir esta línea: sin motivo no se puede auditar después.')
    .max(500),
});
export type MotivoLineaAjusteInput = z.infer<typeof motivoLineaAjusteSchema>;
