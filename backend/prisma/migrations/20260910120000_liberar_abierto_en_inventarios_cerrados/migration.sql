-- Migracion de DATOS (aditiva y segura, NO cambia el esquema): libera el flag
-- `abierto` de todo inventario que YA NO esta en curso.
--
-- Contexto (bug real 2026-09-10). Hasta el fix 28ba4de, `abierto` solo se
-- limpiaba al LACRAR (historial.service.ts#lacrar). Un inventario que cerraba
-- el conteo (estado -> conteo_cerrado) y esperaba dias la firma del auditor
-- quedaba con `abierto: true`. El cierre ya lo libera desde ese commit
-- (rondas.service.ts#cerrar), PERO las filas cerradas ANTES del fix -- el
-- inventario 34 y cualquier otra igual -- siguen con `abierto: true`, y el
-- INSERT del inventario del mes siguiente choca contra
-- @@unique([sucursal_id, abierto]) de esa fila vieja (sintoma en la app:
-- "No se pudo traer el catalogo" justo al cerrar el snapshot).
--
-- El flag solo es legal en `true` (abierto) o NULL (cerrado), nunca `false`
-- (ver Inventario.abierto en schema.prisma): por eso se pone NULL, no false.
-- Solo toca inventarios que NO estan en curso -- jamas uno en curso, para no
-- soltar el candado de "un solo inventario abierto por sucursal". Idempotente:
-- el `IS NOT NULL` excluye las filas ya cerradas, asi que re-correrla no hace
-- nada.
UPDATE "inventarios"
SET "abierto" = NULL
WHERE "estado" <> 'en_curso'
  AND "abierto" IS NOT NULL;
