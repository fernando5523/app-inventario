-- FALTANTE POR PAQUETE: los DATOS que la regla necesita.
--
-- ADITIVA: un enum y cinco columnas. No borra, no renombra, no cambia ningun
-- tipo y no toca una sola fila existente. El calculo en si NO entra aca --
-- esta migracion deja el insumo, nada mas.
--
-- LA REGLA (Gilmer, reunion 2): si falta MENOS de la mitad del paquete se le
-- descuenta al trabajador; si falta MAS de la mitad, sale del descuento al
-- personal y va al cuadro de faltante por paquete, que se audita aparte y
-- quizas se le descuenta al almacenero.
--
-- ===========================================================================
-- LA COMPUERTA QUE SE VERIFICO ANTES DE ESCRIBIR ESTO
-- ===========================================================================
-- El umbral se mide contra el EMPAQUE DE COMPRA, no el de venta. Gilmer fue
-- explicito tres veces. Ese dato NO se estaba trayendo, asi que lo primero
-- fue comprobar que existe en el ERP (scripts/explorar-empaque-compra.ts,
-- solo lectura contra el tenant real):
--
--   - `ReleasedProductsV2.PurchaseUnitSymbol` da el NOMBRE ("Emp.12");
--   - `ProductSpecificUnitOfMeasureConversions` da el FACTOR de ese simbolo
--     A LA UNIDAD BASE -- y hay que pedir esa, porque un mismo simbolo tiene
--     varias filas (Emp.48->Emp.12=4 y Emp.48->U=48) y la que sirve es la que
--     va a la unidad suelta, que es en la que se cuenta.
--
-- Medido sobre 2.000 items reales: 1.950 tienen el factor de compra; 1.486
-- tienen empaque de compra distinto del de venta; y en 328 el empaque de
-- compra NO COINCIDE con el que el catalogo guarda hoy (item 110628: compra
-- 24 contra 36; item 100000: compra 6 contra 12). O sea que medir el umbral
-- con los empaques que ya teniamos le cambiaria el descuento a uno de cada
-- seis items.
--
-- ===========================================================================
-- LO QUE AGREGA
-- ===========================================================================
--   clase_item                                enum de TRES vias
--   catalogo_items.empaque_compra             el denominador del umbral
--   catalogo_items.empaque_compra_simbolo     de donde salio, para auditarlo
--   catalogo_items.clase                      empresa | paquete | unidad
--   clasificaciones_producto.clase            la excepcion del Auditor, a 3 vias
--   diferencias_item.clase                    la clase con la que se liquido
--   inventarios.umbral_media_unidad_paquete   LA PERILLA, CABLEADA
--
-- Sobre la ultima: `UMBRAL_MEDIA_UNIDAD_PAQUETE` ya se validaba, se guardaba
-- y se editaba desde la pantalla del Administrador, pero ningun calculo la
-- leia -- estaba la perilla y no el mecanismo. Se copia al inventario al
-- abrirlo, igual que `tamano_hoja`: el historico tiene que poder decir con
-- que umbral se decidio cada descuento, y no con el de hoy.
--
-- `clase` en catalogo_items es NOT NULL DEFAULT 'unidad' y las otras dos son
-- NULLABLE, y la asimetria es deliberada. En el catalogo, `unidad` es el
-- tratamiento de SIEMPRE (se descuenta al personal), asi que las filas viejas
-- quedan describiendo exactamente lo que se les hizo. En las otras dos, NULL
-- significa "esto se decidio con la regla de dos vias, manda es_empresa" --
-- rellenarlas afirmaria una regla que en ese momento no existia.
--
-- `es_empresa` NO se toca ni se reemplaza todavia: la leen la auditoria, la
-- liquidacion y el SELLO del lacrado. Mientras las dos columnas convivan,
-- `clase = 'empresa'` y `es_empresa = true` son el mismo hecho y las escribe
-- el mismo snapshot -- no pueden discrepar. Sacar el booleano es parte del
-- cambio del calculo, no de este.
--
-- SE QUITO A MANO el ALTER de periodo_anio/periodo_mes que Prisma agrega
-- solo, igual que en 20260907151454_indices_rendimiento.

-- CreateEnum
CREATE TYPE "clase_item" AS ENUM ('empresa', 'paquete', 'unidad');

-- AlterTable
-- empaque_compra NULLABLE Y SIN DEFAULT, a proposito: NULL es "no se pudo
-- resolver el tamano del paquete", que NO es lo mismo que 1 ("se compra por
-- unidad"). Con un DEFAULT 1 los items sin dato entrarian a la regla como si
-- fueran sueltos y se les descontaria el faltante entero al personal sin que
-- nadie lo haya decidido.
ALTER TABLE "catalogo_items" ADD COLUMN     "clase" "clase_item" NOT NULL DEFAULT 'unidad',
ADD COLUMN     "empaque_compra" INTEGER,
ADD COLUMN     "empaque_compra_simbolo" TEXT;

-- AlterTable
ALTER TABLE "clasificaciones_producto" ADD COLUMN     "clase" "clase_item";

-- AlterTable
ALTER TABLE "diferencias_item" ADD COLUMN     "clase" "clase_item";

-- AlterTable
-- 0.5 = "media unidad", tal como lo dijo el cliente. Los inventarios ya
-- abiertos toman ese mismo valor: es el que la regla describe, y ninguno de
-- ellos tiene todavia un calculo por paquete que lo use.
ALTER TABLE "inventarios" ADD COLUMN     "umbral_media_unidad_paquete" DECIMAL(4,3) NOT NULL DEFAULT 0.5;
