import { z } from 'zod';

/** Los 5 estados de prisma/schema.prisma#EstadoInventario. */
export const ESTADOS_INVENTARIO = ['en_curso', 'conteo_cerrado', 'liquidado', 'lacrado', 'anulado'] as const;

export const parametrosInventarioSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ParametrosInventario = z.infer<typeof parametrosInventarioSchema>;

/**
 * `sucursalId` es opcional aca: para un administrador es un filtro, para un
 * auditor se ignora porque su alcance ya sale del token
 * (historial.permisos.ts#resolverSucursalConsultable). Zod define forma, no
 * autorizacion -- misma division que en usuarios.schema.ts.
 */
export const listarInventariosQuerySchema = z.object({
  sucursalId: z.coerce.number().int().positive().optional(),
  estado: z.enum(ESTADOS_INVENTARIO).optional(),
  periodoAnio: z.coerce.number().int().min(2000).max(2100).optional(),
  periodoMes: z.coerce.number().int().min(1).max(12).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(24),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type ListarInventariosQuery = z.infer<typeof listarInventariosQuerySchema>;

/**
 * Las diferencias de un inventario se paginan siempre: son hasta 8.000
 * items y devolverlas enteras en un JSON es como el sistema se cae el dia
 * que alguien abre el detalle de un mes malo desde el celular.
 */
export const listarDiferenciasQuerySchema = z.object({
  /** "faltante" = diferencia < 0, "sobrante" = diferencia > 0. */
  tipo: z.enum(['faltante', 'sobrante']).optional(),
  /** Filtra por la ronda en la que quedo resuelto (1, 2 o 3). */
  resueltoEnConteo: z.coerce.number().int().min(1).max(3).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type ListarDiferenciasQuery = z.infer<typeof listarDiferenciasQuerySchema>;

export const parametrosItemSchema = z.object({
  /** ItemNumber de Dynamics -- la identidad estable del articulo entre meses. */
  codigo: z.string().trim().min(1, 'El codigo del item es obligatorio.').max(64),
});
export type ParametrosItem = z.infer<typeof parametrosItemSchema>;

export const historicoItemQuerySchema = z.object({
  sucursalId: z.coerce.number().int().positive().optional(),
  desdeAnio: z.coerce.number().int().min(2000).max(2100).optional(),
  hastaAnio: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type HistoricoItemQuery = z.infer<typeof historicoItemQuerySchema>;

export const comparativoQuerySchema = z
  .object({
    sucursalId: z.coerce.number().int().positive().optional(),
    desdeAnio: z.coerce.number().int().min(2000).max(2100).optional(),
    hastaAnio: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.desdeAnio !== undefined && q.hastaAnio !== undefined && q.desdeAnio > q.hastaAnio) {
      ctx.addIssue({ code: 'custom', path: ['desdeAnio'], message: 'desdeAnio no puede ser posterior a hastaAnio.' });
    }
  });
export type ComparativoQuery = z.infer<typeof comparativoQuerySchema>;

// ---------------------------------------------------------------------------
// Escritura: aprobacion y lacrado
// ---------------------------------------------------------------------------

/**
 * EL BODY DE UNA APROBACION NO LLEVA IDENTIDAD. A proposito, y es el punto
 * central del control de dos personas.
 *
 * Quien aprueba sale SIEMPRE de `req.colaborador` -- el colaborador de la
 * sesion, que auth.middleware.ts resuelve desde el token verificado contra
 * la base. Nunca de un campo del request. Es la misma regla que ya gobierna
 * el rol en todo el proyecto: lo que manda el cliente no define quien es.
 *
 * `.strict()` no es decorativo: hace que un body con `aprobadorId` falle con
 * 400 en vez de que el campo se ignore en silencio. La diferencia importa --
 * un cliente que intenta firmar por otro tiene que enterarse de que no
 * funciono, no quedarse creyendo que si. Y si la app movil todavia manda ese
 * campo (hoy lo hace: muestra los dos botones a la vez), el 400 es
 * exactamente la senal que necesita para corregirse, no un error silencioso
 * que aparece recien cuando alguien audita el mes.
 */
export const aprobarCierreSchema = z
  .object({
    /** Observacion opcional de quien firma ("aprobado con reserva por X"). */
    nota: z.string().trim().min(1).max(500).optional(),
  })
  .strict('El body de una aprobacion solo acepta "nota": quien aprueba sale de la sesion, nunca del request.');
export type AprobarCierreInput = z.infer<typeof aprobarCierreSchema>;

/**
 * El lacrado tampoco lleva identidad ni contenido: QUE se sella lo arma el
 * backend leyendo el inventario (historial.lacrado.ts#armarContenidoLacrado)
 * y quien lo ejecuta sale de la sesion. Aceptar el contenido del cliente
 * seria dejar que el sellado declare lo que quiera haber sellado.
 */
export const lacrarSchema = z
  .object({})
  .strict('El lacrado no acepta body: el contenido lo arma el backend y quien lacra sale de la sesion.');
export type LacrarInput = z.infer<typeof lacrarSchema>;

/**
 * Marcar el registro manual en Dynamics (FASE 2, decision del cliente): el
 * backend no escribe a Dynamics, TI carga el ajuste a mano y alguien deja
 * constancia aca. `referencia` es el numero de asiento/diario del ERP, para
 * poder rastrearlo desde el historico.
 */
export const registrarEnErpSchema = z
  .object({
    referencia: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type RegistrarEnErpInput = z.infer<typeof registrarEnErpSchema>;
