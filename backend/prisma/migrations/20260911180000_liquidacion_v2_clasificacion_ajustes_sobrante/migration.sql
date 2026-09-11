-- Liquidacion v2, FASE 0: solo esquema. ADITIVA: 3 columnas nuevas y 3 tablas
-- nuevas. No borra, no renombra y no cambia el tipo de nada que ya exista.
-- Generada con `prisma migrate diff` (schema anterior -> schema nuevo), sin
-- tocar la base, mas el relleno de datos de diferencias_item.es_empresa.
--
-- Lo que agrega (ver los comentarios de cada modelo en schema.prisma):
--   catalogo_items.es_empresa_manual       excepcion del Auditor, congelada en el snapshot
--   resultados_inventario.monto_sobrante_empleado   sobrante a favor del personal
--   diferencias_item.es_empresa            clasificacion efectiva, congelada al cierre
--   clasificaciones_producto               excepcion viva, por codigo
--   importaciones_ajustes_dynamics         cabecera del Excel de ajustes
--   lineas_ajuste_dynamics                 filas del Excel, con exclusion firmada
--
-- Asistencia NO entra aca: la regla de la multa espera respuestas del cliente.

-- AlterTable
-- NULL = sin excepcion (manda es_empresa de Dynamics). Sin DEFAULT: ningun item
-- ya guardado queda "reclasificado" por accidente.
ALTER TABLE "catalogo_items" ADD COLUMN     "es_empresa_manual" BOOLEAN;

-- AlterTable
-- NULL y SIN relleno: los inventarios ya cerrados no tenian este dato, y el
-- historico RECALCULA el neto en cada lectura (historial.service.ts
-- #resumirResultado). Rellenarlo cambiaria el neto que muestra un inventario
-- ya liquidado. NULL = "se cerro antes de la regla", distinto de 0.
ALTER TABLE "resultados_inventario" ADD COLUMN     "monto_sobrante_empleado" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "diferencias_item" ADD COLUMN     "es_empresa" BOOLEAN NOT NULL DEFAULT false;

-- Relleno de las filas existentes con el es_empresa de SU CatalogoItem (mismo
-- inventario, mismo codigo). No es una suposicion: es exactamente el valor con
-- el que ese cierre armo la matriz (auditoria.service.ts lee
-- CatalogoItem.esEmpresa) y calculo monto_faltante_empresa, asi que la
-- diferencia y el resultado del mismo inventario no pueden discrepar.
-- es_empresa_manual no existia, asi que la clasificacion efectiva de entonces
-- era es_empresa a secas. Una diferencia sin CatalogoItem (no deberia haber:
-- la matriz sale del catalogo) conserva el DEFAULT false. Idempotente.
UPDATE "diferencias_item" d
SET "es_empresa" = c."es_empresa"
FROM "catalogo_items" c
WHERE c."inventario_id" = d."inventario_id"
  AND c."codigo" = d."codigo";

-- CreateTable
CREATE TABLE "clasificaciones_producto" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "es_empresa" BOOLEAN NOT NULL,
    "nota" TEXT,
    "clasificado_por_id" INTEGER NOT NULL,
    "clasificado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clasificaciones_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importaciones_ajustes_dynamics" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "importado_por_id" INTEGER NOT NULL,
    "importado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente" BOOLEAN DEFAULT true,

    CONSTRAINT "importaciones_ajustes_dynamics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas_ajuste_dynamics" (
    "id" SERIAL NOT NULL,
    "importacion_id" INTEGER NOT NULL,
    "fila" INTEGER NOT NULL,
    "diario" TEXT,
    "descripcion" TEXT,
    "almacen" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre2" TEXT,
    "cantidad" DECIMAL(12,4),
    "precio" DECIMAL(12,4),
    "importe" DECIMAL(12,2) NOT NULL,
    "motivo_ajuste" TEXT,
    "registrado_en" TIMESTAMP(3),
    "responsable" TEXT,
    "excluida" BOOLEAN NOT NULL DEFAULT false,
    "excluida_por_id" INTEGER,
    "excluida_en" TIMESTAMP(3),
    "motivo_exclusion" TEXT,

    CONSTRAINT "lineas_ajuste_dynamics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clasificaciones_producto_codigo_key" ON "clasificaciones_producto"("codigo");

-- CreateIndex
-- A lo sumo UNA importacion vigente por inventario: "vigente" es true o NULL,
-- nunca false, y Postgres trata cada NULL como distinto (mismo patron que
-- inventarios.abierto).
CREATE UNIQUE INDEX "importaciones_ajustes_dynamics_inventario_id_vigente_key" ON "importaciones_ajustes_dynamics"("inventario_id", "vigente");

-- CreateIndex
CREATE UNIQUE INDEX "lineas_ajuste_dynamics_importacion_id_fila_key" ON "lineas_ajuste_dynamics"("importacion_id", "fila");

-- AddForeignKey
ALTER TABLE "clasificaciones_producto" ADD CONSTRAINT "clasificaciones_producto_clasificado_por_id_fkey" FOREIGN KEY ("clasificado_por_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importaciones_ajustes_dynamics" ADD CONSTRAINT "importaciones_ajustes_dynamics_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importaciones_ajustes_dynamics" ADD CONSTRAINT "importaciones_ajustes_dynamics_importado_por_id_fkey" FOREIGN KEY ("importado_por_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_ajuste_dynamics" ADD CONSTRAINT "lineas_ajuste_dynamics_importacion_id_fkey" FOREIGN KEY ("importacion_id") REFERENCES "importaciones_ajustes_dynamics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_ajuste_dynamics" ADD CONSTRAINT "lineas_ajuste_dynamics_excluida_por_id_fkey" FOREIGN KEY ("excluida_por_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
