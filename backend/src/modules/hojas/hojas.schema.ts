import { z } from 'zod';

/**
 * Rondas del ciclo (prisma/schema.prisma#HojaConteo.numeroConteo): 1er
 * conteo, reconteo y la 3ra de auditoria. El puerto del front todavia no
 * habla de rondas -- trabaja siempre sobre la 1ra -- asi que el parametro es
 * opcional con default 1 en vez de obligatorio: sin eso, `porNumero` del
 * front no podria llamar a este endpoint sin inventar un dato que no tiene.
 */
export const RONDA_POR_DEFECTO = 1;

const ronda = z.coerce.number().int().min(1).max(3).default(RONDA_POR_DEFECTO);

/**
 * `alcance` es lo que separa el conteo ciego de la vista de conjunto:
 *   - `mias` (default): solo las hojas asignadas a quien pide.
 *   - `todas`: el lote entero del inventario. La autorizacion NO esta aca
 *     -- zod valida forma, nunca permisos (mismo criterio que
 *     usuarios.schema.ts) -- la aplica hojas.routes.ts + hojas.permisos.ts.
 *
 * El default es `mias` a proposito: si alguien olvida mandar el parametro,
 * la respuesta segura es la restrictiva, no el lote completo.
 */
export const listarHojasQuerySchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
  alcance: z.enum(['mias', 'todas']).default('mias'),
  ronda,
  /** Filtra por numero de hoja ("002"). Es como el front resuelve `porNumero`. */
  numero: z.string().trim().min(1).optional(),
});
export type ListarHojasQuery = z.infer<typeof listarHojasQuerySchema>;

export const parametrosHojaSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ParametrosHoja = z.infer<typeof parametrosHojaSchema>;

export const parametrosConteoSchema = z.object({
  id: z.coerce.number().int().positive(),
  productoId: z.coerce.number().int().positive(),
});
export type ParametrosConteo = z.infer<typeof parametrosConteoSchema>;

export const parametrosBarrasSchema = z.object({
  id: z.coerce.number().int().positive(),
  codigo: z.string().trim().min(1),
});
export type ParametrosBarras = z.infer<typeof parametrosBarrasSchema>;

/**
 * Una linea del conteo (tipos.ts#LineaEmpaque): "2 Cajas", "3 Packs". Que
 * `empaqueNombre` exista de verdad entre los empaques DEL producto no se
 * valida aca -- zod valida FORMA, no contra el catalogo (mismo criterio que
 * el resto del modulo); lo valida hojas.calculos.ts#totalUnidades, que es
 * quien tiene el producto a mano.
 */
export const lineaEmpaqueSchema = z.object({
  empaqueNombre: z.string().trim().min(1),
  /** 0 es valido: una linea a 0 es como no cargarla, pero no es un error de forma. */
  cantidad: z.number().int().min(0),
});

/**
 * El cuerpo de un conteo. NO tiene `total`, y su ausencia es una decision:
 * el total se calcula (ver hojas.calculos.ts#totalUnidades). Aceptarlo del
 * cliente seria guardar un total al lado de sus partes y garantizar que
 * algun dia no coincidan -- y ese es EL numero que se audita contra el ERP.
 *
 * Tampoco tiene `productoId`: viaja en la URL, que es la identidad del
 * recurso. Si viniera en los dos lados habria que decidir cual gana.
 *
 * `empaques` es una LISTA (antes un entero: un solo empaque por producto).
 * El operario puede cargar "2 cajas + 3 packs + 5 sueltas" para el mismo
 * producto -- ver mobile/lib/dominio/tipos.ts#Conteo.empaques, misma forma.
 */
export const guardarConteoSchema = z.object({
  empaques: z
    .array(lineaEmpaqueSchema)
    .default([])
    .refine((lineas) => new Set(lineas.map((l) => l.empaqueNombre)).size === lineas.length, {
      message: 'No se puede repetir el mismo empaque dos veces en el mismo conteo.',
    }),
  sueltas: z.number().int().min(0),
  confirmadoPorEscaner: z.boolean().default(false),
  /**
   * Cuando lo conto el operario EN EL TELEFONO, no cuando llego al servidor.
   * Son cosas distintas y la diferencia puede ser de horas: la cola de
   * sincronizacion manda esto recien cuando vuelve el WiFi. Usar la hora del
   * servidor perderia el dato real de cuando se conto.
   */
  contadoEn: z.coerce.date(),
});
export type GuardarConteoInput = z.infer<typeof guardarConteoSchema>;
