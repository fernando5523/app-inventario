-- Aditiva: clasificacion completa del responsable de cada item de catalogo
-- (empleado / empresa / desconocido = NULL), sacada de TRU_InventoryManagerPE
-- (D365, data entity TRU_InventoryManagerPEEntities).
--
-- NO reemplaza a "es_empresa" -- esa columna sigue existiendo y no se toca
-- (la sigue usando auditoria.calculos.ts). "es_empresa" es un booleano que
-- colapsa 'Employee' y 'None' en el mismo "false"; el export de diferencias
-- necesita distinguirlos para EXCLUIR del reporte tanto lo de la empresa
-- como lo desconocido (solo entra 'empleado'). Ver el comentario de
-- CatalogoItem.responsable en schema.prisma.
--
-- Columna NULLABLE, sin DEFAULT que invente un valor: un item ya guardado
-- antes de esta migracion queda en NULL (desconocido), nunca en 'empleado'
-- ni 'empresa' por accidente.
CREATE TYPE "responsable_item" AS ENUM ('empleado', 'empresa');

ALTER TABLE "catalogo_items" ADD COLUMN "responsable" "responsable_item";
