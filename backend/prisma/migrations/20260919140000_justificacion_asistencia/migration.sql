-- EL AUDITOR JUSTIFICA UNA FALTA, y esa falta deja de cobrarse.
--
-- ADITIVA: una tabla nueva y una columna. No borra, no renombra, no cambia
-- ningun tipo y no toca una sola fila existente. Ningun inventario cambia de
-- monto por esta migracion: sin justificaciones cargadas, la cuenta nueva
-- (dias - asistidos - justificados) es identica a la vieja (dias - asistidos).
--
-- LA REGLA, textual del cliente: "si cobra el bono de distribucion, es como
-- si hubiera asistido". Un dia justificado vale como asistido para los DOS
-- efectos -- no paga multa por ese dia y, si con eso completa el inventario,
-- cobra el bono. No hay media medida.
--
-- POR QUE UNA TABLA APARTE Y NO UNA MARCA MAS EN asistencia_inventario:
-- porque `liquidaciones_colaborador.dias_asistidos` entra al SELLO del
-- lacrado, y ese sello existe para defender la planilla cuando alguien
-- reclama. Si las justificaciones se sumaran ahi, el documento afirmaria que
-- una persona estuvo un dia que no estuvo -- cuadraria la plata mintiendo
-- sobre el hecho. Se suman para la plata, nunca para el relato. El detalle
-- esta en el comentario del modelo, en schema.prisma.
--
-- LAS TRES FK EN RESTRICT, como todo el esquema: nada desaparece en silencio,
-- menos todavia el perdon de una multa. CONSECUENCIA para quien escriba un
-- script: esta es la DECIMA FK RESTRICT hacia "inventarios". Todo lo que
-- borre un inventario tiene que borrar sus justificaciones antes, o Postgres
-- lo frena con
--   violates RESTRICT setting of foreign key constraint
--   "justificaciones_asistencia_inventario_id_fkey"
-- En esta misma tanda se actualizaron scripts/limpiar-datos-dev.ts,
-- scripts/borrar-inventario.ts y prisma/reset-demo.ts. Y vale la misma
-- salvedad que con la novena: estas filas pueden existir en un inventario SIN
-- UN SOLO CONTEO.
--
-- `motivo` es NOT NULL SIN DEFAULT: no hay justificacion sin motivo, y no hay
-- un texto por defecto que sea honesto. La tabla nace vacia, asi que ninguna
-- fila queda sin el.
--
-- SE QUITO A MANO el ALTER de periodo_anio/periodo_mes que Prisma agrega
-- solo, igual que en 20260907151454_indices_rendimiento.

-- AlterTable
-- 0 = "no hubo justificaciones". A diferencia de dias_asistidos, aca el 0 de
-- las planillas viejas NO miente: antes de esta migracion no existia el
-- perdon, asi que nadie tenia dias justificados.
ALTER TABLE "liquidaciones_colaborador" ADD COLUMN     "dias_justificados" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
-- "dia" es DATE y no TIMESTAMP por lo mismo que en asistencia_inventario: lo
-- que se perdona es la jornada, no un instante. Los dos tienen que ser del
-- mismo tipo para poder cruzarse dia a dia.
CREATE TABLE "justificaciones_asistencia" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "colaborador_id" INTEGER NOT NULL,
    "dia" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "justificado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justificado_por_id" INTEGER NOT NULL,

    CONSTRAINT "justificaciones_asistencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- UN perdon por persona y dia: sin esto, dos justificaciones del mismo dia le
-- descontarian DOS dias de multa a alguien que falto uno solo, y la multa
-- podria irse por debajo de lo que corresponde sin que nada lo note.
CREATE UNIQUE INDEX "justificaciones_asistencia_inventario_id_colaborador_id_dia_key" ON "justificaciones_asistencia"("inventario_id", "colaborador_id", "dia");

-- AddForeignKey
ALTER TABLE "justificaciones_asistencia" ADD CONSTRAINT "justificaciones_asistencia_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "justificaciones_asistencia" ADD CONSTRAINT "justificaciones_asistencia_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Quien firma el perdon. El @@unique no lo incluye a proposito: si dos
-- auditores justifican el mismo dia de la misma persona, es LA MISMA falta
-- perdonada -- gana el primero y el segundo no agrega nada.
ALTER TABLE "justificaciones_asistencia" ADD CONSTRAINT "justificaciones_asistencia_justificado_por_id_fkey" FOREIGN KEY ("justificado_por_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
