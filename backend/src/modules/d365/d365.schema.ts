import { z } from 'zod';

import { RONDA_MAXIMA_ACEPTADA } from '../hojas/hojas.schema';

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
  /**
   * OVERRIDE del almacen, y solo eso: el camino normal es NO mandarlo.
   *
   * El almacen ahora vive en la sucursal (`Sucursal.almacenId`), por
   * decision del cliente -- "al crear el sitio, se debe asociar el almacen".
   * Mandarlo aca sirve para probar otro almacen sin reconfigurar la tienda;
   * si no viene, sale de la sucursal, que es de donde tiene que salir.
   *
   * Un almacen que se tipea en cada llamada es un almacen que alguna vez se
   * va a tipear mal, y traer el stock de OTRA tienda no falla: devuelve
   * numeros que parecen validos y nadie se entera hasta fin de mes.
   */
  almacen: z.string().trim().min(1).max(30).optional(),
});
export type CrearSnapshotInput = z.infer<typeof crearSnapshotSchema>;

/** Query de `GET /api/d365/snapshot/progreso`. */
export const progresoSnapshotQuerySchema = z.object({
  sucursalId: z.coerce.number().int().positive(),
});
export type ProgresoSnapshotQuery = z.infer<typeof progresoSnapshotQuerySchema>;

/**
 * Params de `/api/inventarios/:inventarioId/rondas/:numeroConteo/stock`.
 *
 * `numeroConteo` y no `ronda` como en `inventarios.schema.ts`: en ESTA ruta el
 * numero viaja para escribir `StockRonda.numeroConteo`, y que el parametro de
 * la URL se llame igual que la columna es lo que hace que no haya que traducir
 * nada en el medio. Las rutas del ciclo (`/rondas/:ronda/cerrar`) siguen con su
 * nombre; son dos routers distintos y ninguno lee los params del otro.
 *
 * EL TECHO NO ES 3. El Auditor puede abrir una 4ta y una 5ta pasada (decision
 * del cliente, 2026-09-19), asi que quien decide si esa ronda existe es la
 * BASE, no el schema: el service mira `Inventario.ultimaRondaCerrada` y
 * responde 409 si la anterior no cerro. `RONDA_MAXIMA_ACEPTADA` se reusa de
 * `hojas.schema.ts` -- el modulo dueno de `HojaConteo.numeroConteo` -- para no
 * tener dos techos de forma que algun dia difieran.
 *
 * El minimo es 1 y no 2, aunque la ronda 1 se rechace: el rechazo tiene que
 * salir del service con su explicacion ("el stock del primer conteo lo trae el
 * snapshot"), no como un error de validacion que diria "tiene que ser >= 2" sin
 * decir a donde ir.
 */
export const parametrosStockRondaSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
  numeroConteo: z.coerce.number().int().min(1).max(RONDA_MAXIMA_ACEPTADA),
});
export type ParametrosStockRonda = z.infer<typeof parametrosStockRondaSchema>;
