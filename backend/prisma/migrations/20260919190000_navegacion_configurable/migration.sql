-- LOS ACCESOS RAPIDOS Y LOS MENUS DEJAN DE ESTAR HARDCODEADOS.
--
-- ADITIVA: un enum y una tabla nueva. No borra, no renombra, no cambia ningun
-- tipo y no toca una sola fila existente.
--
-- Pedido del cliente, textual: "en la app actualmente tiene accesos rapidos,
-- que estos pueden ser manejados por el administrador por medio de roles al
-- igual que los menus, pero DEJAR LOS ROLES QUE YA TENEMOS Y SUS ACCESOS".
--
-- LA TABLA NACE VACIA Y LA SIEMBRA LA LLENA con lo que hoy esta hardcodeado
-- en mobile/components/navegacion/{accesos,tabs}.ts, en su orden actual (ver
-- prisma/sembrar-navegacion.ts). El dia 1 despues de esta migracion los
-- cuatro roles ven exactamente lo mismo que veian antes. Esa es la mitad del
-- pedido que mas facil se incumple sin querer.
--
-- Y mientras la tabla este vacia NO SE ROMPE NADA: la app trae su mapa
-- compilado de respaldo y lo usa cuando la configuracion no llega o llega
-- vacia. Un home en blanco es una persona parada en la gondola sin poder
-- contar.
--
-- ESTO ES PRESENTACION, NO AUTORIZACION. Esconder una tarjeta es una
-- comodidad; mostrarla no es un permiso -- quien decide sigue siendo el
-- `requiereRol` de cada router y los `*.permisos.ts`.
--
-- Y no puede darle a un rol un elemento de otro: la lista blanca de cada rol
-- son las rutas de SU grupo (`mobile/app/<rol>/`). `/auditor/auditoria` no
-- existe dentro de `app/coordinador/`, asi que no hay forma de darsela. Eso
-- es lo que protege el conteo ciego, y hay un test que lo afirma.
--
-- `actualizado_por_id` va en SET NULL y no en RESTRICT -- a diferencia del
-- resto del esquema -- por lo mismo que `config_dynamics.actualizado_por_id`:
-- es un puntero de trazabilidad, no un dato del que cuelgue la fila. Si el
-- administrador que reordeno el home el año pasado se da de baja, la
-- configuracion tiene que seguir en pie; el detalle de quien hizo que vive en
-- `registro_auditoria`, que no se borra.
--
-- SE QUITO A MANO el ALTER de periodo_anio/periodo_mes que Prisma agrega
-- solo, igual que en 20260907151454_indices_rendimiento.

-- CreateEnum
CREATE TYPE "tipo_navegacion" AS ENUM ('acceso', 'tab');

-- CreateTable
CREATE TABLE "configuracion_navegacion" (
    "id" SERIAL NOT NULL,
    "rol" "rol" NOT NULL,
    "tipo" "tipo_navegacion" NOT NULL,
    "clave" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "actualizado_por_id" INTEGER,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_navegacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- La consulta de la app al iniciar sesion: "lo mio, en orden".
CREATE INDEX "configuracion_navegacion_rol_tipo_orden_idx" ON "configuracion_navegacion"("rol", "tipo", "orden");

-- CreateIndex
-- Un elemento aparece UNA vez por rol: hace la siembra idempotente y evita
-- que reordenar pueda duplicar una tarjeta.
CREATE UNIQUE INDEX "configuracion_navegacion_rol_tipo_clave_key" ON "configuracion_navegacion"("rol", "tipo", "clave");

-- AddForeignKey
ALTER TABLE "configuracion_navegacion" ADD CONSTRAINT "configuracion_navegacion_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
