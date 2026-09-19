import { z } from 'zod';

export const parametrosInventarioSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
});
export type ParametrosInventario = z.infer<typeof parametrosInventarioSchema>;

/** `/:inventarioId/asistencia/:colaboradorId` -- la marca que se borra. */
export const parametrosMarcaSchema = z.object({
  inventarioId: z.coerce.number().int().positive(),
  colaboradorId: z.coerce.number().int().positive(),
});
export type ParametrosMarca = z.infer<typeof parametrosMarcaSchema>;

/**
 * EL DÍA DE LA JORNADA, `YYYY-MM-DD`.
 *
 * La forma NO alcanza, y por eso además se verifica que la fecha EXISTA de
 * verdad (`refine`). `2026-02-31` pasa cualquier regex y JavaScript no lo
 * rechaza: `new Date('2026-02-31T00:00:00Z')` devuelve **3 de marzo**, sin
 * error y sin aviso. Guardar eso no sería un dato raro en una columna, sería
 * un día INVENTADO en el inventario.
 *
 * Y un día inventado se cobra. La duración del inventario son los días
 * DISTINTOS con al menos una marca (`dominio/asistencia.ts#diasDelInventario`)
 * y la multa es `(días del inventario − días asistidos) × tarifa`: un día de
 * más en la lista le suma una tarifa de multa a TODOS los que no lo tengan
 * marcado -- que son todos, porque ese día nunca existió. Un dedo al teclear
 * termina en el sueldo de once personas.
 */
export const diaSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'El día va en formato AAAA-MM-DD.')
  .refine((dia) => aDia(aFechaUtc(dia)) === dia, 'Ese día no existe en el calendario.');

export const marcarAsistenciaSchema = z
  .object({
    /**
     * Se pide el id y no el nombre, por lo mismo que al repartir las hojas
     * (`inventarios.schema.ts#asignarHojasSchema`): dos personas se pueden
     * llamar igual, y acá una marca puesta a la persona equivocada es una
     * multa cobrada a quien sí vino.
     */
    colaboradorId: z.number().int().positive(),
    dia: diaSchema,
  })
  .strict();
export type MarcarAsistenciaInput = z.infer<typeof marcarAsistenciaSchema>;

/** El día viaja en la query del DELETE: se borra UNA marca, no la persona entera. */
export const borrarMarcaQuerySchema = z.object({ dia: diaSchema });
export type BorrarMarcaQuery = z.infer<typeof borrarMarcaQuerySchema>;

/**
 * EL MOTIVO DE UNA JUSTIFICACIÓN. OBLIGATORIO, y con un mínimo real.
 *
 * Perdonar una falta mueve plata en dos direcciones a la vez: le baja la
 * multa a esa persona y le cambia el bono a TODAS las demás (el fondo se
 * reparte entre otra cantidad de gente). Seis meses después, cuando alguien
 * pregunte por qué a Delia no le descontaron nada, la respuesta tiene que
 * estar en esta columna.
 *
 * El mínimo de 3 caracteres no pretende evaluar la calidad del motivo -- eso
 * no lo puede hacer un schema -- sino frenar el `"."` o el `"x"` que sirven
 * sólo para saltear el campo. Es el mismo criterio del `nota` obligatorio de
 * los ajustes del mes: un texto corto igual explica ("gripe"), uno vacío no.
 */
export const motivoJustificacionSchema = z
  .string()
  .trim()
  .min(3, 'El motivo tiene que decir por qué se justifica la falta.')
  // El tope es para que no entre un archivo entero en una columna de texto,
  // no una restricción de negocio.
  .max(500, 'El motivo no puede pasar de 500 caracteres.');

export const justificarFaltaSchema = z
  .object({
    /** Por id y no por nombre, misma razón que `marcarAsistenciaSchema`. */
    colaboradorId: z.number().int().positive(),
    dia: diaSchema,
    motivo: motivoJustificacionSchema,
  })
  .strict();
export type JustificarFaltaInput = z.infer<typeof justificarFaltaSchema>;

/**
 * El día de la justificación que se da de baja, en la query -- igual que al
 * borrar una marca, y por lo mismo: se levanta el perdón de UN día, nunca
 * todos los de una persona de una sola vez.
 */
export const quitarJustificacionQuerySchema = z.object({ dia: diaSchema });
export type QuitarJustificacionQuery = z.infer<typeof quitarJustificacionQuerySchema>;

// ---------------------------------------------------------------------------
// El día, entre el cable y la base
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM-DD` -> el `DateTime @db.Date` que espera Prisma.
 *
 * SIEMPRE a medianoche UTC, nunca `new Date(dia)` a secas ni la hora local
 * del servidor. La columna es `date` (sin hora) y el día es un dato del
 * NEGOCIO -- "la jornada del 18" --, no un instante: si se construyera en
 * hora local, un backend en UTC-5 guardaría el 17 a las 19:00, que Postgres
 * corta al **17**. La jornada entera se correría un día, y con ella la cuenta
 * de días del inventario.
 *
 * Vive acá y no en el service porque es el contrato del formato `dia`, el
 * mismo que valida `diaSchema`: una sola definición de qué día es cuál.
 */
export function aFechaUtc(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/** La vuelta: el `DateTime @db.Date` de Prisma -> `YYYY-MM-DD` para la API. */
export function aDia(fecha: Date): string {
  // `toISOString` tira RangeError con una fecha inválida, y `diaSchema` usa
  // esta función JUSTO para detectar eso -- devolver una cadena que no va a
  // coincidir con nada es lo que convierte "31 de febrero" en un rechazo
  // prolijo en vez de un 500.
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString().slice(0, 10);
}
