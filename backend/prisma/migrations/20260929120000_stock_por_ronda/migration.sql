-- EL STOCK DEL ERP POR RONDA, Y EL RELLENO DE LA RONDA 1 DE LO QUE YA EXISTE.
--
-- ===========================================================================
-- DECISION DEL CLIENTE (Gilmer, 2026-09-29)
-- ===========================================================================
-- Cada reconteo trae el stock NUEVO del ERP, y solo de los faltantes y
-- sobrantes que arrastra esa ronda. Hasta hoy habia UNA sola vara
-- (`catalogo_items.stock_erp`, congelada al abrir el mes) y las tres rondas se
-- comparaban contra ella: eso asume que entre el conteo del dia 22 y los
-- reconteos de los dias siguientes el ERP no se mueve, y se mueve -- ventas,
-- transferencias y los ajustes que el cliente parcha a mano con su hoja
-- NEGATIVO.
--
-- LO QUE LE CAMBIA AL RECONTEO, que es lo que hay que entender antes de leer
-- un numero de esta tabla: con stock nuevo por ronda el reconteo YA NO
-- VERIFICA al conteo anterior, es una medicion independiente. Un item con
-- "falta 1" el lunes puede salir cuadrado el martes sin que nadie toque el
-- estante, solo porque se vendio una unidad. Es lo que el cliente hace hoy en
-- su Excel.
--
-- ===========================================================================
-- ADITIVA. NO SE PISA NADA.
-- ===========================================================================
-- Una tabla nueva y un INSERT. `catalogo_items.stock_erp` NO se toca, no se
-- renombra y no cambia de significado: sigue siendo el stock de la RONDA 1 y
-- sigue siendo el que manda para esa ronda, porque lo leen el sello del
-- lacrado (`lacrados_inventario`) y los inventarios historicos. Romperlos no
-- es parte de este cambio.
--
-- La alternativa -- UPDATE de `catalogo_items.stock_erp` en cada descarga --
-- se descarto explicitamente: pisar la cifra deja a la ronda 1 sin
-- explicacion, porque el auditor veria el conteo viejo contra un stock que ya
-- no es el que mando ese item al reconteo.
--
-- ===========================================================================
-- LA MIGRACION DE DATOS, Y POR QUE VA EN LA MISMA MIGRACION
-- ===========================================================================
-- La ronda 1 de los inventarios QUE YA EXISTEN tiene que quedar escrita aca, o
-- todo lo que se midio en la ronda 1 se leeria como `sin_erp` -- el calculo
-- busca el stock de la ronda del conteo y no lo encontraria. Va en la misma
-- migracion y no en un script aparte por eso mismo: una tabla vacia entre el
-- CREATE y el relleno es una ventana en la que el inventario reporta "no se
-- puede auditar" sobre datos que si estan.
--
-- `stock_erp` SE COPIA TAL CUAL, NULL incluido: un item cuyo snapshot no trajo
-- stock queda con NULL aca tambien. Poner 0 seria afirmar "el ERP esperaba
-- cero" sobre un dato que nunca existio.
--
-- `tomado_en` sale del snapshot (`inventarios.snapshot_tomado_en`) y NO de
-- `now()`: es el instante en que esa cifra se bajo de Dynamics, y fecharla hoy
-- diria que la ronda 1 de mayo se descargo en septiembre. Cuando el inventario
-- no tiene el dato se cae a `catalogo_items.created_at`, que es cuando la fila
-- entro -- el mismo orden de preferencia que ya usa
-- `inventarios.service.ts#activo` para `tomadoEn`.
--
-- ON CONFLICT DO NOTHING: idempotente a proposito. Si esta migracion se
-- reaplica, o si el snapshot ya escribio su ronda 1, la fila existente manda y
-- este INSERT no la toca.

-- CreateTable
CREATE TABLE "stock_rondas" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "numero_conteo" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    -- NULLABLE Y SIN DEFAULT, igual que `catalogo_items.stock_erp` y por la
    -- misma razon: NULL es "el ERP no trajo stock para este item", que NO es 0.
    -- Un DEFAULT 0 haria que una descarga incompleta se leyera como "no deberia
    -- haber ninguno" y eso termina en el descuento del sueldo de alguien.
    "stock_erp" INTEGER,
    "tomado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_rondas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- UNA SOLA CIFRA POR (inventario, ronda, item): volver a bajar el stock de una
-- ronda actualiza la fila y no agrega una segunda. Con dos filas para la misma
-- ronda el calculo tendria que elegir, y esa eleccion no la puede tomar un
-- `ORDER BY`.
--
-- Es tambien EL INDICE DE LECTURA: las consultas filtran por `inventario_id` o
-- por `(inventario_id, numero_conteo)`, los dos prefijos de esta clave. No se
-- crea un indice aparte -- seria el mismo arbol escrito dos veces, y esta tabla
-- se escribe una vez por ronda para hasta 8.000 items.
CREATE UNIQUE INDEX "stock_rondas_inventario_id_numero_conteo_codigo_key" ON "stock_rondas"("inventario_id", "numero_conteo", "codigo");

-- AddForeignKey
ALTER TABLE "stock_rondas" ADD CONSTRAINT "stock_rondas_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DataMigration: la ronda 1 de todos los inventarios que ya existen.
INSERT INTO "stock_rondas" ("inventario_id", "numero_conteo", "codigo", "stock_erp", "tomado_en")
SELECT ci."inventario_id",
       1,
       ci."codigo",
       ci."stock_erp",
       COALESCE(i."snapshot_tomado_en", ci."created_at")
FROM "catalogo_items" ci
JOIN "inventarios" i ON i."id" = ci."inventario_id"
ON CONFLICT ("inventario_id", "numero_conteo", "codigo") DO NOTHING;
