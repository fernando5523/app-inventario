-- ASISTENCIA REGISTRADA POR EL COORDINADOR, y multa POR DIA.
--
-- ADITIVA: una tabla nueva y una columna nueva. No borra, no renombra y no
-- cambia el tipo de nada que ya exista. Generada con `prisma migrate diff`
-- (base -> schema nuevo), sin tocar la base.
--
-- Revierte el acuerdo que documentaba la migracion
-- 20260905045306_resultado_inventario_asistencia_no_capturada: la asistencia
-- se deducia de las hojas ("tenes una hoja con al menos un conteo, entonces
-- viniste") y eso le cobraba multa a quien vino y no llego a cargar un
-- renglon. Ahora hay registro manual, por dia, con hora y con autor.
--
-- Lo que agrega (el porque de cada campo esta en schema.prisma):
--   asistencia_inventario                        una marca de entrada por persona y dia
--   resultados_inventario.dias_del_inventario    duracion congelada al cerrar el conteo
--
-- SIN RELLENO PARA ATRAS, a proposito. Los inventarios ya cerrados quedan con
-- dias_del_inventario = 0 y sin marcas, y con 0 dias la formula nueva
-- ((dias - asistidos) * tarifa) da multa 0 -- que es lo correcto: sus
-- planillas ya se firmaron con la regla vieja y sus montos viven congelados
-- en liquidaciones_colaborador, no se recalculan desde aca. Quien quiera
-- reconstruir esas marcas a partir de los conteos corre
-- `npx tsx prisma/rellenar-asistencia.ts`, que es un paso APARTE y opcional,
-- con --dry-run: reconstruir asistencia es una suposicion sobre el pasado y
-- no puede ir escondida dentro de una migracion.
--
-- NO cambia `multa_inasistencia`, ni su tipo ni su valor, pero SI cambia lo
-- que significa: era el monto total que pagaba un ausente, pasa a ser la
-- TARIFA POR DIA. Los inventarios viejos guardan 20 con el sentido viejo y no
-- se reinterpretan porque su dias_del_inventario es 0.
--
-- SE QUITO A MANO de este archivo el `ALTER TABLE "inventarios" ALTER COLUMN
-- periodo_anio/periodo_mes SET DEFAULT ...` que Prisma agrega solo (siempre
-- regenera los `dbgenerated()` porque no puede compararlos contra la base).
-- Misma decision, y por lo mismo, que en 20260907151454_indices_rendimiento.

-- AlterTable
-- NOT NULL con DEFAULT 0: la columna entra sin reescribir la tabla y las filas
-- que ya estaban quedan en 0 = "se cerro cuando la asistencia se deducia de
-- las hojas". Ver el comentario del campo en schema.prisma: aca 0 no es
-- "duro cero dias", es "esto no se midio".
ALTER TABLE "resultados_inventario" ADD COLUMN     "dias_del_inventario" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
-- "dia" es DATE y no TIMESTAMP a proposito: lo que se cobra es la jornada, no
-- un instante. Con timestamp, dos marcas del mismo dia cargadas a las 08:00 y
-- a las 20:00 serian dias distintos y le regalarian un dia de asistencia a
-- alguien. La hora del registro viaja aparte, en "registrado_en".
--
-- SIN FOREIGN KEYS, y es la unica tabla del schema asi: las tres columnas de
-- id van peladas por el contrato acordado para este cambio. La consecuencia
-- queda anotada donde se ve (schema.prisma, modelo AsistenciaInventario):
-- nada impide una marca de un inventario inexistente y nada se borra en
-- cascada. Agregarlas despues es otro ALTER TABLE aditivo.
CREATE TABLE "asistencia_inventario" (
    "id" SERIAL NOT NULL,
    "inventario_id" INTEGER NOT NULL,
    "colaborador_id" INTEGER NOT NULL,
    "dia" DATE NOT NULL,
    "registrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registrado_por_id" INTEGER NOT NULL,

    CONSTRAINT "asistencia_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- UNA marca por persona y dia: hace la carga idempotente (el Coordinador
-- puede tocar el boton dos veces sin que a nadie le sobren dias) y es ademas
-- el indice que usan las dos consultas de la tabla, que siempre arrancan por
-- inventario_id -- regla del prefijo izquierdo, igual que en "conteos".
CREATE UNIQUE INDEX "asistencia_inventario_inventario_id_colaborador_id_dia_key" ON "asistencia_inventario"("inventario_id", "colaborador_id", "dia");
