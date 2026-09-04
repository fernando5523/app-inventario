-- INMUTABILIDAD DEL LACRADO, A NIVEL BASE DE DATOS.
--
-- El schema de Prisma ya sostiene el cierre por estructura (1:1 con el
-- inventario, sin `updated_at`, hash verificable) y la capa de aplicacion lo
-- sostiene con historial.permisos.ts#verificarNoLacrado. Falta el nivel que
-- Prisma no sabe declarar y es el unico que vale contra alguien que escribe
-- directo en la tabla: que Postgres mismo rechace el UPDATE y el DELETE.
--
-- Sin esto, "el inventario lacrado es inmutable" es una promesa del codigo.
-- Con esto, es una propiedad de la base. Es la diferencia entre un control y
-- un cartel -- y este es el acto que cierra el mes y se audita.
--
-- Es exactamente lo que pidio el cliente en la reunion: un ajuste posterior
-- al cierre "va a distorsionar todo el tema del historico", hay que
-- "regularizarlo de ahi hacia adelante" (docs/pantallas.md, Pantalla 7).

CREATE OR REPLACE FUNCTION impedir_modificacion_lacrado()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'El lacrado del inventario % es inmutable: no se puede % (folio %). Cualquier ajuste entra en el periodo siguiente.',
    OLD.inventario_id, TG_OP, OLD.folio
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- Solo UPDATE y DELETE: el INSERT es como nace un sello, y tiene que seguir
-- funcionando.
CREATE TRIGGER lacrado_inmutable
  BEFORE UPDATE OR DELETE ON "lacrados_inventario"
  FOR EACH ROW EXECUTE FUNCTION impedir_modificacion_lacrado();

-- Las aprobaciones que habilitaron ese cierre tampoco se reescriben: si se
-- pudiera cambiar el `aprobador_id` de una firma despues del lacrado, el
-- control de dos personas se podria falsificar hacia atras -- que es
-- justamente el agujero que este trabajo vino a cerrar. Se permite el DELETE
-- (una firma se puede retirar ANTES de lacrar; despues del lacrado la fila
-- ya esta dentro del hash y borrarla lo delata en la verificacion).
CREATE OR REPLACE FUNCTION impedir_modificacion_aprobacion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'La aprobacion del inventario % (aprobador %) no se puede modificar: una firma se retira o se agrega, nunca se reescribe.',
    OLD.inventario_id, OLD.aprobador_id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aprobacion_inmutable
  BEFORE UPDATE ON "aprobaciones_cierre"
  FOR EACH ROW EXECUTE FUNCTION impedir_modificacion_aprobacion();
