-- Índices de rendimiento. Ver backend/docs/rendimiento-db.md.
--
-- Postgres NO crea índices sobre las claves foráneas por su cuenta (MySQL sí),
-- y Prisma tampoco: estas cinco columnas no tenían ninguno. Las dos de
-- `conteos`/`liquidaciones_colaborador` tampoco quedaban cubiertas por el
-- @@unique compuesto de su tabla, porque son la SEGUNDA columna del índice y
-- Postgres no puede saltarse la primera (regla del prefijo izquierdo).
--
-- SE QUITÓ A MANO de este archivo un `ALTER TABLE "inventarios" ALTER COLUMN
-- periodo_anio/periodo_mes SET DEFAULT ...` que Prisma agrega solo: siempre
-- regenera los defaults `dbgenerated()` porque no puede compararlos contra la
-- base. Se verificó que es un no-op -- la base ya tiene exactamente
-- `(EXTRACT(year FROM now()))::integer` -- y no pertenece a este cambio; de
-- paso evita un ACCESS EXCLUSIVE lock sobre `inventarios` para nada.
--
-- SIN `CONCURRENTLY` a propósito: Prisma envuelve cada migración en una
-- transacción y CONCURRENTLY no puede correr dentro de una. Con las tablas
-- casi vacías de hoy el lock dura un instante. El día que `conteos` tenga
-- millones de filas, un índice nuevo se agrega a mano con CONCURRENTLY en una
-- ventana, no por migración -- queda documentado en rendimiento-db.md.

-- CreateIndex
CREATE INDEX "conteos_producto_id_idx" ON "conteos"("producto_id");

-- CreateIndex
CREATE INDEX "hojas_conteo_asignado_a_id_idx" ON "hojas_conteo"("asignado_a_id");

-- CreateIndex
CREATE INDEX "hojas_conteo_asignado_a_2_id_idx" ON "hojas_conteo"("asignado_a_2_id");

-- CreateIndex
CREATE INDEX "liquidaciones_colaborador_colaborador_id_idx" ON "liquidaciones_colaborador"("colaborador_id");

-- CreateIndex
CREATE INDEX "sesiones_token_colaborador_id_idx" ON "sesiones_token"("colaborador_id");
