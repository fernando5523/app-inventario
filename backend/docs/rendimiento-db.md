# Rendimiento de base de datos — análisis a escala real

Fecha: 2026-09-07 · Rama `main` · Prisma 5.20 · PostgreSQL 17/18

**Esto es ANÁLISIS. No se aplicó ningún cambio de schema ni migración.**

---

## 0. Alcance, y qué NO se pudo medir

### La escala contra la que se analiza

De la reunión y de lo medido en producción:

| Magnitud | Valor |
|---|---|
| Ítems de catálogo | ~8.000 por tienda y por inventario |
| Tiendas | 11 (MD01..MD11) |
| Hoja mensual | 50 ítems → **~160 hojas** por inventario |
| Rondas de conteo | hasta 3 |
| Inventarios | 1 por tienda por mes → **132 por año** |
| Historial | crece mes a mes, 12+ meses |

Filas por inventario, derivadas de lo anterior:

| Tabla | Filas / inventario | Filas a 12 meses × 11 tiendas |
|---|---|---|
| `catalogo_items` | 8.000 | ~1.056.000 |
| `empaques_catalogo` | 8.000–16.000 | ~1.000.000–2.000.000 |
| `productos` | ~9.366 (8.000 + 1.236 + 130) | ~1.236.000 |
| `empaques` | ~9.366+ | ~1.236.000 |
| `conteos` | hasta 9.366 | ~1.236.000 |
| `lineas_conteo` | ~9.366+ | ~1.236.000 |
| `hojas_conteo` | ~188 (160 + 25 + 3) | ~24.816 |
| `diferencias_item` | ~130 | ~17.160 |

Los números de reconteo (1.236 en ronda 2, 130 en ronda 3) son los del propio
ejemplo del cliente en `docs/pantallas.md`.

### Medición: NO REALIZADA — falta credencial

Se intentó crear la base `app_inventario_perf` para sembrar datos sintéticos y
correr `EXPLAIN ANALYZE`, como pidió el encargo. **No fue posible:**

- PostgreSQL responde en `localhost:5432` (servidor vivo, verificado).
- La credencial vive en `backend/.env`, que este análisis **no debe leer**
  (regla operativa vigente del proyecto).
- `postgres/postgres` fue rechazado: `FATAL: la autentificación password falló`.

**Consecuencia — lo que sigue es análisis ESTÁTICO.** Los conteos de filas son
derivados de la escala declarada, no medidos. Los tiempos son estimaciones
salvo el único dato real que ya existe: **el snapshot tardando 60–90 s con 951
ítems**, medido en la tienda chica.

Para completar la medición hace falta una de estas dos cosas:

1. La credencial de Postgres (o un usuario dedicado con permiso `CREATEDB`), o
2. Que el orquestador cree la base y corra el sembrado.

El hallazgo **H1** ya está confirmado por la evidencia de campo (60–90 s con
951 ítems); los demás quedan como **PLAUSIBLES pendientes de medición**, y así
están marcados en la tabla.

---

## 1. Índices que existen hoy

Leídos de `backend/prisma/schema.prisma`, sin interpretación:

| Modelo | Índices declarados |
|---|---|
| `Sucursal` | PK |
| `Colaborador` | `@@unique([sucursalId, dni])` |
| `Configuracion` | `clave @unique` |
| `RegistroAuditoria` | `@@index([entidad, entidadId])` |
| `SesionToken` | `token @unique` |
| `Inventario` | `@@unique([sucursalId, periodoAnio, periodoMes, tipo])`, `@@unique([sucursalId, abierto])`, `@@index([sucursalId, estado])`, `@@index([sucursalId, tipo])` |
| `CatalogoItem` | `@@unique([inventarioId, codigo])`, `@@index([inventarioId, codigoBarras])` |
| `EmpaqueCatalogo` | `@@unique([catalogoItemId, nombre])` |
| `HojaConteo` | `@@unique([inventarioId, numeroConteo, numero])` |
| `Producto` | `@@unique([hojaId, codigo])`, `@@index([hojaId, codigoBarras])` |
| `Empaque` | `@@unique([productoId, nombre])` |
| `Conteo` | `@@unique([hojaId, productoId])` |
| `LineaConteo` | `@@unique([conteoId, empaqueNombre])` |
| `LacradoInventario` | `inventarioId @unique`, `folio @unique`, `hash @unique` |
| `RegistroErpInventario` | `lacradoId @unique` |
| `AprobacionCierre` | `@@unique([inventarioId, aprobadorId])` |
| `ResultadoInventario` | `inventarioId @unique` |
| `DiferenciaItem` | `@@unique([inventarioId, codigo])`, `@@index([codigo])`, `@@index([inventarioId, diferencia])` |
| `LiquidacionColaborador` | `@@unique([inventarioId, colaboradorId])` |
| `ConfigDynamics` | PK |

**El dato que cambia el análisis: PostgreSQL NO crea índices automáticamente
sobre las columnas de clave foránea.** MySQL sí; Postgres no, y Prisma tampoco
los agrega. Toda FK sin `@@index` explícito (o sin ser *prefijo* de un
`@@unique`) está sin índice. Ese es el origen de la mitad de los hallazgos de
abajo.

FKs **cubiertas** por ser prefijo de un índice existente (no hay nada que
hacer): `CatalogoItem.inventarioId`, `HojaConteo.inventarioId`,
`Producto.hojaId`, `Conteo.hojaId`, `Empaque.productoId`,
`LineaConteo.conteoId`, `EmpaqueCatalogo.catalogoItemId`,
`DiferenciaItem.inventarioId`, `Colaborador.sucursalId`,
`Inventario.sucursalId`.

FKs **sin índice**: `Conteo.productoId`, `HojaConteo.asignadoAId`,
`HojaConteo.asignadoA2Id`, `LiquidacionColaborador.colaboradorId`,
`SesionToken.colaboradorId`, `RegistroAuditoria.actorId`,
`AprobacionCierre.aprobadorId`, `Colaborador.creadoPorId`,
`Inventario.cerradoPorId`, `LacradoInventario.lacradoPorId`,
`ResultadoInventario.ajustesPorId`, `RegistroErpInventario.registradoPorId`,
`ConfigDynamics.actualizadoPorId`.

No todas importan. Las que sí, abajo.

---

## 2. Hallazgos, ordenados por impacto

| # | Qué | Dónde | Filas a escala real | Medido | Propuesta |
|---|---|---|---|---|---|
| **H1** | Snapshot inserta el catálogo **fila por fila** dentro de una `$transaction` | `d365/d365-catalogo.service.ts:770-804` | 8.000 `INSERT` + 8.000–16.000 de empaques, en 1 transacción | **SÍ: 60–90 s con 951 ítems** | `createMany` en lotes + empaques aparte. Ver §3.1 |
| **H2** | `crearHojas`: transacción **interactiva** con 160 `create` anidados | `inventarios/inventarios.service.ts:161-215` | 160 hojas + ~8.000 productos + ~8.000 empaques | No | Sacar el trabajo pesado de la transacción interactiva, o subir `timeout`. Ver §3.2 |
| **H3** | `armarMatriz` carga catálogo + 3 rondas completas a RAM | `auditoria/auditoria.service.ts:99-110` | 8.000 catálogo + ~9.366 productos + conteos + líneas | No | Índice `Conteo(productoId)`; a futuro, agregar en SQL. Ver §3.3 |
| **H4** | `GET /api/hojas` **sin paginación**, con `include` completo | `hojas/hojas.service.ts:302-311` | 160 hojas × 50 productos + empaques + conteos + líneas | No | Paginar, o `select` liviano para el listado. Ver §3.4 |
| **H5** | `alcance=mias` filtra por `asignadoAId`/`asignadoA2Id` **sin índice** | `hojas/hojas.service.ts:297-300` | seq scan sobre ~24.816 hojas | No | `@@index([asignadoAId])` + `@@index([asignadoA2Id])` |
| H6 | `contadoHastaLaRonda` trae **todas las rondas** con 4 niveles anidados | `inventarios/rondas.service.ts:90-102` | ~9.366 productos + conteos + líneas | No | Mismo índice que H3 |
| H7 | Auditoría pagina **en memoria** (`slice`) tras traer los 8.000 | `auditoria/auditoria.service.ts:227` | 8.000 por request | No | Ver §5: es deliberado, no tocar sin decisión |
| H8 | `deleteMany` con filtro relacional anidado de 2 niveles | `inventarios/inventarios.service.ts:163-165` | `IN (SELECT...)` sobre ~8.000 productos | No | Índice `Conteo(productoId)` ayuda; medir antes |
| H9 | `LiquidacionColaborador.colaboradorId` sin índice | schema | ~1.452 filas/año | No | `@@index([colaboradorId])` — barato, preventivo |
| H10 | `SesionToken.colaboradorId` sin índice, y se hace `deleteMany` por él | `sesion.service.ts:174`, `usuarios.service.ts:218` | pocas filas hoy; crece sin purga | No | `@@index([colaboradorId])` + política de purga |
| H11 | `cola_sync` móvil: `WHERE estado != ?` sin índice | `mobile/lib/adaptadores/hojas-sqlite.ts:1147` | ~2.250 filas por teléfono | No | **No tocar hoy** — ver §5 |

---

## 3. Los cinco primeros, en detalle

### 3.1 H1 — El snapshot: 8.000 inserts uno por uno

`d365-catalogo.service.ts:766-804`:

```ts
await prisma.$transaction(
  catalogo.map((item) =>
    prisma.catalogoItem.create({
      data: { ...item, empaques: { create: item.empaques.map(...) } },
    }),
  ),
);
```

El comentario del código explica **por qué** está así, y es una razón real:

> `createMany` no acepta escrituras anidadas (cada item ahora trae una LISTA de
> empaques, no columnas planas) — por eso es un create por item envuelto en
> `$transaction`, y no un solo `createMany` masivo.

Es cierto. Pero el costo es que cada `create` es **un round-trip propio** al
servidor. Con 951 ítems eso da los 60–90 s medidos; a 8.000 ítems escala
lineal: **8,4× más, entre 8 y 12 minutos**, con la transacción abierta todo ese
tiempo tomando locks.

Y hay un segundo costo que no se ve: una transacción de 10 minutos con 8.000
inserts mantiene vivo un snapshot de MVCC enorme y bloquea el `VACUUM` de esas
tablas mientras dura.

**Propuesta.** La limitación de `createMany` se rodea insertando en dos pasos,
que es exactamente lo que la relación permite:

1. `createMany` de los 8.000 `catalogo_items` en lotes de ~1.000.
2. Releer los `id` recién creados (`findMany` por `inventarioId`, `select: {id, codigo}`).
3. `createMany` de los empaques, ya con `catalogoItemId` resuelto.

Pasa de ~16.000 round-trips a ~25. **Esta es la única propuesta del informe con
evidencia de campo detrás**, y es la que más devuelve por lo que cuesta.

Cuidado al implementarlo: el paso 2 debe leer dentro de la misma transacción y
el `@@unique([inventarioId, codigo])` garantiza que el cruce por `codigo` es
unívoco. No inventar el mapeo por orden de inserción — `createMany` no promete
orden de retorno.

### 3.2 H2 — `crearHojas` puede pasarse del timeout

`inventarios.service.ts:161`:

```ts
await prisma.$transaction(async (tx) => {   // ← interactiva
  await tx.empaque.deleteMany({ where: { producto: { hoja: { inventarioId } } } });
  await tx.producto.deleteMany({ where: { hoja: { inventarioId } } });
  await tx.hojaConteo.deleteMany({ where: { inventarioId } });
  for (const [indice, cantidad] of tamanos.entries()) {
    await tx.hojaConteo.create({ data: { ..., productos: { create: bloque.map(...) } } });
  }
});
```

Verificado con `grep` en todo `backend/src`: **no hay ninguna configuración de
`timeout`, `maxWait` ni `transactionOptions`.** Prisma 5 aplica sus defaults a
las transacciones interactivas: `maxWait` 2.000 ms y **`timeout` 5.000 ms**.

Con 160 hojas × 50 productos × ~1 empaque cada uno, esto son ~160 round-trips
que escriben ~17.000 filas. **No entra en 5 segundos.** El síntoma no va a ser
lentitud: va a ser un error de transacción abortada a mitad de camino, con el
inventario sin hojas y el Coordinador mirando el paso 2 fallar.

Es la diferencia entre H1 y H2: H1 es lento y funciona; **H2 probablemente
falle directamente.** Y hoy no se nota porque 951 ítems son 20 hojas.

**Propuesta.** Dos opciones, con tradeoff real:

- **(a)** Subir `timeout` a 120 s en esta transacción. Una línea, pero mantiene
  una transacción larguísima tomando locks sobre las tablas de hojas.
- **(b)** Sacar el trabajo de la transacción interactiva: borrar e insertar con
  `createMany` por lotes, dejando en la transacción solo lo que debe ser
  atómico.

Recomiendo **(b)**, pero **(a)** es el parche válido si hace falta algo hoy
mismo antes de que el cliente cargue una tienda grande.

### 3.3 H3 — `armarMatriz`: el catálogo entero y las 3 rondas en RAM

`auditoria.service.ts:99-110` trae, en paralelo:

- los 8.000 `catalogo_items`, y
- **todas** las hojas finalizadas con `productos → empaques` **y**
  `productos → conteos → empaques`.

Cuatro niveles de anidación. A escala real son ~9.366 productos, cada uno con
sus empaques y sus líneas de conteo: del orden de **40.000–50.000 filas
materializadas en memoria del proceso Node**, por request.

Y no es solo la pantalla del Auditor: `rondas.service.ts:410` la reusa **dentro
del cierre de conteo**, que además corre junto a otra pasada completa
(`hojasDelInventario`, línea 419).

El `include` de `conteos` dentro de `productos` es el que dispara un plan por
producto sobre `conteos` filtrando por `productoId` — **columna sin índice**.
El `@@unique([hojaId, productoId])` no sirve acá: `productoId` es la *segunda*
columna del índice, y Postgres no puede usar un índice compuesto saltándose la
primera columna de forma eficiente.

**Propuesta inmediata:** `@@index([productoId])` en `Conteo`. Barato, sin
riesgo, y también ayuda a H6 y H8.

**Propuesta de fondo (no ahora):** la matriz es una agregación —
`totalUnidades` por producto por ronda— que Postgres puede hacer en SQL sin
mover 50.000 filas a Node. Es un cambio grande; se propone como trabajo
aparte, con medición previa.

### 3.4 H4 — `GET /api/hojas` no tiene límite

`hojas.service.ts:302-311`: sin `take`, sin `skip`, con `include: INCLUIR_TODO`.

Con `alcance=todas` y ronda 1, un Coordinador pide **las 160 hojas con sus
8.000 productos, empaques, conteos y líneas en un solo JSON.** Es también el
endpoint que alimenta la pantalla de Gestión de hojas (incluido el filtro que
se agregó en `7acc716`).

El historial ya pagina bien (`historial.service.ts:235`, `462`: `take`/`skip`
en la base). Este no.

**Propuesta.** Separar dos necesidades que hoy comparten un endpoint:

- **listado** (lo que la pantalla del Coordinador necesita): `select` liviano —
  id, número, zona, estado, asignados, y los contadores agregados. Sin
  productos.
- **detalle de una hoja**: el `include` completo que ya existe, por hoja.

Esto además hace innecesario el `productosSinConteo` calculado en Node: sale de
un `_count` en la misma consulta.

### 3.5 H5 — "mis hojas" hace seq scan

`hojas.service.ts:297-300`:

```ts
query.alcance === 'mias'
  ? { OR: [{ asignadoAId: actor.colaboradorId }, { asignadoA2Id: actor.colaboradorId }] }
  : {}
```

Ninguna de las dos columnas tiene índice. A ~24.816 hojas al año, cada Contador
que abre "Mis hojas" dispara un scan completo de `hojas_conteo`. Hoy son 25
filas y no se nota.

También afecta a `usuarios.service.ts:222-223`, que hace `updateMany` filtrando
por esas mismas columnas al eliminar una cuenta.

**Propuesta:** `@@index([asignadoAId])` y `@@index([asignadoA2Id])`.

---

## 4. Índices propuestos y migración sugerida

Cambios en `schema.prisma` (**no aplicados**):

```prisma
model Conteo {
  // ...
  @@unique([hojaId, productoId])
  @@index([productoId])            // NUEVO — H3, H6, H8
  @@map("conteos")
}

model HojaConteo {
  // ...
  @@unique([inventarioId, numeroConteo, numero])
  @@index([asignadoAId])           // NUEVO — H5
  @@index([asignadoA2Id])          // NUEVO — H5
  @@map("hojas_conteo")
}

model LiquidacionColaborador {
  // ...
  @@unique([inventarioId, colaboradorId])
  @@index([colaboradorId])         // NUEVO — H9
  @@map("liquidaciones_colaborador")
}

model SesionToken {
  // ...
  @@index([colaboradorId])         // NUEVO — H10
  @@map("sesiones_token")
}
```

SQL de la migración (`prisma migrate dev --create-only`, revisar antes de
aplicar):

```sql
-- CONCURRENTLY: no bloquea escrituras mientras construye el índice.
-- Requiere correr FUERA de una transacción; Prisma envuelve las migraciones
-- en una, así que estas cuatro líneas van en una migración marcada
-- explícitamente como no transaccional, o se aplican a mano en una ventana.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conteos_producto_id_idx"
  ON "conteos" ("producto_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "hojas_conteo_asignado_a_id_idx"
  ON "hojas_conteo" ("asignado_a_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "hojas_conteo_asignado_a_2_id_idx"
  ON "hojas_conteo" ("asignado_a_2_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "liquidaciones_colaborador_colaborador_id_idx"
  ON "liquidaciones_colaborador" ("colaborador_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sesiones_token_colaborador_id_idx"
  ON "sesiones_token" ("colaborador_id");
```

Con las tablas casi vacías de hoy, `CONCURRENTLY` es indistinto y se puede
aplicar de la forma normal. Importa el día que haya un millón de `conteos`.

**Costo de escritura**: cinco índices más significa cinco árboles más que
mantener en cada `INSERT`. En `conteos`, que es la tabla de escritura caliente
durante el conteo, es un índice adicional por fila. Aceptable: las escrituras
son de a una fila desde el móvil, y el beneficio en lectura es de otro orden.

---

## 5. Lo que NO hay que tocar, y por qué

**La paginación en memoria de la auditoría (H7).** `auditoria.service.ts:227`
hace `filtrada.slice(...)` después de armar la matriz completa, y el comentario
del código explica el motivo:

> el encabezado tiene que decir "7.870 de 8.000 cuadrados" siempre, no "98 de
> 100 en esta página".

Es correcto y es una decisión de producto, no un descuido. Paginar en la base
haría que los totales del encabezado cambien al pasar de página, que es
exactamente el tipo de número que miente. Si algún día molesta, la salida es
calcular el resumen con una agregación aparte —no paginar antes de resumir.

**El SQLite del móvil (H11).** Se revisaron las tres tablas y sus consultas:

- `conteos` PK `(hoja_id, producto_id)` — las consultas filtran por `hoja_id`,
  que es prefijo de la PK. Cubierto.
- `cola_sync` UNIQUE `(hoja_id, tipo, producto_id)` — las consultas por
  `hoja_id` están cubiertas.
- `hojas_estructura` tiene índices por `inventario_id`, `(inventario_id,
  numero_conteo)` y `sucursal_id`. Cubierto.

Quedan dos scans completos: `SELECT * FROM cola_sync WHERE estado != ?`
(línea 1147) y el `SELECT` sin `WHERE` de la línea 409. **A escala real son
irrelevantes**: un teléfono tiene las hojas de UNA persona — ~15 hojas por
ronda, 45 con las 3 rondas bajadas, ~2.250 filas en `productos_estructura`. Un
scan de 2.250 filas en SQLite local es sub-milisegundo. Agregar índices ahí
sería trabajo sin retorno, y cada índice nuevo es una migración más en un
esquema que ya va por la v8 y que corre en teléfonos con conteos sin
sincronizar. **No tocar.**

**Los índices de `DiferenciaItem`.** `@@index([codigo])` y
`@@index([inventarioId, diferencia])` ya cubren exactamente las dos preguntas
del negocio ("el historial de este artículo" y "los peores faltantes del mes").
Están bien puestos y comentados. No hay nada que agregar.

**Las FKs de auditoría/firma sin índice** (`lacradoPorId`, `aprobadorId`,
`ajustesPorId`, `registradoPorId`, `actorId`, `creadoPorId`, `cerradoPorId`,
`actualizadoPorId`). Son tablas de decenas a miles de filas al año, y ninguna
consulta del código filtra por ellas: se leen siempre por `inventarioId` o por
PK. Indexarlas sería ruido. Revisar sólo si aparece una pantalla de "todo lo
que hizo esta persona".

---

## 6. Qué falta para cerrar esto

1. **Medir.** Falta la credencial de Postgres para crear `app_inventario_perf`,
   sembrar 8.000 ítems × 3 rondas y correr `EXPLAIN ANALYZE`. Sin eso, H2–H11
   son hipótesis bien fundadas, no hechos. H1 sí tiene evidencia de campo.
2. **Confirmar el orden de trabajo.** Sugerido por impacto/costo:
   H1 (snapshot en lotes) → H2 (timeout de `crearHojas`) → los cinco índices →
   H4 (paginar hojas) → H3 de fondo.
3. **Decidir sobre H2 (a) vs (b)** antes de tocar nada: el parche de una línea
   y el arreglo real tienen tradeoffs distintos.
