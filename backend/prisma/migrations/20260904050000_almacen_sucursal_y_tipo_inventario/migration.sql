-- Tres cambios que van juntos porque los tres salen de la misma decision del
-- cliente sobre como se configura y se cuenta un inventario.
--
-- 1. EL ALMACEN ES UN ATRIBUTO DE LA SUCURSAL.
--    Decision textual del cliente: "al crear el sitio, se debe asociar el
--    almacen". No una tabla de traduccion sucursal->almacen que alguien
--    tiene que mantener sincronizada a mano, sino un dato que se elige
--    cuando se da de alta la tienda.
--
--    NULLABLE: null significa "todavia no sabemos cual es", que es la verdad
--    para las 4 tiendas ya cargadas. Rellenarlas con un placeholder seria
--    peor que dejarlas vacias -- un almacen inventado trae el stock de OTRA
--    tienda, la auditoria compara contra numeros que parecen validos, y
--    nadie se entera hasta que no cuadra a fin de mes. Mismo criterio que
--    catalogo_items.stock_erp: "no se" no se escribe como un valor.
--
-- 2. EL TIPO DE INVENTARIO (mensual / anual).
--    Son dos universos distintos, confirmados por el cliente: el mensual
--    cuenta solo los productos de responsabilidad del empleado (6.297 de
--    11.835); el anual cuenta todo. Default `mensual`: es el que se hace
--    todos los meses, el anual hay que pedirlo explicito.
--
-- 3. LAS DOS RESTRICCIONES UNICAS, ajustadas de forma ASIMETRICA.
--    `tipo` entra en la de periodo y NO en la de "abierto". El por que esta
--    al lado de cada una, abajo.

-- ---------------------------------------------------------------------------
-- 1. Almacen de la sucursal
-- ---------------------------------------------------------------------------

ALTER TABLE "sucursales"
  ADD COLUMN "almacen_id"     TEXT,
  ADD COLUMN "almacen_nombre" TEXT;

-- ---------------------------------------------------------------------------
-- 2. Tipo de inventario
-- ---------------------------------------------------------------------------

CREATE TYPE "tipo_inventario" AS ENUM ('mensual', 'anual');

-- NOT NULL con default: los inventarios que ya existen son todos mensuales
-- (es lo unico que se hizo hasta hoy), asi que el default los clasifica
-- correctamente sin necesidad de un backfill a mano.
ALTER TABLE "inventarios"
  ADD COLUMN "tipo" "tipo_inventario" NOT NULL DEFAULT 'mensual';

-- ---------------------------------------------------------------------------
-- 3. Las restricciones
-- ---------------------------------------------------------------------------

-- La de PERIODO suma `tipo`: el anual de 2026 y el mensual de diciembre 2026
-- son dos cierres distintos del mismo periodo y los dos tienen que poder
-- existir en el historico. Sin `tipo`, el segundo chocaria contra el primero
-- y no se podria archivar el anual.
DROP INDEX "inventarios_sucursal_id_periodo_anio_periodo_mes_key";
CREATE UNIQUE INDEX "inventarios_sucursal_id_periodo_anio_periodo_mes_tipo_key"
  ON "inventarios"("sucursal_id", "periodo_anio", "periodo_mes", "tipo");

-- La de ABIERTO **no se toca**: sigue siendo (sucursal_id, abierto), sin
-- `tipo`. Un solo inventario abierto por sucursal, del tipo que sea.
--
-- El anual es un superconjunto del mensual (11.835 items contra 6.297). Si
-- los dos pudieran estar abiertos a la vez, los mismos productos se estarian
-- contando en dos inventarios simultaneos con conteos que pueden diferir; y
-- si los dos llegan a liquidarse, al empleado se le descuenta DOS VECES el
-- mismo faltante. Ademas son once personas en la tienda: no pueden hacer dos
-- inventarios a la vez. La restriccion no restringe de mas -- dice lo que el
-- negocio necesita: primero se cierra uno, despues se abre el otro.

CREATE INDEX "inventarios_sucursal_id_tipo_idx" ON "inventarios"("sucursal_id", "tipo");
