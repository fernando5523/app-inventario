import { z } from 'zod';
import { FILTROS_AUDITORIA } from './auditoria.calculos';

export const parametrosInventarioSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
});
export type ParametrosInventario = z.infer<typeof parametrosInventarioSchema>;

/**
 * `filtro` tiene default `todos` para que la pantalla no tenga que mandarlo
 * en la primera carga -- son los mismos 4 chips que ya valido el cliente en
 * mobile/design/auditoria.html.
 *
 * `limite` tiene techo 500 y no es un numero al azar: el inventario real
 * son 8.000 items y devolverlos enteros en un JSON es como se cuelga la
 * pantalla del Auditor en el celular de la tienda. El resumen, en cambio,
 * SIEMPRE se calcula sobre el total -- un resumen que cambia al pasar de
 * pagina no es un resumen (ver auditoria.service.ts).
 */
export const matrizQuerySchema = z.object({
  filtro: z.enum(FILTROS_AUDITORIA).default('todos'),
  /** Busca por codigo o descripcion, sin distinguir mayusculas. */
  busqueda: z.string().trim().min(1).max(120).optional(),
  zona: z.string().trim().min(1).max(60).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type MatrizQuery = z.infer<typeof matrizQuerySchema>;

export const listarAuditablesQuerySchema = z.object({
  sucursalId: z.coerce.number().int().positive().optional(),
});
export type ListarAuditablesQuery = z.infer<typeof listarAuditablesQuerySchema>;

/**
 * El periodo de la tabla de la cadena. Los DOS opcionales: sin ellos se usa el
 * periodo en curso, que es el caso normal -- el Auditor entra a ver el mes que
 * esta corriendo, no a elegirlo.
 *
 * `mes` se valida 1..12 acá y no en el service: un 13 no es un periodo vacio,
 * es una URL mal armada, y contestar una tabla en cero lo haria parecer un mes
 * sin inventarios. El anio tiene piso 2000 por lo mismo -- `?anio=20` es un
 * dedo, no una consulta.
 */
export const cadenaQuerySchema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
});
export type CadenaQuery = z.infer<typeof cadenaQuerySchema>;
