import { z } from 'zod';

export const parametrosSucursalSchema = z.object({
  sucursalId: z.coerce.number().int().positive(),
});
export type ParametrosSucursal = z.infer<typeof parametrosSucursalSchema>;

export const parametrosInventarioSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
});
export type ParametrosInventario = z.infer<typeof parametrosInventarioSchema>;

// Sin schema de PUT /ajustes: el endpoint se borró el 2026-09-14 (ver
// liquidacion.ajustes.ts). Los ajustes entran por el Excel de Dynamics.

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
