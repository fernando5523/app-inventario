import { z } from 'zod';

/**
 * Espeja mobile/lib/puertos/repositorios.ts#DatosConfigDynamics.
 *
 * `clientSecret` es OPCIONAL a proposito, y no es una laxitud: sin el,
 * `guardar` actualiza tenant/clientId/urlBase y deja el secreto ya guardado
 * tal cual. Asi se puede corregir un tenant mal tipeado sin obligar a nadie
 * a ir a buscar el secreto entero a Azure otra vez -- y sin ese detalle, la
 * gente termina pegando el secreto en un chat para tenerlo a mano.
 *
 * `.strict()` para que un campo mal escrito (`client_secret` en vez de
 * `clientSecret`) falle con 400 en vez de guardarse en silencio como si no
 * hubiera venido. Con un secreto, "se ignoro y no te avisamos" es la peor
 * respuesta posible: la pantalla diria que guardo y Azure seguiria
 * rechazando.
 */
export const guardarConfigDynamicsSchema = z
  .object({
    /** GUID del tenant de Azure AD. */
    tenantId: z.string().trim().min(1, 'El tenant de Azure es obligatorio.').max(200),
    clientId: z.string().trim().min(1, 'El client id es obligatorio.').max(200),
    /** Sin barra final: d365Config le agrega "/data" al armar la URL OData. */
    urlBase: z
      .string()
      .trim()
      .min(1, 'La URL de Dynamics es obligatoria.')
      .max(500)
      .refine((u) => /^https:\/\//i.test(u), 'La URL de Dynamics tiene que empezar con https:// -- un secreto no viaja por http.')
      .transform((u) => u.replace(/\/+$/, '')),
    /** "trv" para Market Trujillo. Si no viene, se usa el del entorno. */
    dataAreaId: z.string().trim().max(20).optional(),
    clientSecret: z.string().min(1, 'Si mandás el secreto, que no venga vacío.').max(500).optional(),
  })
  .strict();
export type GuardarConfigDynamicsInput = z.infer<typeof guardarConfigDynamicsSchema>;
