/**
 * Deja las SECUENCIAS del autoincremento sincronizadas con el `MAX(id)` real
 * de cada tabla. Lo llama, al terminar, toda semilla que inserte filas con id
 * EXPLICITO.
 *
 * ===========================================================================
 * POR QUE EXISTE -- no borrarlo por "no hace nada visible"
 * ===========================================================================
 *
 * Las semillas insertan con el id puesto a mano: `prisma/seed.ts` siembra las
 * sucursales 1..4, los colaboradores 101..405 y el administrador 1000;
 * `prisma/seed-historial.ts` los inventarios 8001..8003 y
 * `prisma/seed-auditoria.ts` los 8004..8006.
 *
 * En PostgreSQL, un INSERT que trae el id NO avanza la secuencia del
 * autoincremento: la secuencia se queda donde estaba (en una base nueva,
 * sin usar). El primer alta hecha DESDE LA APP no manda id -- y hace bien,
 * ver `src/modules/tiendas/tiendas.service.ts#crear` --, asi que pide el
 * proximo valor de la secuencia, recibe un id bajo que la semilla ya ocupo y
 * choca contra la clave primaria:
 *
 *     PrismaClientKnownRequestError:
 *     Invalid `prisma.sucursal.create()` invocation
 *     Unique constraint failed on the fields: (`id`)          <- codigo P2002
 *
 * que la API devuelve como un 500. Verificado el 2026-09-16 contra la base
 * real, creando una tienda desde la app. No es un problema de laboratorio:
 * al cliente le pasa en cuanto siembre el padron y cree su primera tienda o
 * su primer usuario.
 *
 * ===========================================================================
 * QUE HACE, Y QUE NO
 * ===========================================================================
 *
 * Para cada tabla del esquema `public` con una secuencia asociada a su
 * columna `id`, deja la secuencia en
 *
 *     GREATEST(MAX(id) de la tabla, ultimo valor entregado por la secuencia)
 *
 *   - IDEMPOTENTE: correrlo de nuevo sobre una base ya sana no cambia nada.
 *   - NUNCA BAJA UN CONTADOR, y ese es el motivo del GREATEST: si alguien
 *     borro las filas mas nuevas (los `limpiar-*-demo.ts`, por ejemplo), la
 *     secuencia se queda donde estaba en vez de volver a repartir ids que ya
 *     estuvieron en uso.
 *   - NO FALLA CON UNA TABLA VACIA: si ademas su secuencia nunca se uso, la
 *     saltea -- un `setval(secuencia, 0)` seria un error, porque la secuencia
 *     arranca en 1.
 *   - NO CONCATENA NOMBRES DE TABLA: salen de `pg_tables` y se escapan dentro
 *     de Postgres con `format('%I')` y `pg_get_serial_sequence`. Desde
 *     TypeScript no viaja ni un dato a la consulta (ver `SQL_SINCRONIZAR`).
 *
 * LO QUE SI CAMBIA, a proposito: despues de una semilla con ids altos, los
 * ids nuevos arrancan POR ENCIMA de los sembrados -- hoy, con los inventarios
 * de demo 8001..8006, el proximo inventario real es el 8007. Es la contracara
 * deliberada de no bajar nunca un contador.
 */

/**
 * La consulta es una CONSTANTE: no recibe parametros ni interpola nada. Los
 * nombres de tabla se leen de `pg_tables` y se escapan con `format('%I')`,
 * asi que no hay superficie de inyeccion aunque el nombre de una tabla
 * tuviera comillas.
 *
 * Los CTE van `MATERIALIZED` a proposito: sin eso el planificador puede subir
 * el `query_to_xml` por encima del filtro `secuencia IS NOT NULL` y evaluarlo
 * sobre tablas sin `id` serial (`_prisma_migrations`, cuyo id es texto, o
 * `config_dynamics`), lo que revienta la consulta entera.
 */
export const SQL_SINCRONIZAR = `
WITH candidatas AS MATERIALIZED (
  SELECT t.schemaname AS esquema,
         t.tablename AS tabla,
         pg_get_serial_sequence(format('%I.%I', t.schemaname, t.tablename), 'id') AS secuencia
  FROM pg_tables t
  WHERE t.schemaname = 'public'
),
con_secuencia AS MATERIALIZED (
  SELECT esquema, tabla, secuencia FROM candidatas WHERE secuencia IS NOT NULL
),
medidas AS MATERIALIZED (
  SELECT c.tabla,
         c.secuencia,
         COALESCE(
           (xpath(
             '/row/maximo/text()',
             query_to_xml(
               format('SELECT COALESCE(MAX(id), 0) AS maximo FROM %I.%I', c.esquema, c.tabla),
               false, true, ''
             )
           ))[1]::text::bigint,
           0
         ) AS maximo,
         pg_sequence_last_value(c.secuencia::regclass) AS ultimo
  FROM con_secuencia c
)
SELECT tabla,
       setval(secuencia, GREATEST(maximo, COALESCE(ultimo, 0)), true) AS valor
FROM medidas
WHERE maximo > 0 OR ultimo IS NOT NULL
ORDER BY tabla
`;

/** Lo unico que se le pide al cliente: poder correr SQL crudo. */
export interface ClienteConSql {
  $queryRawUnsafe(sql: string, ...valores: unknown[]): Promise<unknown>;
}

export interface SecuenciaSincronizada {
  /** Nombre de la tabla, tal como figura en `pg_tables`. */
  tabla: string;
  /** Valor en el que quedo la secuencia: el proximo id sera este + 1. */
  valor: number;
}

/**
 * Sincroniza las secuencias de todo el esquema `public` y devuelve en que
 * valor quedo cada una. Las tablas vacias cuya secuencia nunca se uso no
 * aparecen: no habia nada que sincronizar.
 */
export async function sincronizarSecuencias(cliente: ClienteConSql): Promise<SecuenciaSincronizada[]> {
  const filas = (await cliente.$queryRawUnsafe(SQL_SINCRONIZAR)) as Array<{ tabla: string; valor: bigint | number }>;
  // `setval` devuelve BIGINT, que Prisma entrega como `bigint` de JS. Los ids
  // de esta base entran holgados en un `number`, y asi la linea del log no
  // sale con la "n" pegada al final ("1011n").
  return filas.map((f) => ({ tabla: f.tabla, valor: Number(f.valor) }));
}

/** La linea que la semilla deja en el log. Una sola, y que se entienda sola. */
export function describirSincronizacion(filas: readonly SecuenciaSincronizada[]): string {
  const cuantas = filas.length === 1 ? '1 tabla sincronizada' : `${filas.length} tablas sincronizadas`;
  return `Secuencias del autoincremento al dia: ${cuantas} con su MAX(id) -- la proxima alta desde la app no choca con los ids de la semilla.`;
}

/**
 * Lo que llaman las semillas al final: sincroniza y deja UNA linea en el log.
 *
 * Si falla, falla fuerte (no se traga el error): una secuencia que quedo
 * atrasada es justamente el 500 que este archivo viene a evitar, y esconderlo
 * lo devolveria al lugar donde estaba -- invisible hasta que el cliente crea
 * su primera tienda.
 */
export async function sincronizarSecuenciasYAvisar(
  cliente: ClienteConSql,
  registrar: (linea: string) => void = console.log,
): Promise<SecuenciaSincronizada[]> {
  const filas = await sincronizarSecuencias(cliente);
  registrar(describirSincronizacion(filas));
  return filas;
}
