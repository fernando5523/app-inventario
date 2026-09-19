import { z } from 'zod';

/**
 * Rondas del ciclo (prisma/schema.prisma#HojaConteo.numeroConteo): 1er
 * conteo, reconteo y la 3ra de auditoria. El puerto del front todavia no
 * habla de rondas -- trabaja siempre sobre la 1ra -- asi que el parametro es
 * opcional con default 1 en vez de obligatorio: sin eso, `porNumero` del
 * front no podria llamar a este endpoint sin inventar un dato que no tiene.
 */
export const RONDA_POR_DEFECTO = 1;

/**
 * TOPE DE FORMA de `HojaConteo.numeroConteo`, no regla de negocio.
 *
 * Esto valia 3 -- las rondas del ciclo -- y dejo de servir: el cliente pidio
 * que el Auditor pueda abrir un 4to y un 5to conteo cuando haga falta. Con el
 * techo en 3, pedir las hojas de la ronda 4 devolvia 400 y la pantalla no
 * podia ni listarlas.
 *
 * El techo que queda existe por una razon mecanica, no de negocio:
 * `rondas.service.ts#cerrar` calcula `ronda + 1` y `numeroConteo` es un `Int`
 * de Postgres, asi que un `ronda=2147483647` desborda al sumarle uno. 99 es
 * donde deja de haber diferencia entre "muchas rondas" y "alguien escribio
 * cualquier cosa".
 *
 * QUIEN decide si la ronda existe es la base, no este schema: el service
 * pregunta si tiene hojas y responde 404 si no. Zod valida FORMA, nunca
 * existencia -- mismo criterio que `empaqueNombre` mas abajo.
 */
export const RONDA_MAXIMA_ACEPTADA = 99;

const ronda = z.coerce.number().int().min(1).max(RONDA_MAXIMA_ACEPTADA).default(RONDA_POR_DEFECTO);

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

/**
 * EL MOTIVO DE UNA CORRECCION, obligatorio en las tres (la del Coordinador
 * sobre un conteo y la del Auditor en el ajuste final).
 *
 * Es obligatorio porque estos numeros descuentan plata del sueldo de la gente
 * y quedan sellados en el lacrado: un cambio sin motivo es un descuento que
 * nadie puede explicar seis meses despues, cuando la persona reclama. El
 * `registrarAuditoria` guarda quien, que, antes y despues; el motivo es la
 * unica parte que el sistema NO puede deducir solo.
 *
 * El minimo son 3 caracteres y NO es un control de calidad -- nadie puede
 * validar que "mal" sea un motivo mejor que "x". Es un piso contra el campo
 * apretado sin querer: con `.min(1)`, un "." pasa, y un punto en la columna
 * "motivo" de una auditoria es peor que un hueco, porque parece que alguien
 * contesto. El tope de 200 es para que entre en una celda del reporte.
 */
export const motivoDeCorreccionSchema = z
  .string()
  .trim()
  .min(3, 'Escribe el motivo de la correccion: por que cambia este valor.')
  .max(200);

/**
 * El cuerpo de una correccion: el valor NUEVO completo, mas el motivo.
 *
 * Es el valor entero y no un delta, igual que `guardarConteoSchema`: la
 * correccion REEMPLAZA (decision del cliente). Mandar "sumale 2" obligaria a
 * las dos puntas a coincidir sobre cual era el valor de partida, y ese es
 * justo el dato que esta en discusion cuando alguien corrige.
 *
 * NO lleva `contadoEn` ni `confirmadoPorEscaner`, a diferencia de
 * `guardarConteoSchema`, y en los dos casos es a proposito:
 *
 *  - `contadoEn` es CUANDO se conto en la gondola. Corregir no cambia eso, y
 *    pisarlo borraria el unico rastro de cuando se hizo la pasada real. La
 *    hora de la correccion queda en el registro de auditoria, que es donde
 *    corresponde.
 *  - `confirmadoPorEscaner` afirma que el fisico coincide con la linea porque
 *    alguien escaneo el codigo (schema.prisma#Conteo). Quien corrige esta
 *    tecleando un numero, no escaneando: el service lo baja a false. Dejarlo
 *    en true seria firmar con el escaner un valor que el escaner nunca vio.
 */
export const corregirConteoSchema = z
  .object({
    empaques: z
      .array(lineaEmpaqueSchema)
      .default([])
      .refine((lineas) => new Set(lineas.map((l) => l.empaqueNombre)).size === lineas.length, {
        message: 'No se puede repetir el mismo empaque dos veces en el mismo conteo.',
      }),
    sueltas: z.number().int().min(0),
    motivo: motivoDeCorreccionSchema,
  })
  .strict();
export type CorregirConteoInput = z.infer<typeof corregirConteoSchema>;
