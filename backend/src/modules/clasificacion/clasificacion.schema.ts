import { z } from 'zod';

/**
 * El `codigo` es el ItemNumber de Dynamics (ClasificacionProducto.codigo,
 * @unique) -- la identidad estable de un producto entre periodos. La
 * clasificacion se guarda por codigo, NO por inventario: el Auditor no quiere
 * reclasificar lo mismo cada mes.
 */
export const parametrosCodigoSchema = z.object({
  codigo: z.string().trim().min(1, 'El codigo es obligatorio.'),
});
export type ParametrosCodigo = z.infer<typeof parametrosCodigoSchema>;

/**
 * La busqueda de la pantalla del Auditor sobre el catalogo (~11.800 items).
 * Zod solo valida forma; de donde salen los productos buscables lo decide el
 * service (ver clasificacion.service.ts#buscar).
 */
export const buscarQuerySchema = z.object({
  /** Texto libre: matchea codigo, descripcion o categoria, insensible a mayusculas. */
  q: z.string().trim().min(1).optional(),
  /**
   * `true` => solo los productos que YA tienen clasificacion del Auditor (la
   * "lista que vive de mes a mes"). Ausente/`false` => todo el catalogo.
   * Es un query param (string), por eso el enum + transform y no `z.boolean`:
   * `z.coerce.boolean('false')` daria `true`, que es justo lo contrario.
   */
  soloClasificados: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type BuscarQuery = z.infer<typeof buscarQuerySchema>;

/**
 * Clasificar (o reclasificar) un codigo. `esEmpresa` es la decision del
 * Auditor -- la EXCEPCION a lo que dice Dynamics (el caso de las cervezas:
 * Dynamics las marca del empleado, pero por orden de gerencia las asume la
 * empresa). `nota` es opcional: por que se hizo la excepcion.
 */
export const clasificarSchema = z.object({
  /** `true` = lo asume la EMPRESA (excepcion); `false` = es del EMPLEADO. */
  esEmpresa: z.boolean(),
  nota: z.string().trim().min(1).max(500).optional(),
});
export type ClasificarInput = z.infer<typeof clasificarSchema>;
