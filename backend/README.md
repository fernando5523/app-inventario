# Backend — app-inventario

Backend en capas (Express + Prisma + PostgreSQL) para la app de inventario de Market Trujillo.

## ⚠️ Paso manual pendiente (lo tiene que hacer una persona)

Ningún agente puede crear ni mover archivos `.env`: hay una restricción de permisos que aplica a todos los agentes por igual, y está bien que así sea — una credencial no se transmite ni se escribe por un agente.

El contenido correcto ya está listo en `backend/_env_nuevo.txt`. La base `app_inventario` ya existe en el Postgres local. Para dejar el backend andando, una persona tiene que correr:

```bash
mv backend/_env_nuevo.txt backend/.env
cd backend
npx prisma migrate dev --name init
npm run prisma:seed
```

Después de eso, `npm run dev` levanta el servidor con datos reales.

> Si `app_inventario` no llegó a crearse (por ejemplo si se recreó el Postgres local), creala antes con `CREATE DATABASE app_inventario;` conectado como superusuario.

**Nota de coordinación**: la migración la corre una sola persona/agente por vez — dos migraciones simultáneas contra el mismo schema lo rompen. Si hay otro agente esperando para migrar, avisale cuando termines.

**`backend/.env.example` quedó FUERA del repo git, a propósito.** No por lo
que dice — ningún agente (incluido este) tiene permiso para leer archivos
`.env*`, así que nadie pudo confirmar que solo tuviera placeholders y no un
valor real filtrado por error. Con eso sin poder verificarse, la asimetría
del error manda: si se versiona y resulta que tenía la credencial real,
queda en la historia de git para siempre y la credencial se considera
comprometida; si no se versiona y resultaba estar limpio, no se pierde
nada — lo agrega mañana cualquiera que sí pueda leerlo. Antes de agregarlo
al repo, una persona (no un agente) tiene que abrirlo y confirmar que no
tiene nada real.

---

## Arquitectura

Capas por módulo, en `src/modules/<nombre>/`:

- `*.routes.ts` — define las rutas, aplica middlewares (`requiereSesion`, `requiereRol`, `validar`)
- `*.controller.ts` — traduce `req`/`res`, nunca toca Prisma ni lógica de negocio
- `*.service.ts` — la lógica y el ÚNICO lugar del módulo que importa `prisma`
- `*.schema.ts` — validación de forma con Zod (qué forma tiene el request)
- `*.permisos.ts` / `*.validadores.ts` (donde aplica) — reglas de negocio puras, sin Prisma, pensadas para testearse sin base de datos

El rol de un usuario **siempre** sale de `req.colaborador` (puesto por `auth.middleware.ts` a partir del token verificado contra la base) — nunca del body ni de un header que mande el cliente.

### Roles

| Rol | Alcance |
|---|---|
| `administrador` | Todo: usuarios, tiendas, configuración del sistema. No cuenta ni audita. Es del sistema, no de una sucursal (`sucursalId: null`). |
| `auditor` | Auditoría y lacrado de su sucursal (endpoints ya existentes de conteo/inventario, no documentados acá) + puede crear y habilitar cuentas `coordinador`/`conteo` **de su propia sucursal únicamente**. Nunca crea otro `auditor` ni un `administrador`. |
| `coordinador` | Sin cambios respecto a antes de esta fase. |
| `conteo` | Sin cambios respecto a antes de esta fase. |

### Autorización por rol

`middleware/autorizacion.middleware.ts` expone `requiereRol(...roles)`, declarativo en las rutas — nunca un `if` de rol adentro de un controller:

```ts
router.use(requiereSesion, requiereRol('administrador', 'auditor'));
```

Dentro de ese rango, el recorte fino (un auditor no puede tocar otro auditor, ni salir de su sucursal) vive en `usuarios.permisos.ts`, no en las rutas.

### Cuentas: deshabilitar, nunca borrar

`Colaborador.activo` (boolean) reemplaza el borrado. Una cuenta deshabilitada:
- No aparece en `GET /api/sesion/sucursales/:id/colaboradores` (no se puede elegir para ingresar)
- No puede hacer `POST /api/sesion/ingresar` (rechazado con 401)
- Si ya tenía una sesión activa, el próximo request con ese token también es rechazado (se revalida `activo` en cada request, no solo al ingresar)

### Auditoría de administración

Toda acción de administración (alta, habilitar/deshabilitar, reset de PIN, alta/edición de tienda, cambio de configuración) escribe una fila en `RegistroAuditoria` (`accion`, `entidad`, `entidadId`, `detalle`, quién y cuándo). El PIN, en claro o hasheado, **nunca** viaja en `detalle`. No hay todavía un endpoint para leer este log (nadie lo pidió aún).

### Configuración del sistema: clave-valor, no columnas fijas

`Configuracion` es una tabla clave-valor tipada (`clave`, `valor` como texto, `tipo` para saber cómo parsearlo) en vez de una columna por ajuste. Se eligió así porque el propio negocio dejó abierta la pregunta de sumar más configuraciones a futuro (`docs/pantallas.md`, pregunta 1) — clave-valor no pide una migración por cada ajuste nuevo; columnas fijas sí. El costo es que la forma válida de cada `valor` (rango, si es entero o decimal) se valida en `config.validadores.ts`, no en el tipo de columna de Postgres. Hoy son 3 claves conocidas — agregar una cuarta es sumarla a `CLAVES_CONFIGURACION` (`config.schema.ts`) y a `VALIDADORES` (`config.validadores.ts`), nunca una migración.

El umbral `UMBRAL_MEDIA_UNIDAD_PAQUETE` es el **default sugerido** de la regla de "media unidad de paquete" que menciona Oscar en la reunión de requisitos — la reunión aclara que el auditor la ajusta caso por caso, esto no es una regla dura del sistema.

### El administrador no pertenece a ninguna sucursal

`Colaborador.sucursalId` es nullable **únicamente** para `rol = administrador`: es del sistema, gestiona las 4 sucursales por rol, no por fila. Para los otros 3 roles sigue siendo obligatorio, exigido en `usuarios.schema.ts` (no con un `CHECK` de Postgres). `POST /api/usuarios` con `rol: "administrador"` rechaza el request si viene `sucursalId` (nadie le inventa una tienda al administrador); con cualquier otro rol, rechaza si **falta**.

Consecuencia en sesión: `POST /api/sesion/ingresar` devuelve `sucursal: null` cuando el colaborador que ingresa es administrador (ver contrato más abajo).

---

## Autenticación

Todas las rutas bajo `/api/usuarios`, `/api/tiendas` y `/api/config` exigen el header:

```
Authorization: Bearer <token>
```

El `token` sale de `POST /api/sesion/ingresar`. Vence a las 12 horas.

## Formato de error

Todos los endpoints, ante un error, responden:

```json
{ "error": "mensaje en español, legible" }
```

o, si falló la validación de Zod:

```json
{ "error": "Solicitud invalida.", "detalles": { /* ZodError.flatten() */ } }
```

Códigos usados: `400` (forma inválida), `401` (sin token / token inválido / cuenta deshabilitada / PIN incorrecto), `403` (token válido pero rol sin permiso), `404` (no existe), `409` (conflicto, ej. DNI duplicado), `429` (demasiados intentos de login).

---

## Endpoints

### `GET /salud`
Sin rol. `{ "ok": true }`.

### Sesión — `/api/sesion` (sin rol, es el login)

#### `GET /api/sesion/sucursales`
Lista las sucursales **activas**.

Respuesta `200`:
```json
[{ "id": 1, "nombre": "Market Central Luzuriaga", "colaboradores": 11 }]
```

#### `GET /api/sesion/sucursales/:sucursalId/colaboradores`
Lista los colaboradores **activos** de esa sucursal (para elegir con quién ingresar). Nunca incluye administradores (no tienen sucursal).

Respuesta `200`:
```json
[{ "id": 102, "nombre": "María Rojas", "dni": "8890", "rol": "conteo" }]
```

#### `POST /api/sesion/ingresar`
Rate-limited: 8 intentos / 15 min por `colaboradorId`.

Body:
```json
{ "colaboradorId": 102, "pin": "123456" }
```

Respuesta `200`:
```json
{
  "colaborador": { "id": 102, "nombre": "María Rojas", "dni": "8890", "rol": "conteo" },
  "sucursal": { "id": 1, "nombre": "Market Central Luzuriaga", "colaboradores": 11 },
  "token": "hex de 64 caracteres",
  "expiraEn": "2026-09-04T02:00:00.000Z"
}
```
`sucursal` es `null` si `colaborador.rol === "administrador"`.

Errores: `404` colaborador no existe · `401` cuenta deshabilitada, o PIN incorrecto.

---

### Usuarios — `/api/usuarios` (requiere sesión + rol `administrador` o `auditor`)

Un auditor solo ve/gestiona `coordinador`/`conteo` de **su propia sucursal**; un administrador no tiene recorte.

#### `GET /api/usuarios?sucursalId=<opcional>`
- `administrador`: lista todos, o filtra por `sucursalId` si lo manda.
- `auditor`: siempre filtrado a su propia sucursal, ignora el query param si lo manda.

Respuesta `200`:
```json
[
  {
    "id": 102,
    "nombre": "María Rojas",
    "dni": "8890",
    "rol": "conteo",
    "sucursalId": 1,
    "activo": true,
    "creadoPorId": null,
    "createdAt": "2026-09-01T09:41:00.000Z"
  }
]
```
`sucursalId` es `null` para filas con `rol: "administrador"`. `creadoPorId` es `null` si la cuenta viene del seed inicial (no de esta API).

#### `POST /api/usuarios`
Body:
```json
{ "nombre": "Juan Pérez", "dni": "12345678", "rol": "coordinador", "sucursalId": 1, "pin": "654321" }
```
- `rol`: uno de `administrador | coordinador | conteo | auditor`.
- `sucursalId`: **obligatorio** si `rol !== "administrador"`. **Prohibido** (el request falla) si `rol === "administrador"`.
- `pin`: 6 dígitos exactos. Se hashea con argon2 antes de guardar; nunca se loguea ni se devuelve.
- `dni`: 4 a 8 dígitos (el seed de demo usa placeholders de 4; un DNI real peruano tiene 8).

Reglas de autorización (403 si se violan):
- `administrador` → puede crear cualquier rol, cualquier sucursal.
- `auditor` → solo `coordinador`/`conteo`, y solo con `sucursalId` igual a la suya. Nunca `auditor` ni `administrador`.

Respuesta `201`: mismo shape que un ítem de `GET /api/usuarios`.

Errores: `400` forma inválida (incluye admin con sucursalId, o no-admin sin sucursalId) · `403` rol sin permiso para esa alta · `409` ya existe un colaborador con ese DNI en esa sucursal.

#### `PATCH /api/usuarios/:id/estado`
Body: `{ "activo": false }`

Habilita (`true`) o deshabilita (`false`) la cuenta. Mismo recorte de alcance que crear (un auditor no puede tocar otro auditor ni un administrador, ni cuentas de otra sucursal).

Respuesta `200`: mismo shape que un ítem de `GET /api/usuarios`.

#### `POST /api/usuarios/:id/resetear-pin`
Body: `{ "pin": "111111" }` — el nuevo PIN, elegido por quien hace el reset (para poder comunicárselo en persona a la cuenta afectada).

Respuesta `204`, sin body. El PIN nuevo nunca se devuelve ni se audita en claro.

---

### Tiendas — `/api/tiendas` (requiere sesión + rol `administrador`)

#### `GET /api/tiendas`
Lista todas las sucursales, activas e inactivas.

Respuesta `200`:
```json
[
  {
    "id": 1,
    "nombre": "Market Central Luzuriaga",
    "activa": true,
    "direccion": null,
    "telefono": null,
    "colaboradores": 11
  }
]
```

#### `POST /api/tiendas`
Body:
```json
{ "nombre": "Market Nuevo", "direccion": "Av. Siempre Viva 123", "telefono": "987654321" }
```
`direccion`/`telefono` opcionales.

Respuesta `201`: mismo shape que un ítem de `GET /api/tiendas`.

#### `PATCH /api/tiendas/:id`
Body: cualquier subconjunto no vacío de:
```json
{ "nombre": "...", "direccion": "..." /* o null para borrarla */, "telefono": "..." /* o null */, "activa": false }
```

Respuesta `200`: mismo shape que un ítem de `GET /api/tiendas`.

Errores: `400` si el body viene vacío · `404` tienda no existe.

---

### Configuración — `/api/config` (requiere sesión + rol `administrador`)

#### `GET /api/config`
Respuesta `200`:
```json
[
  { "clave": "TAMANO_HOJA_DEFECTO", "valor": 50, "tipo": "entero", "descripcion": "...", "updatedAt": "..." },
  { "clave": "CANTIDAD_CONTEOS_CICLO", "valor": 3, "tipo": "entero", "descripcion": "...", "updatedAt": "..." },
  { "clave": "UMBRAL_MEDIA_UNIDAD_PAQUETE", "valor": 0.5, "tipo": "decimal", "descripcion": "...", "updatedAt": "..." }
]
```
`valor` ya viene tipado (number para entero/decimal, string para texto) — el consumidor no necesita parsear.

#### `PUT /api/config/:clave`
`:clave` es una de `TAMANO_HOJA_DEFECTO | CANTIDAD_CONTEOS_CICLO | UMBRAL_MEDIA_UNIDAD_PAQUETE` (404 si no existe).

Body: `{ "valor": 30 }` (string o number, según la clave).

Reglas de valor válido:
- `TAMANO_HOJA_DEFECTO`: `20`, `30` o `50`.
- `CANTIDAD_CONTEOS_CICLO`: entero ≥ 1.
- `UMBRAL_MEDIA_UNIDAD_PAQUETE`: número estrictamente entre 0 y 1 (ej. `0.5`).

Respuesta `200`: mismo shape que un ítem de `GET /api/config`.

Errores: `400` valor fuera de rango para esa clave · `404` clave desconocida.

---

## Desarrollo

```bash
npm install
npm run typecheck
npm test          # tests de codigo puro (Zod, permisos, hasheo de PIN), no requieren Postgres
npm run dev        # requiere backend/.env con DATABASE_URL apuntando a Postgres corriendo
```
