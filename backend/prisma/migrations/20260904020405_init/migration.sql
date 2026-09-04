-- CreateEnum
CREATE TYPE "rol" AS ENUM ('administrador', 'coordinador', 'conteo', 'auditor');

-- CreateEnum
CREATE TYPE "tipo_configuracion" AS ENUM ('entero', 'decimal', 'texto');

-- CreateEnum
CREATE TYPE "estado_hoja" AS ENUM ('pendiente', 'en-proceso', 'finalizada');

-- CreateEnum
CREATE TYPE "estado_sync" AS ENUM ('local', 'sincronizando', 'sincronizado', 'error');

-- CreateEnum
CREATE TYPE "estado_inventario" AS ENUM ('en_curso', 'conteo_cerrado', 'liquidado', 'lacrado', 'anulado');

-- CreateTable
CREATE TABLE "sucursales" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "direccion" TEXT,
    "telefono" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "rol" "rol" NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "sucursal_id" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_por_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "tipo" "tipo_configuracion" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuraciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_auditoria" (
    "id" SERIAL NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" INTEGER NOT NULL,
    "detalle" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones_token" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "colaborador_id" INTEGER NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventarios" (
    "id" SERIAL NOT NULL,
    "sucursal_id" INTEGER NOT NULL,
    "estado" "estado_inventario" NOT NULL DEFAULT 'en_curso',
    "periodo_anio" INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int,
    "periodo_mes" INTEGER NOT NULL DEFAULT EXTRACT(MONTH FROM now())::int,
    "tamano_hoja" INTEGER NOT NULL DEFAULT 50,
    "snapshot_items" INTEGER,
    "snapshot_tomado_en" TIMESTAMP(3),
    "abierto_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrado_en" TIMESTAMP(3),
    "cerrado_por_id" INTEGER,
    "abierto" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogo_items" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "codigo_barras" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "empaque_nombre" TEXT NOT NULL,
    "empaque_factor" INTEGER NOT NULL,
    "empaque_codigo_barras" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalogo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hojas_conteo" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "numero_conteo" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "zona" TEXT NOT NULL,
    "gondola" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "estado" "estado_hoja" NOT NULL DEFAULT 'pendiente',
    "sync" "estado_sync" NOT NULL DEFAULT 'local',
    "asignado_a_id" INTEGER,
    "asignado_a_2_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hojas_conteo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" SERIAL NOT NULL,
    "hoja_id" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "codigo_barras" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "ubicacion" TEXT,
    "empaque_nombre" TEXT NOT NULL,
    "empaque_factor" INTEGER NOT NULL,
    "empaque_codigo_barras" TEXT,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conteos" (
    "id" SERIAL NOT NULL,
    "hoja_id" INTEGER NOT NULL,
    "producto_id" INTEGER NOT NULL,
    "empaques" INTEGER NOT NULL,
    "sueltas" INTEGER NOT NULL,
    "confirmado_por_escaner" BOOLEAN NOT NULL DEFAULT false,
    "contado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conteos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lacrados_inventario" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "folio" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "hash_algoritmo" TEXT NOT NULL DEFAULT 'sha256',
    "contenido" JSONB NOT NULL,
    "lacrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lacrado_por_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lacrados_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_erp_inventario" (
    "id" SERIAL NOT NULL,
    "lacrado_id" INTEGER NOT NULL,
    "referencia" TEXT,
    "registrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registrado_por_id" INTEGER NOT NULL,

    CONSTRAINT "registros_erp_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aprobaciones_cierre" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "aprobador_id" INTEGER NOT NULL,
    "rol_al_aprobar" "rol" NOT NULL,
    "aprobado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nota" TEXT,

    CONSTRAINT "aprobaciones_cierre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultados_inventario" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "items_totales" INTEGER NOT NULL,
    "items_con_diferencia" INTEGER NOT NULL,
    "items_segundo_conteo" INTEGER NOT NULL,
    "items_tercer_conteo" INTEGER NOT NULL,
    "unidades_faltantes" INTEGER NOT NULL,
    "unidades_sobrantes" INTEGER NOT NULL,
    "monto_faltante_bruto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monto_negativos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monto_faltante_empresa" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "colaboradores_alcanzados" INTEGER NOT NULL,
    "colaboradores_asistieron" INTEGER NOT NULL,
    "multa_inasistencia" DECIMAL(12,2) NOT NULL DEFAULT 20,
    "calculado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diferencias_item" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "stock_sistema" INTEGER NOT NULL,
    "conteo_final" INTEGER NOT NULL,
    "diferencia" INTEGER NOT NULL,
    "resuelto_en_conteo" INTEGER NOT NULL,
    "costo_unitario" DECIMAL(12,4),
    "monto_diferencia" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diferencias_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones_colaborador" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "colaborador_id" INTEGER NOT NULL,
    "nombre_al_liquidar" TEXT NOT NULL,
    "rol_al_liquidar" "rol" NOT NULL,
    "asistio" BOOLEAN NOT NULL,
    "cuota_base" DECIMAL(12,2) NOT NULL,
    "multa_inasistencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bono_asistencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidaciones_colaborador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_sucursal_id_dni_key" ON "colaboradores"("sucursal_id", "dni");

-- CreateIndex
CREATE UNIQUE INDEX "configuraciones_clave_key" ON "configuraciones"("clave");

-- CreateIndex
CREATE INDEX "registro_auditoria_entidad_entidad_id_idx" ON "registro_auditoria"("entidad", "entidad_id");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_token_token_key" ON "sesiones_token"("token");

-- CreateIndex
CREATE INDEX "inventarios_sucursal_id_estado_idx" ON "inventarios"("sucursal_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "inventarios_sucursal_id_periodo_anio_periodo_mes_key" ON "inventarios"("sucursal_id", "periodo_anio", "periodo_mes");

-- CreateIndex
CREATE UNIQUE INDEX "inventarios_sucursal_id_abierto_key" ON "inventarios"("sucursal_id", "abierto");

-- CreateIndex
CREATE INDEX "catalogo_items_inventario_id_codigo_barras_idx" ON "catalogo_items"("inventario_id", "codigo_barras");

-- CreateIndex
CREATE UNIQUE INDEX "catalogo_items_inventario_id_codigo_key" ON "catalogo_items"("inventario_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "hojas_conteo_inventario_id_numero_conteo_numero_key" ON "hojas_conteo"("inventario_id", "numero_conteo", "numero");

-- CreateIndex
CREATE INDEX "productos_hoja_id_codigo_barras_idx" ON "productos"("hoja_id", "codigo_barras");

-- CreateIndex
CREATE UNIQUE INDEX "productos_hoja_id_codigo_key" ON "productos"("hoja_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "conteos_hoja_id_producto_id_key" ON "conteos"("hoja_id", "producto_id");

-- CreateIndex
CREATE UNIQUE INDEX "lacrados_inventario_inventario_id_key" ON "lacrados_inventario"("inventario_id");

-- CreateIndex
CREATE UNIQUE INDEX "lacrados_inventario_folio_key" ON "lacrados_inventario"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "lacrados_inventario_hash_key" ON "lacrados_inventario"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "registros_erp_inventario_lacrado_id_key" ON "registros_erp_inventario"("lacrado_id");

-- CreateIndex
CREATE UNIQUE INDEX "aprobaciones_cierre_inventario_id_aprobador_id_key" ON "aprobaciones_cierre"("inventario_id", "aprobador_id");

-- CreateIndex
CREATE UNIQUE INDEX "resultados_inventario_inventario_id_key" ON "resultados_inventario"("inventario_id");

-- CreateIndex
CREATE INDEX "diferencias_item_codigo_idx" ON "diferencias_item"("codigo");

-- CreateIndex
CREATE INDEX "diferencias_item_inventario_id_diferencia_idx" ON "diferencias_item"("inventario_id", "diferencia");

-- CreateIndex
CREATE UNIQUE INDEX "diferencias_item_inventario_id_codigo_key" ON "diferencias_item"("inventario_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_colaborador_inventario_id_colaborador_id_key" ON "liquidaciones_colaborador"("inventario_id", "colaborador_id");

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_token" ADD CONSTRAINT "sesiones_token_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_cerrado_por_id_fkey" FOREIGN KEY ("cerrado_por_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_items" ADD CONSTRAINT "catalogo_items_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hojas_conteo" ADD CONSTRAINT "hojas_conteo_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hojas_conteo" ADD CONSTRAINT "hojas_conteo_asignado_a_id_fkey" FOREIGN KEY ("asignado_a_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hojas_conteo" ADD CONSTRAINT "hojas_conteo_asignado_a_2_id_fkey" FOREIGN KEY ("asignado_a_2_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_hoja_id_fkey" FOREIGN KEY ("hoja_id") REFERENCES "hojas_conteo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_hoja_id_fkey" FOREIGN KEY ("hoja_id") REFERENCES "hojas_conteo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lacrados_inventario" ADD CONSTRAINT "lacrados_inventario_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lacrados_inventario" ADD CONSTRAINT "lacrados_inventario_lacrado_por_id_fkey" FOREIGN KEY ("lacrado_por_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_erp_inventario" ADD CONSTRAINT "registros_erp_inventario_lacrado_id_fkey" FOREIGN KEY ("lacrado_id") REFERENCES "lacrados_inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_erp_inventario" ADD CONSTRAINT "registros_erp_inventario_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones_cierre" ADD CONSTRAINT "aprobaciones_cierre_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones_cierre" ADD CONSTRAINT "aprobaciones_cierre_aprobador_id_fkey" FOREIGN KEY ("aprobador_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_inventario" ADD CONSTRAINT "resultados_inventario_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diferencias_item" ADD CONSTRAINT "diferencias_item_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones_colaborador" ADD CONSTRAINT "liquidaciones_colaborador_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones_colaborador" ADD CONSTRAINT "liquidaciones_colaborador_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
