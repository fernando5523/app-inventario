-- AlterTable
ALTER TABLE "inventarios" ALTER COLUMN "periodo_anio" SET DEFAULT EXTRACT(YEAR FROM now())::int,
ALTER COLUMN "periodo_mes" SET DEFAULT EXTRACT(MONTH FROM now())::int;
