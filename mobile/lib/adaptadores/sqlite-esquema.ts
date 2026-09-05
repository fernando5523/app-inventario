/**
 * El esquema SQLite — SQL puro, sin importar `expo-sqlite`. Lo usan
 * _sqlite.ts (con el motor nativo de verdad) Y hojas-sqlite.test.ts (con
 * `node:sqlite`, el motor real de Node, para probar la persistencia sin
 * dispositivo) — el MISMO esquema en los dos lados, nunca una copia que
 * se pueda desincronizar de lo que corre en el teléfono.
 *
 * `DbMigrable` es la única forma que este archivo necesita de una base:
 * cualquier objeto con esos dos métodos sirve, sea `expo-sqlite` real o
 * un stand-in de test — por eso este archivo no importa nada de RN y se
 * puede cargar bajo vitest sin problema.
 */

export interface DbMigrable {
  getFirstAsync<T>(source: string): Promise<T | null>;
  execAsync(source: string): Promise<void>;
}

/**
 * Migraciones en orden — cada una es el SQL completo de un paso. Nunca se
 * edita una ya escrita (una vez que salió a un dispositivo, ese `CREATE
 * TABLE` ya corrió ahí): para cambiar el esquema se agrega una nueva.
 *
 * v1 — tres tablas:
 *   - `hoja_estado_local`: overlay LOCAL de estado/sync por hoja. La
 *     estructura de la hoja (zona, góndola, productos, asignados) sigue
 *     viniendo de donde ya vivía (_compartido.ts hoy, el backend
 *     mañana) — acá solo se guarda lo que el dispositivo mutó offline.
 *   - `conteos`: PK (hoja_id, producto_id) — un producto tiene UN
 *     conteo vigente, nunca una lista que crece. Recontar el mismo
 *     producto pisa la fila anterior (`INSERT OR REPLACE`), no agrega
 *     una nueva: así no se duplica ni local ni en lo que se sincroniza.
 *   - `cola_sync`: qué falta mandar. UNIQUE (hoja_id, tipo, producto_id)
 *     por la misma razón — un conteo nuevo del mismo producto reemplaza
 *     al pendiente en vez de apilarse. `producto_id = 0` para los items
 *     de tipo 'finalizar' (son de la hoja entera, no de un producto).
 */
export const MIGRACIONES_SQLITE: string[] = [
  `
  CREATE TABLE IF NOT EXISTS hoja_estado_local (
    hoja_id INTEGER PRIMARY KEY NOT NULL,
    estado TEXT NOT NULL,
    sync TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conteos (
    hoja_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    empaques INTEGER NOT NULL,
    sueltas INTEGER NOT NULL,
    confirmado_por_escaner INTEGER NOT NULL,
    contado_en TEXT NOT NULL,
    PRIMARY KEY (hoja_id, producto_id)
  );

  CREATE TABLE IF NOT EXISTS cola_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hoja_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    producto_id INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    UNIQUE (hoja_id, tipo, producto_id)
  );
  `,
  /**
   * v2 — decisión del cliente: un producto puede tener MÁS de un empaque
   * (Caja Y Pack del mismo producto). `conteos.empaques` deja de ser un
   * número (cuántos del ÚNICO empaque) y pasa a ser `lineas`, JSON con
   * una entrada por cada empaque cargado (ver
   * lib/dominio/tipos.ts#LineaEmpaque). `cola_sync` NO cambia: nunca
   * guardó el valor del conteo, solo qué falta mandar — el valor se
   * relee siempre de `conteos` al momento de enviar.
   *
   * Los conteos v1 ya guardados (`empaques` INTEGER) no dicen A CUÁL
   * empaque correspondía esa cantidad — v1 solo conocía uno por
   * producto, así que nunca hizo falta guardar el nombre. Esta
   * migración SQL no inventa uno: copia la cantidad tal cual bajo un
   * empaque marcador `__LEGADO__` — hojas-sqlite.ts#repararLineaLegado
   * lo resuelve al nombre real la primera vez que relee esa fila (ahí sí
   * hay acceso al catálogo del producto) y lo deja corregido en la base,
   * no en cada lectura.
   */
  `
  ALTER TABLE conteos RENAME TO conteos_v1_legado;

  CREATE TABLE conteos (
    hoja_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    lineas TEXT NOT NULL,
    sueltas INTEGER NOT NULL,
    confirmado_por_escaner INTEGER NOT NULL,
    contado_en TEXT NOT NULL,
    PRIMARY KEY (hoja_id, producto_id)
  );

  INSERT INTO conteos (hoja_id, producto_id, lineas, sueltas, confirmado_por_escaner, contado_en)
    SELECT
      hoja_id,
      producto_id,
      CASE WHEN empaques > 0
        THEN '[{"empaqueNombre":"__LEGADO__","cantidad":' || empaques || '}]'
        ELSE '[]'
      END,
      sueltas,
      confirmado_por_escaner,
      contado_en
    FROM conteos_v1_legado;

  DROP TABLE conteos_v1_legado;
  `,
  /**
   * v3 — la DESCARGA inicial (bug real, reportado por el cliente con
   * captura: "Mis hojas: 0 hojas, 0 items" después de que el Coordinador
   * ya había creado y asignado las 25 hojas del inventario real).
   *
   * Hasta acá, la ESTRUCTURA de una hoja (zona, góndola, productos,
   * asignados) salía de `_compartido.ts` — un dataset de ejemplo en RAM
   * que ya venía sembrado. `hoja_estado_local`/`conteos` v1/v2 solo
   * guardan el OVERLAY local (lo que el operario mutó offline); nunca
   * hubo una tabla para persistir la estructura real bajada del backend.
   * Con el dataset de ejemplo eso no se notaba (la "base" ya nacía
   * llena); contra un inventario real, el Contador entraba a "Mis hojas"
   * y no había NADA que mostrar — nunca se le preguntaba al servidor.
   *
   * `hojas_estructura` / `productos_estructura` son esa persistencia que
   * faltaba: lo que `hojas-sqlite.ts#descargarHojas` trae de
   * `GET /api/hojas` (+ `GET /api/hojas/:id/productos` cuando el listado
   * los manda vacíos, ver backend/README.md) y guarda ACÁ, para que
   * "Mis hojas" tenga algo que leer incluso sin señal la próxima vez.
   *
   * Es estructura, no overlay: nunca se lee `estado`/`sync`/`conteos` de
   * acá directamente (por eso esas columnas ni existen en
   * `hojas_estructura`) — sigue siendo `hoja_estado_local`/`conteos` la
   * única fuente de verdad para eso, exactamente como antes. Volver a
   * descargar la estructura (upsert de `hojas_estructura`, y
   * `productos_estructura` solo si todavía no tiene filas para esa hoja)
   * NUNCA toca esas dos tablas si ya existen — es la misma protección que
   * `asegurarSembrada` ya le daba al dataset de ejemplo, ahora sobre datos
   * reales: si el operario ya contó 32 de 50 sin señal, la descarga no
   * se lo puede pisar.
   */
  `
  CREATE TABLE IF NOT EXISTS hojas_estructura (
    id INTEGER PRIMARY KEY NOT NULL,
    inventario_id INTEGER NOT NULL,
    numero TEXT NOT NULL,
    zona TEXT NOT NULL,
    gondola TEXT NOT NULL,
    tamano INTEGER NOT NULL,
    asignados TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hojas_estructura_inventario ON hojas_estructura(inventario_id);

  CREATE TABLE IF NOT EXISTS productos_estructura (
    hoja_id INTEGER NOT NULL,
    id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    codigo TEXT NOT NULL,
    codigo_barras TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    empaques TEXT NOT NULL,
    ubicacion TEXT,
    categoria TEXT,
    PRIMARY KEY (hoja_id, id)
  );
  `,
  /**
   * v4 — la RONDA del ciclo de conteos. Hasta acá el front pedía siempre la
   * 1ra (`hojas-api.ts` no mandaba `ronda`), así que `hojas_estructura` no
   * necesitaba distinguirla: todo lo que había bajado ERA de la ronda 1. Al
   * abrir el 2do conteo, el Contador tiene que ver las hojas de reconteo, no
   * las de la 1ra — para eso la estructura local tiene que saber de qué ronda
   * es cada hoja.
   *
   * ADITIVA A PROPÓSITO — `ADD COLUMN ... DEFAULT 1`, nada más:
   *
   *  - Las filas que ya están en un teléfono instalado se bajaron cuando el
   *    front solo pedía la 1ra. `DEFAULT 1` las marca ronda 1, que es su ronda
   *    REAL — no un relleno inventado.
   *  - NO toca `conteos` ni `cola_sync`: un conteo hecho sin señal, esperando
   *    el WiFi en la cola, SOBREVIVE intacto. Esas tablas viven aparte de la
   *    estructura (por diseño, ver v3) y esta migración ni las nombra. Es lo
   *    que no puede fallar: la migración nunca puede costarle a nadie un
   *    conteo que ya hizo.
   *  - Nada de DROP + re-descarga: eso dejaría los conteos pendientes de la
   *    ronda 1 apuntando a hojas que ya no están en la estructura local. La
   *    re-descarga de la ronda activa es trabajo de hojas-sqlite.ts (con red),
   *    no de la migración de esquema.
   *
   * `numero_conteo` y no `ronda` para espejar el nombre de la columna del
   * backend (`HojaConteo.numeroConteo`).
   */
  `
  ALTER TABLE hojas_estructura ADD COLUMN numero_conteo INTEGER NOT NULL DEFAULT 1;

  CREATE INDEX IF NOT EXISTS idx_hojas_estructura_inv_ronda
    ON hojas_estructura(inventario_id, numero_conteo);
  `,
  /**
   * v5 — la RAZÓN de un rechazo (hallazgo 2026-09-05: un conteo rechazado
   * no frenaba al `finalizar` de la misma hoja, que salía igual, y el
   * único mensaje que veía la persona era "revisá la conexión" — activamente
   * engañoso para un 409 que no tiene nada que ver con la red).
   *
   * `razon` guarda el mensaje del servidor (`ErrorApi.message`, ver
   * sincronizador.ts#enviarPorRed) SOLO para un rechazo real
   * (`motivo: 'rechazado'`) — un `sin-red` no tiene "razón del servidor"
   * que guardar, y por eso queda en NULL en ese caso (ver
   * sqlite-cola.ts#aplicarResultadoEnvio).
   *
   * ADITIVA: `ALTER TABLE ... ADD COLUMN` nullable, sin tocar filas
   * existentes — mismo criterio que v4 (numero_conteo).
   */
  `
  ALTER TABLE cola_sync ADD COLUMN razon TEXT;
  `,
  /**
   * v6 — la SUCURSAL de cada hoja local (hallazgo min-1/min-4, 2026-09-06:
   * en un teléfono que se usó para más de un inventario, el camino SIN RED
   * -- `inventarioIdSinRed`/`rondaActivaSinRed` -- no distinguía de qué
   * sucursal ni de qué colaborador eran las filas de `hojas_estructura`,
   * una tabla COMPARTIDA por todo lo que se haya descargado alguna vez en
   * ese equipo. Un Contador de Luzuriaga sin red terminaba viendo las
   * hojas de Bolívar, de las dos rondas juntas.
   *
   * Antes de esto, el único dato de "de quién es" que existía local era
   * `asignados` (JSON de NOMBRES) — suficiente para filtrar por persona,
   * pero frágil ante un homónimo entre dos sucursales (dos Contadores
   * distintos que casualmente se llaman igual). `sucursal_id` es la
   * segunda pertenencia, más dura que un nombre: se independiza de que el
   * nombre coincida o no.
   *
   * NULLABLE a propósito: las filas que ya están en un teléfono instalado
   * se bajaron ANTES de que este código supiera guardar la sucursal. NULL
   * significa "no se sabe" -- el filtro que la usa (`inventarioIdSinRed`)
   * trata un NULL como "no se puede descartar por sucursal, pero SÍ hay
   * que exigir el nombre" en vez de inventar un valor. La próxima
   * descarga de esa hoja (con red) la completa sola, vía
   * `guardarEstructuraDeHoja`, que a partir de acá SIEMPRE la escribe.
   *
   * De dónde sale el valor al guardar: la sesión local activa en ESE
   * momento (`sesionApi`/`sesionMemoria`, igual que ya hace
   * `nombreDeColaboradorEnSesion`) — quien dispara una descarga es,
   * necesariamente, quien está usando la app en ese instante, así que su
   * sucursal es la sucursal real de esa hoja. No hace falta agregar un
   * parámetro nuevo a ningún puerto (`RepositorioHojas` no cambia).
   */
  `
  ALTER TABLE hojas_estructura ADD COLUMN sucursal_id INTEGER;

  CREATE INDEX IF NOT EXISTS idx_hojas_estructura_sucursal ON hojas_estructura(sucursal_id);
  `,
];

export async function migrarSqlite(db: DbMigrable): Promise<void> {
  const fila = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = fila?.user_version ?? 0;
  for (let i = version; i < MIGRACIONES_SQLITE.length; i++) {
    await db.execAsync(MIGRACIONES_SQLITE[i]);
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }
}
