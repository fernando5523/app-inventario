-- AlterTable
ALTER TABLE "inventarios" ALTER COLUMN "periodo_anio" SET DEFAULT EXTRACT(YEAR FROM now())::int,
ALTER COLUMN "periodo_mes" SET DEFAULT EXTRACT(MONTH FROM now())::int;

-- AlterTable
ALTER TABLE "resultados_inventario" ALTER COLUMN "monto_negativos" DROP NOT NULL,
ALTER COLUMN "monto_negativos" DROP DEFAULT,
ALTER COLUMN "colaboradores_asistieron" DROP NOT NULL;
