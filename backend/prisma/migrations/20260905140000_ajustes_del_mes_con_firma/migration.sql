-- Quien cargo los ajustes del mes, cuando y por que.
--
-- ADITIVA: tres columnas nullables sobre resultados_inventario. Ninguna fila
-- existente cambia -- las que ya estan quedan con NULL, que es exactamente lo
-- que significan (nadie los cargo).
--
-- Por que llevan firma: monto_negativos y monto_faltante_empresa BAJAN el
-- faltante que se descuenta a nomina, o sea es plata que alguien decide no
-- cobrarle al personal. Si en tres meses alguien pregunta por que agosto tuvo
-- S/380 de ajustes, la respuesta tiene que estar en la fila.
ALTER TABLE "resultados_inventario"
  ADD COLUMN "ajustes_por_id" INTEGER,
  ADD COLUMN "ajustes_en" TIMESTAMP(3),
  ADD COLUMN "ajustes_nota" TEXT;

ALTER TABLE "resultados_inventario"
  ADD CONSTRAINT "resultados_inventario_ajustes_por_id_fkey"
  FOREIGN KEY ("ajustes_por_id") REFERENCES "colaboradores"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
