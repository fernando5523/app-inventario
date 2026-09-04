import { z } from 'zod';

/**
 * Las claves conocidas hoy (ver prisma/schema.prisma#Configuracion para
 * la justificacion de por que es clave-valor). Agregar una clave nueva es
 * sumarla aca + al validador en config.validadores.ts -- nunca una migracion.
 */
export const CLAVES_CONFIGURACION = [
  'TAMANO_HOJA_DEFECTO',
  'CANTIDAD_CONTEOS_CICLO',
  'UMBRAL_MEDIA_UNIDAD_PAQUETE',
  /** Que almacenes de Dynamics entran al inventario -- ver d365.almacenes-inventario.ts. */
  'ALMACENES_INVENTARIO',
] as const;
export type ClaveConfiguracion = (typeof CLAVES_CONFIGURACION)[number];

export const parametrosConfigSchema = z.object({
  clave: z.enum(CLAVES_CONFIGURACION),
});
export type ParametrosConfig = z.infer<typeof parametrosConfigSchema>;

/**
 * La forma final (entero vs decimal, rangos validos) depende de CUAL
 * clave es -- eso se valida en config.service.ts, no aca: zod solo saca
 * de encima el caso "ni siquiera es string o numero".
 */
export const actualizarConfigSchema = z.object({
  valor: z.union([z.string(), z.number()]),
});
export type ActualizarConfigInput = z.infer<typeof actualizarConfigSchema>;
