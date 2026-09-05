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
 * Los ajustes del mes. Ver liquidacion.ajustes.ts para por qué un `0`
 * explícito acá vale y el NULL de la base no.
 */
export const registrarAjustesSchema = z.object({
  /**
   * `>= 0` y NO `> 0`: el cero es el caso que importa -- "alguien miró y no
   * había ajustes este mes" es exactamente lo que destraba la liquidación, y
   * rechazarlo obligaría a inventar un centavo para poder cerrar el mes.
   *
   * Sin tope superior a propósito: un ajuste grande es raro, no inválido, y
   * un límite inventado acá bloquearía un mes real sin que nadie sepa por qué.
   */
  montoNegativos: z.number().nonnegative('Los ajustes no pueden ser negativos.'),
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
