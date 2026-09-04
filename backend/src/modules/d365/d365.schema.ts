import { z } from 'zod';

export const crearSnapshotSchema = z.object({
  sucursalId: z.number().int().positive(),
  /**
   * 'ejemplo' nunca toca red ni exige credenciales -- existe para que el
   * paso 1 del Coordinador se pueda probar hoy, sin credenciales reales de
   * Dynamics (ver backend/README.md). Default 'real': nunca se sustituye
   * datos reales por de ejemplo en silencio, hay que pedirlo explicito.
   */
  modo: z.enum(['real', 'ejemplo']).optional().default('real'),
  /**
   * QUE UNIVERSO se cuenta. Decision del cliente (reunion): hay DOS tipos de
   * inventario con universos distintos.
   *
   *   'mensual' -> SOLO productos de responsabilidad del EMPLEADO. Los que
   *                asume la empresa quedan fuera: no se cuentan.
   *   'anual'   -> TODO el catalogo activo, empresa incluida ("en el anual
   *                ya cuentan todo").
   *
   * Default 'mensual' a proposito: es el que se hace todos los meses. El
   * anual es la excepcion y hay que pedirlo explicito -- que alguien cuente
   * 11.835 items creyendo que cuenta 6.297 es una jornada perdida.
   */
  tipo: z.enum(['mensual', 'anual']).optional().default('mensual'),
});
export type CrearSnapshotInput = z.infer<typeof crearSnapshotSchema>;
