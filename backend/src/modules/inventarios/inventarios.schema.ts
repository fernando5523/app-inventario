import { z } from 'zod';
import { corregirConteoSchema, RONDA_MAXIMA_ACEPTADA } from '../hojas/hojas.schema';

/**
 * Los tamaños de hoja que el sistema ofrece. Espeja
 * `mobile/lib/dominio/tipos.ts#TAMANOS_HOJA` -- el Coordinador elige entre
 * estos tres en la pantalla, y aceptar otro por HTTP significaria que la app
 * y el servidor no coinciden sobre que es un inventario valido.
 *
 * Salieron de la reunion con el cliente: 20, 30 o 50 items por hoja.
 */
export const TAMANOS_HOJA = [20, 30, 50] as const;

export const parametrosInventarioSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
});
export type ParametrosInventario = z.infer<typeof parametrosInventarioSchema>;

export const parametrosSucursalSchema = z.object({
  sucursalId: z.coerce.number().int().positive(),
});
export type ParametrosSucursal = z.infer<typeof parametrosSucursalSchema>;

export const crearHojasSchema = z
  .object({
    /**
     * `z.literal` en vez de un rango: 37 no es "un tamaño raro pero
     * aceptable", es un error. Si algun dia el cliente pide otro tamaño, se
     * agrega ACA y a TAMANOS_HOJA del movil, juntos.
     */
    tamano: z.union([z.literal(20), z.literal(30), z.literal(50)], {
      errorMap: () => ({ message: `El tamaño de hoja tiene que ser ${TAMANOS_HOJA.join(', ')}.` }),
    }),
  })
  .strict();
export type CrearHojasInput = z.infer<typeof crearHojasSchema>;

export const asignarHojasSchema = z
  .object({
    /**
     * Los presentes entre los que se reparte. Se piden ids y no nombres: dos
     * personas pueden llamarse igual, y una hoja asignada a la persona
     * equivocada es una gondola que nadie cuenta.
     */
    colaboradorIds: z.array(z.number().int().positive()).min(1, 'Elige al menos una persona.'),
  })
  .strict();
export type AsignarHojasInput = z.infer<typeof asignarHojasSchema>;

/**
 * LA RONDA EN LA URL, SIN TECHO EN 3.
 *
 * Esto valia `.max(3)` y el comentario decia que un `ronda=7` era "un error
 * de quien llama, no una ronda que todavia no existe". ESO YA NO ES CIERTO:
 * el cliente pidio que el Auditor pueda abrir un 4to y un 5to conteo cuando
 * haga falta, inventario por inventario, asi que una ronda 7 puede existir
 * perfectamente y el schema no puede seguir siendo quien decide que no.
 *
 * Quien decide ahora es la BASE: el service pregunta si esa ronda tiene hojas
 * y responde 404 si no. El techo que queda (`RONDA_MAXIMA_ACEPTADA`) es de
 * forma y esta explicado en hojas.schema.ts, que es el modulo dueno de
 * `HojaConteo.numeroConteo`.
 */
export const parametrosRondaSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
  ronda: z.coerce.number().int().min(1).max(RONDA_MAXIMA_ACEPTADA),
});
export type ParametrosRonda = z.infer<typeof parametrosRondaSchema>;

/**
 * `/:inventarioId/ajuste/:productoId` -- el producto que el Auditor ajusta.
 *
 * El `productoId` es de la ULTIMA ronda, que es la que el ajuste corrige. Que
 * pertenezca de verdad a ese inventario y a esa ronda no se valida aca (zod
 * no conoce la base): lo valida el service, que tiene el dato a mano.
 */
export const parametrosAjusteSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
  productoId: z.coerce.number().int().positive(),
});
export type ParametrosAjuste = z.infer<typeof parametrosAjusteSchema>;

/**
 * El cuerpo del ajuste final del Auditor: EL MISMO que el de la correccion
 * del Coordinador (`hojas.schema.ts#corregirConteoSchema`).
 *
 * Se reexporta en vez de redeclararse porque son la misma operacion vista
 * desde dos roles -- reemplazar un conteo dejando dicho por que. Dos schemas
 * gemelos serian dos lugares donde agregar un campo, y el dia que uno se
 * quede atras el Auditor y el Coordinador empezarian a mandar cosas
 * distintas por endpoints que escriben la misma tabla.
 *
 * Lo que NO comparten es quien puede llamarlos ni cuando: eso vive en
 * `ajuste.permisos.ts`, que es donde se lee la ventana de cada rol.
 */
export const ajustarConteoSchema = corregirConteoSchema;
export type AjustarConteoInput = z.infer<typeof ajustarConteoSchema>;
