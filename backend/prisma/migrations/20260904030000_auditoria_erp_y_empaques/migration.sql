-- Esta migracion hace DOS cosas, y conviene saber por que van juntas.
--
-- 1. Los datos del ERP que alimentan la AUDITORIA (stock, precio de venta y
--    la marca de "lo asume la empresa") en `catalogo_items`.
--
-- 2. La estructura de MULTIPLES EMPAQUES que el schema de Prisma ya
--    declaraba pero que nunca llego a la base: las tablas `empaques`,
--    `empaques_catalogo` y `lineas_conteo` no existian en Postgres. El
--    codigo que las usa estaba roto contra la base real.
--
-- Van en la misma migracion porque Prisma genera un unico diff entre el
-- schema y la base: no hay forma de aplicar (1) sin arrastrar (2). Y (2) no
-- se podia dejar afuera de todos modos -- la auditoria necesita los factores
-- de empaque para convertir "2 cajas + 3 sueltas" en unidades.
--
-- LOS DATOS VIEJOS NO SE PIERDEN. Prisma, por su cuenta, habria hecho un
-- DROP COLUMN directo sobre `empaque_nombre`/`empaque_factor` y los items ya
-- cargados habrian quedado sin ningun empaque -- es decir, imposibles de
-- contar. Cada DROP de aca abajo va DESPUES de copiar su contenido a la
-- tabla nueva.

-- ---------------------------------------------------------------------------
-- 1. Datos del ERP para la auditoria
-- ---------------------------------------------------------------------------

-- Los tres son nullable o tienen default: ningun snapshot ya tomado se
-- vuelve invalido por esta migracion.
ALTER TABLE "catalogo_items"
  ADD COLUMN "stock_erp"    INTEGER,
  ADD COLUMN "precio_venta" DECIMAL(12,4),
  ADD COLUMN "es_empresa"   BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Multiples empaques: tablas nuevas
-- ---------------------------------------------------------------------------

CREATE TABLE "empaques_catalogo" (
    "id" SERIAL NOT NULL,
    "catalogo_item_id" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "factor" INTEGER NOT NULL,
    "codigo_barras" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "empaques_catalogo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "empaques" (
    "id" SERIAL NOT NULL,
    "producto_id" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "factor" INTEGER NOT NULL,
    "codigo_barras" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "empaques_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lineas_conteo" (
    "id" SERIAL NOT NULL,
    "conteo_id" INTEGER NOT NULL,
    "empaque_nombre" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    CONSTRAINT "lineas_conteo_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. MIGRACION DE DATOS -- antes de dropear nada
-- ---------------------------------------------------------------------------

-- El empaque unico que tenia cada item pasa a ser el primero de su lista
-- (orden 0), que es exactamente lo que significaba antes.
INSERT INTO "empaques_catalogo" ("catalogo_item_id", "nombre", "factor", "codigo_barras", "orden")
SELECT "id", "empaque_nombre", "empaque_factor", "empaque_codigo_barras", 0
FROM "catalogo_items"
WHERE "empaque_nombre" IS NOT NULL;

INSERT INTO "empaques" ("producto_id", "nombre", "factor", "codigo_barras", "orden")
SELECT "id", "empaque_nombre", "empaque_factor", "empaque_codigo_barras", 0
FROM "productos"
WHERE "empaque_nombre" IS NOT NULL;

-- `conteos.empaques` era un entero: "cuantos empaques conto". Ahora es una
-- linea por tipo de empaque. Se traslada como una sola linea contra el
-- empaque que el producto tenia -- que era el unico que podia haber contado.
INSERT INTO "lineas_conteo" ("conteo_id", "empaque_nombre", "cantidad")
SELECT c."id", p."empaque_nombre", c."empaques"
FROM "conteos" c
JOIN "productos" p ON p."id" = c."producto_id"
WHERE c."empaques" > 0 AND p."empaque_nombre" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Recien ahora se dropean las columnas viejas
-- ---------------------------------------------------------------------------

ALTER TABLE "catalogo_items"
  DROP COLUMN "empaque_nombre",
  DROP COLUMN "empaque_factor",
  DROP COLUMN "empaque_codigo_barras";

ALTER TABLE "productos"
  DROP COLUMN "empaque_nombre",
  DROP COLUMN "empaque_factor",
  DROP COLUMN "empaque_codigo_barras";

ALTER TABLE "conteos" DROP COLUMN "empaques";

-- ---------------------------------------------------------------------------
-- 5. Indices y claves foraneas
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "empaques_catalogo_catalogo_item_id_nombre_key" ON "empaques_catalogo"("catalogo_item_id", "nombre");
CREATE UNIQUE INDEX "empaques_producto_id_nombre_key" ON "empaques"("producto_id", "nombre");
CREATE UNIQUE INDEX "lineas_conteo_conteo_id_empaque_nombre_key" ON "lineas_conteo"("conteo_id", "empaque_nombre");

ALTER TABLE "empaques_catalogo" ADD CONSTRAINT "empaques_catalogo_catalogo_item_id_fkey"
  FOREIGN KEY ("catalogo_item_id") REFERENCES "catalogo_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "empaques" ADD CONSTRAINT "empaques_producto_id_fkey"
  FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lineas_conteo" ADD CONSTRAINT "lineas_conteo_conteo_id_fkey"
  FOREIGN KEY ("conteo_id") REFERENCES "conteos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
