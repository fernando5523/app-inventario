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
});
export type CrearSnapshotInput = z.infer<typeof crearSnapshotSchema>;
