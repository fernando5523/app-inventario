-- Credenciales de Dynamics cargadas desde la pantalla del Administrador.
--
-- Fila unica (id = 1): la integracion con el ERP es una sola para todo el
-- sistema. Se modela como tabla propia y no como filas de `configuraciones`
-- porque el secreto necesita un tratamiento que las otras configs no tienen:
-- se guarda CIFRADO (AES-256-GCM, ver config-dynamics.cifrado.ts) y la API
-- nunca lo devuelve.
--
-- `client_secret_cifrado` es nullable a proposito: NULL significa "todavia
-- no se cargo ninguno", que es distinto de "hay uno vacio". La diferencia
-- decide si la pantalla muestra "configurado" o no.

CREATE TABLE "config_dynamics" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "url_base" TEXT NOT NULL,
    "data_area_id" TEXT NOT NULL DEFAULT '',
    "client_secret_cifrado" TEXT,
    "actualizado_por_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_dynamics_pkey" PRIMARY KEY ("id")
);

-- Que la fila sea UNA sola, sostenido por la base y no por una convencion
-- que alguien puede olvidar: sin esto, un `create` con otro id crearia una
-- segunda configuracion y el sistema tendria dos verdades sobre cual es el
-- Dynamics de la empresa.
ALTER TABLE "config_dynamics" ADD CONSTRAINT "config_dynamics_fila_unica" CHECK ("id" = 1);

-- ON DELETE SET NULL: una cuenta deshabilitada no borra el rastro de quien
-- cargo las credenciales, pero tampoco impide dar de baja a esa persona.
ALTER TABLE "config_dynamics" ADD CONSTRAINT "config_dynamics_actualizado_por_id_fkey"
  FOREIGN KEY ("actualizado_por_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
