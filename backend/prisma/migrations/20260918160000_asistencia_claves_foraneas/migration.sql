-- LAS CLAVES FORANEAS QUE LE FALTABAN A asistencia_inventario.
--
-- ADITIVA: tres constraints. No borra, no renombra, no cambia ningun tipo y
-- no toca una sola fila.
--
-- QUE PASO: la tabla nacio en 20260918120000_asistencia_registrada_por_dia
-- con los tres ids PELADOS, sin relaciones de Prisma y por lo tanto sin FK.
-- Era la unica tabla del esquema asi. Quedaba documentado como decision
-- pendiente en el modelo, y esta migracion la cierra: la base pasa a impedir
-- una marca de un inventario o de un colaborador que no existen, en vez de
-- confiar en que la capa de aplicacion no se equivoque nunca.
--
-- APLICA LIMPIA sobre los datos que ya hay: se verificaron las 10 marcas
-- existentes (inventarios 8021..8024) contra inventarios y colaboradores y no
-- hay una sola huerfana. Postgres valida las filas actuales al crear cada
-- constraint; si hubiera una rota, la migracion fallaria en vez de aceptar el
-- dato malo, que es lo que corresponde.
--
-- RESTRICT Y NO CASCADE, en las tres, que es el criterio del resto del
-- esquema: nada desaparece en silencio. La asistencia decide multa y bono, o
-- sea plata; si algun dia alguien intenta borrar un inventario o una persona
-- que tienen marcas, la base tiene que FRENARLO y obligar a mirar, no barrer
-- las marcas por debajo y dejar una liquidacion que ya no se puede explicar.
-- El costo aceptado es el de siempre: los scripts que borran inventarios
-- tienen que borrar las marcas antes, a mano y en orden.
--
-- CONSECUENCIA, y hay que tenerla presente al escribir cualquier script:
-- esta es la NOVENA FK RESTRICT hacia "inventarios". Es el mismo bug que dejo
-- la octava (importaciones_ajustes_dynamics): los borradores de inventarios
-- empiezan a morir con
--   violates RESTRICT setting of foreign key constraint
--   "asistencia_inventario_inventario_id_fkey"
-- hasta que se los actualiza. En esta misma tanda se cubrieron
-- scripts/limpiar-datos-dev.ts, scripts/borrar-inventario.ts y
-- prisma/reset-demo.ts.
--
-- Y una diferencia con las otras ocho que importa para esos scripts: estas
-- marcas pueden existir en un inventario SIN UN SOLO CONTEO, porque el
-- Coordinador pasa lista cuando la gente llega, no cuando termina de contar.
-- Un "si no tiene conteos no tiene nada colgando" ya no es cierto.
--
-- SE QUITO A MANO el ALTER de periodo_anio/periodo_mes que Prisma agrega
-- solo, igual que en 20260907151454_indices_rendimiento.

-- AddForeignKey
ALTER TABLE "asistencia_inventario" ADD CONSTRAINT "asistencia_inventario_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- A quien se le marco la entrada.
ALTER TABLE "asistencia_inventario" ADD CONSTRAINT "asistencia_inventario_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Quien la cargo. RESTRICT y no SET NULL -- a diferencia de
-- resultados_inventario.ajustes_por_id, que si admite NULL -- porque esta
-- columna es NOT NULL: una marca sin autor no es un estado valido al que se
-- pueda degradar la fila.
ALTER TABLE "asistencia_inventario" ADD CONSTRAINT "asistencia_inventario_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "colaboradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
