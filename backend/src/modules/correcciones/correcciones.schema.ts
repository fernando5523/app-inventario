import { z } from 'zod';

/**
 * El período del que se exporta. Obligatorio: sin él habría que elegir un
 * default -- "el mes en curso" -- y un archivo del mes equivocado se descubre
 * recién al intentar importarlo, cuando las filas rechazadas dicen que esos
 * inventarios no existen.
 *
 * `mes` se valida 1..12 acá: un 13 no es un período vacío, es una URL mal
 * armada, y contestar un archivo sin filas lo haría parecer un mes sin conteos.
 */
export const exportarCorreccionesQuerySchema = z
  .object({
    anio: z.coerce.number().int().min(2000).max(2100),
    mes: z.coerce.number().int().min(1).max(12),
    sucursalId: z.coerce.number().int().positive().optional(),
    /**
     * Default `false`: un filtro por default dejaría filas afuera sin que
     * nadie lo pida, que es la misma falta que ignorar una fila en silencio.
     * La pantalla lo manda en `true` cuando quiere solo lo que no cuadra.
     */
    soloSinCuadrar: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .strict();
export type ExportarCorreccionesQuery = z.infer<typeof exportarCorreccionesQuerySchema>;

/** El nombre del archivo que se está confirmando -- queda en el registro de auditoría del lote. */
export const confirmarCorreccionesQuerySchema = z
  .object({
    nombreArchivo: z.string().trim().min(1, 'Falta el nombre del archivo.').max(255),
  })
  .strict();
export type ConfirmarCorreccionesQuery = z.infer<typeof confirmarCorreccionesQuerySchema>;
