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

## ⚠️ PIN de desarrollo — hay que rotarlo antes de la tienda

El seed genera el PIN de cada colaborador como **su propio id con ceros
adelante**:

| Persona | id | PIN |
|---|---|---|
| José Tarazona (coordinador) | 101 | `000101` |
| María Rojas (conteo) | 102 | `000102` |
| Admin Sistema (administrador) | 1000 | `001000` |

**Por qué esto es una puerta abierta, no solo un placeholder feo:** la
pantalla de login **lista a todas las personas** de la sucursal con nombre y
rol (`GET /api/sesion/sucursales/:id/colaboradores`, público). Cualquiera que
abra la app ve la lista y de ahí deduce el PIN de todos — incluido el del
administrador, que gestiona las cuentas de las 4 sucursales.

Que sean predecibles es **deliberado**: sin eso no se puede probar `/ingresar`
en local. El algoritmo del seed **no se cambia**. Lo que hay que hacer es
rotarlos antes de cualquier uso real.

### Cómo rotarlos

```bash
curl -X POST http://localhost:3000/api/usuarios/102/resetear-pin   -H "Authorization: Bearer <token de administrador o auditor>"   -H "Content-Type: application/json"   -d '{"pin":"418293"}'
```

`204` sin body. El PIN nuevo nunca se devuelve ni se audita en claro.
Verificado contra la base real: el PIN viejo pasa a dar `401 PIN incorrecto.`
y el nuevo entra.

Lo puede hacer un `administrador` (cualquier cuenta) o un `auditor` (solo
`coordinador`/`conteo` de su propia sucursal). El hasheo es argon2 en los dos
casos — el problema nunca fue **cómo se guarda**, es que se puede **adivinar**.

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

### Dynamics 365 — `/api/d365` (requiere sesión)

Integración de **solo lectura** con D365 Finance & Operations (OAuth2 `client_credentials` contra Azure AD). No hay, ni va a haber en esta fase, ningún endpoint que escriba de vuelta a Dynamics — el ajuste automático es fase 2, decisión del cliente (ver `app/auditor/lacrado.tsx`).

**`D365_DATA_AREA_ID = "trv"` — CONFIRMADO POR EL CLIENTE como Market Trujillo (2026-09-03). Ya no es un supuesto.** Si algún día se reconecta contra otro ambiente/empresa, hay que volver a confirmar esto explícitamente antes de tocar `.env` — traer el catálogo de la empresa equivocada es peor que no traerlo: no tira ningún error, simplemente parece que funcionó.

**Las entidades y el mapeo de abajo salieron de probar contra el tenant real** (`mistr.operations.dynamics.com`, empresa `trv`), no de la documentación genérica de D365 — la primera versión de este módulo apuntaba a `ReleasedProducts`/`ProductBarcodes` (nombres "de manual") y ninguna de las dos funciona en este ambiente. Se corrigió después de traer una muestra chica (nunca los 8.000 de una) y, para el tema de las unidades de conversión, después de revisar cómo lo resuelven otros proyectos de integración con este mismo tenant (`D:\Documentos\python\app007-validacion_productos`).

**Entidades OData que se consultan:**
- `ReleasedProductsV2` — catálogo maestro. **`ReleasedProducts` a secas da 404** en este ambiente ("No route data was found"). Tampoco existen `ItemId`, `ProductName` ni `ProductDescription` en `ReleasedProductsV2` (dan 400 "property not found") — el único nombre disponible es `SearchName`, y viene recortado y en mayúsculas fijas (ej. `"SAPOLIOLIMPIATODOANT"`).
- `ProductBarcodesV2` — códigos de barra por producto (**no** `ProductBarcodes`, que es la V1; ambas responden pero V2 trae mejor dato). Trae `ProductDescription`, que sí es un nombre legible de verdad (ej. `"SAPOLIO LIMPIATODO ANTIBACTERIAL COCO 900 ML"`) — mejor fuente de descripción que `SearchName`.
- `ProductSpecificUnitOfMeasureConversions` — **acá vive el factor del empaque**, NO en `ProductBarcodesV2.ProductQuantity` (ver más abajo). No acepta filtro por `dataAreaId`; se trae completa (37.6k filas en este tenant, paginada igual que las demás) y se agrupa localmente por `ProductNumber`.

**HALLAZGO IMPORTANTE — el código de barras nunca identifica el empaque.** En una muestra real de 100+ productos, **el 100% de los barcodes de `ProductBarcodesV2` tienen `ProductQuantity: 0` y `IsDefaultDisplayedBarcode: "No"`** — nunca `1`, nunca `"Yes"`, nunca una cantidad mayor a 1. Es decir: todo barcode identifica la unidad suelta del producto, nunca "esto es una caja de 12". **Consecuencia real para el escáner: puede confirmar QUÉ producto es, pero nunca en qué empaque viene** — eso lo tiene que elegir a mano el operario. No es un bug de nuestro mapeo: es así como está cargado el dato en Dynamics hoy, y otro proyecto de integración contra el mismo tenant (`app-barcode`, `app007-validacion_productos`) se topa con la misma limitación sin resolverla.

**Dónde vive de verdad el factor de empaque** (`d365-catalogo.service.ts#elegirEmpaques`): en `ProductSpecificUnitOfMeasureConversions`, filtrada por `ProductNumber`. Cada fila tiene `FromUnitSymbol`, `ToUnitSymbol` y un `Factor` numérico real — confirmado contra datos reales: `{ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12}`. Una fila con `Factor: 1` es solo la equivalencia entre `"U"` y `"U."` (misma unidad, dos grafías) y no cuenta como empaque; el resto (`Factor != 1`) son empaques alternos de verdad. **La tabla admite varias filas por producto** (varios empaques simultáneos, ej. Caja y Pack) — en la muestra real que se probó (100 productos) ninguno mostró dos a la vez, pero el mecanismo lo soporta, y desde que el cliente decidió que `Producto` admite varios `Empaque` (ver más abajo), ya no se descarta ninguno.

**Mapeo a nuestro dominio:**
- `codigoBarras` (unidad suelta) = el barcode marcado `IsDefaultDisplayedBarcode="Yes"` si existe, si no el primero que haya (`ProductQuantity` no sirve de desempate acá: siempre es 0). Sin ningún barcode, se usa el `ItemNumber` como último recurso (nunca queda vacío).
- `descripcion` = `ProductBarcodesV2.ProductDescription` del barcode elegido (nombre legible), si no `SearchName` de `ReleasedProductsV2`, si no el `ItemNumber`.
- `empaques` = TODAS las filas de `ProductSpecificUnitOfMeasureConversions` con `Factor != 1`, ordenadas de mayor a menor factor (`[0]` = el más grande, ej. Caja antes que Pack — es el que se ofrece primero en el modal del front). Sin ninguna, un único empaque con factor `1` y la unidad de inventario/compra de D365.
- `empaques[].codigoBarras` **nunca se llena** — no existe un barcode específico por empaque en este tenant (ver el hallazgo de arriba). Es opcional de verdad, no solo en el tipo: este mapeo no lo inventa.
- **Ya no hay límite de uno**: `Producto` (antes un solo `Empaque` embebido en columnas planas) ahora modela una lista — decisión del cliente, sept. 2026. Si D365 trae más de un empaque alterno para el mismo producto, se guardan todos.

**Paginación**: `d365-entity.service.ts` primero pide `$count`, arma los lotes con `calcularPaginas(total, tamanoLote)` (500 por defecto) y trae cada lote con `$skip`/`$top` — con 8.000 ítems no es opcional. El token OAuth2 se cachea en memoria y se renueva solo si vence en menos de 5 minutos; si Dynamics responde `401` con el token cacheado, se pide uno nuevo una sola vez y se reintenta.

#### `GET /api/d365/estado`
Cualquier rol autenticado. `{ "configurado": true | false }` — si `false`, faltan una o más `D365_*` en el entorno (ver `.env.example`).

#### `POST /api/d365/snapshot`
Rol `administrador` o `coordinador` — es el paso 1 del wizard del Coordinador (`mobile/lib/puertos/repositorios.ts#RepositorioInventario.traerSnapshot`).

Body:
```json
{ "sucursalId": 1, "modo": "real" }
```
- `modo` es opcional, default `"real"`. `"ejemplo"` nunca toca red ni exige credenciales: devuelve siempre los mismos 4 productos ya validados en `mobile/design/conteo.html` (Aceite Vegetal Primor, Cerveza Cusqueña, Leche Evaporada, Fideos Canuto), cada uno con sus empaques — el Aceite trae dos (Emp.12 y Emp.6) para poder probar de verdad la pantalla con más de un empaque por producto. Nunca se sustituye `"real"` por datos de ejemplo en silencio — si no hay credenciales y se pide `"real"`, es un `400`, no un fallback automático.

Respuesta `200`:
```json
{ "inventarioId": 7, "items": 8000, "tomadoEn": "2026-09-03T14:00:00.000Z" }
```

**Idempotente**: si la sucursal ya tiene un `Inventario`, se devuelve ese mismo (mismo `inventarioId`/`items`/`tomadoEn`) en vez de crear uno nuevo ni volver a golpear Dynamics — mismo contrato que el puerto del front. *Simplificación documentada*: como todavía no existe en este backend un módulo de hojas/inventario, "ya tiene un inventario" se resuelve como "existe al menos una fila para esa sucursal", no "hay uno en curso sin cerrar" — cuando exista ese módulo, esta regla se va a tener que afinar.

> **Ya se puede afinar**: `Inventario` ahora tiene estado y el campo `abierto` (ver la sección de Histórico). El snapshot debería buscar `{ sucursalId, abierto: true }` en vez de la fila más reciente — si no, una sucursal que ya cerró su mes no puede abrir el siguiente. Además, `prisma.inventario.create` puede fallar ahora con `P2002` sobre `(sucursal_id, abierto)` si la sucursal ya tiene uno en curso: conviene traducirlo a un 409 legible. Queda anotado para quien mantiene este módulo, no se tocó desde el módulo de historial.

El catálogo mapeado (con barcode y empaque de cada ítem) se guarda en `CatalogoItem`, colgado del `Inventario` — es el catálogo crudo del snapshot, antes de partirse en hojas. Todavía no hay un endpoint para leerlo (el paso 2, "crear hojas", que consumiría esto, no está construido en este backend); queda ahí esperando ese módulo.

Errores: `400` `sucursalId` inválido, o `modo="real"` sin credenciales configuradas · `502` Dynamics respondió con error o no se pudo autenticar.

---

### Hojas y conteos — `/api/hojas` (requiere sesión; los 4 roles entran, con recorte por hoja)

El núcleo del negocio: repartir, contar y finalizar. Sirve a `RepositorioHojas` y `RepositorioCatalogo` de `mobile/lib/puertos/repositorios.ts`.

**El recorte fino NO es por rol solo, es por HOJA** (`hojas.permisos.ts`), porque depende de si está asignada a quien pide y de qué sucursal es:

| Acción | Quién |
|---|---|
| Ver **las suyas** (`alcance=mias`) | los 4 roles — siempre filtrado al colaborador de la sesión |
| Ver **el lote entero** (`alcance=todas`) | `coordinador`, `auditor`, `administrador`. **Nunca `conteo`** |
| Abrir **una** hoja | `conteo` solo si está asignada a él; `coordinador`/`auditor` cualquiera de su sucursal; `administrador` cualquiera |
| **Escribir** (contar, finalizar) | **solo quien tiene la hoja asignada**, sea cual sea su rol |

Escribir es más estricto que leer a propósito: el inventario se audita y "quién contó esto" tiene que tener respuesta. Que un rol tenga más jerarquía no lo pone frente a la góndola — un `coordinador` (y hasta el `administrador`) recibe `403` si intenta contar en una hoja que no es suya.

**Conteo ciego**: ningún endpoint de acá devuelve stock del ERP. `Producto` no tiene ese campo, ni acá ni en el dominio del front — el stock de Dynamics solo lo ve el Auditor después de cerrado el ciclo. Y `alcance=mias` filtra **en la consulta SQL**, no después en memoria: lo que no se pide, no se trae.

Salir de la propia sucursal da `403` (o `404` en el listado, para no confirmar que ese inventario existe).

#### `GET /api/hojas?inventarioId=<n>&alcance=mias|todas&ronda=1&numero=<opcional>`
- `alcance` opcional, default **`mias`** — el default es el restrictivo: si alguien olvida el parámetro, la respuesta segura no es el lote entero.
- `ronda` opcional, default `1` (`HojaConteo.numeroConteo`: 1er conteo, reconteo, auditoría). El puerto del front todavía no habla de rondas.
- `numero` opcional: así se resuelve `porNumero` del puerto — devuelve una lista de 0 o 1 elemento.

Respuesta `200`: array de hojas con el shape de `mobile/lib/dominio/tipos.ts#HojaConteo`.
```json
[{
  "id": 7, "inventarioId": 1, "numero": "002", "zona": "Abarrotes", "gondola": "A2",
  "tamano": 50, "estado": "en-proceso", "sync": "sincronizado",
  "asignados": ["María Rojas"], "productos": [], "conteos": []
}]
```
`estado` sale como `"en-proceso"` (el dominio del front), no `"en_proceso"` (el enum de Prisma).

Errores: `403` un `conteo` pidiendo `alcance=todas` · `404` inventario inexistente o de otra sucursal.

#### `GET /api/hojas/:id`
La hoja con sus `productos` y `conteos` completos. Mismo shape que un ítem del listado.

Errores: `403` no asignada a vos (rol `conteo`) o de otra sucursal · `404` no existe.

#### `GET /api/hojas/:id/productos`
Solo el catálogo de esa hoja — `RepositorioCatalogo.deHoja`.

Respuesta `200`:
```json
[{
  "id": 51, "codigo": "0051", "codigoBarras": "7750123051",
  "descripcion": "Aceite Vegetal Primor 1L",
  "empaques": [{ "nombre": "Caja", "factor": 12 }, { "nombre": "Pack", "factor": 6 }],
  "ubicacion": "Góndola A2 · Nivel 3"
}]
```
`empaques` es siempre una lista con al menos un elemento — `[0]` es el que se ofrece primero al abrir el modal. `codigoBarras` de un empaque se omite cuando no hay (va a faltar casi siempre, ver el hallazgo de D365 más arriba).

#### `GET /api/hojas/:id/productos/barras/:codigo`
`RepositorioCatalogo.porCodigoBarras`. Matchea contra el código de la **unidad suelta** y también contra el de **cualquiera de los empaques** del producto (un empaque puede traer código propio, aunque en la práctica casi nunca): escanear la caja resuelve al mismo producto.

Respuesta `200`: un producto, mismo shape que arriba.

`404` cuando el código no pertenece a la hoja. **No es un error a mostrar en rojo**: es el caso de la góndola, donde el producto de al lado entra en cuadro del escáner. El front lo traduce a "este código no pertenece a la hoja" y no cuenta nada.

#### `PUT /api/hojas/:id/conteos/:productoId`
Guarda o corrige el conteo de un producto.

Body:
```json
{ "empaques": [{ "empaqueNombre": "Caja", "cantidad": 2 }, { "empaqueNombre": "Pack", "cantidad": 3 }],
  "sueltas": 5, "confirmadoPorEscaner": true, "contadoEn": "2026-09-03T10:00:00.000Z" }
```
- `empaques` es una **lista** de líneas, no un entero: el operario puede cargar varias (ej. "2 cajas + 3 packs + 5 sueltas" para el mismo producto). Puede venir vacía (solo sueltas). No puede repetir el mismo `empaqueNombre` dos veces — `400` si lo hace.
- Cada `empaqueNombre` tiene que existir entre los empaques DEL producto — si no, `400` (no `500`: es un dato inválido del cliente, no un error del servidor).
- `confirmadoPorEscaner` opcional, default `false`.
- `contadoEn` es la hora **del teléfono**, no la del servidor: la cola offline manda esto recién cuando vuelve el WiFi, y la diferencia puede ser de horas.
- **No se acepta `total`.** Si viene, se ignora. El total se calcula (suma de `cantidad × factor` de cada línea, más `sueltas`); guardarlo junto a sus partes garantiza que algún día no coincidan, y ése es el número que se audita contra el ERP.
- Cada guardado reemplaza la lista de líneas **entera** — no la mezcla con la que ya había. Corregir "me equivoqué, era 1 caja no 2" no puede dejar líneas viejas huérfanas.

Respuesta `200`:
```json
{ "conteo": { "productoId": 51, "empaques": [{ "empaqueNombre": "Caja", "cantidad": 2 }, { "empaqueNombre": "Pack", "cantidad": 3 }], "sueltas": 5, "confirmadoPorEscaner": true, "contadoEn": "..." },
  "total": 47, "estadoHoja": "en-proceso" }
```
`total` viene calculado, para que la app no tenga que repetir la cuenta.

**IDEMPOTENTE — esto es lo que la cola de sincronización necesita.** Es `PUT` y no `POST` porque un conteo tiene identidad propia: el par (hoja, producto). Por debajo es un `upsert` sobre `@@unique([hojaId, productoId])`. Mandar el mismo conteo N veces deja exactamente el mismo estado que mandarlo una — **un reintento no puede duplicar nada**. No hace falta que el cliente mande un id de operación: la cola del front ya deduplica por `(hojaId, tipo, productoId)` (`sqlite-cola.ts#claveDedup`), así que las dos puntas coinciden en cuál es la identidad de la operación.

El primer conteo mueve la hoja de `pendiente` a `en-proceso`. **Nunca la finaliza sola.**

Errores:
- **`409` la hoja ya está finalizada.** El que la cola tiene que saber distinguir: el dato del teléfono **no está mal** — puede ser un conteo válido que quedó en la cola offline y llegó tarde, después de que alguien finalizara la hoja. Es un conflicto de estado, no de forma, por eso `409` y no `400`. Cuando llega esto, el conteo local ya no se puede sincronizar nunca: hay que sacarlo de la cola y avisarle a la persona, no reintentar.
- `403` la hoja no está asignada a vos.
- `404` la hoja no existe, o el producto no pertenece a esa hoja.
- `400` forma inválida (negativos, decimales, falta `contadoEn`).

#### `POST /api/hojas/:id/finalizar`
Punto de no retorno: después de esto `PUT .../conteos/...` responde `409`.

Sin body. Respuesta `200`: la hoja completa, ya `"finalizada"`.

**También idempotente**: finalizar una hoja ya finalizada devuelve la hoja, no un error. Si tirara `409`, la cola dejaría el ítem en `error` para siempre por haber hecho exactamente lo que se le pidió.

Errores: `403` no asignada a vos · `404` no existe.

---

---

---

### Auditoría — `/api/auditoria` (requiere sesión + rol `administrador`, `auditor` o `coordinador`)

La matriz que compara el ERP contra los 3 conteos (Pantalla 5). Es donde se decide si el inventario cuadra, y lo que alimenta la liquidación y el lacrado.

#### Quién entra, y por qué no es una configuración de permisos

| Rol | Acceso |
|---|---|
| `auditor` | **Cualquier inventario de su sucursal**, en curso o cerrado. Auditar mientras se cuenta es literalmente su trabajo: la 3ra ronda es suya. |
| `administrador` | Todo, cualquier sucursal. Es del sistema, no de una tienda. |
| `coordinador` | **Solo inventarios ya cerrados** (`conteo_cerrado`, `liquidado`, `lacrado`). Nunca el que está en curso. |
| `conteo` | **Nunca. En ningún estado.** |

**El rol `conteo` no entra jamás.** La matriz contiene `stockErp`, que es exactamente el número que los 3 conteos cruzados existen para no conocer. Un contador que lo ve deja de contar lo que hay y pasa a confirmar lo que el sistema espera. Abrirle esta pantalla no sería un permiso de más: vaciaría de sentido las tres pasadas, las 160 hojas y el mes de trabajo de once personas.

**El coordinador: la decisión y su razón.** Las dos fuentes parecían chocar — en la reunión Gilmer dice que el coordinador no ve resultados, y el mockup le da acceso a liquidación. No chocan: hablan de **pantallas distintas**. El mockup le abre la Pantalla 6 (liquidación: plata y nómina), no la Pantalla 5 (la matriz ERP vs conteos). Solo una de las dos contiene el stock del ERP.

Lo que decide es el conteo ciego, y el coordinador es el caso más sensible de todos: es quien asigna las hojas y quien habla con los once contadores durante la jornada. Si ve el stock del ERP con el ciclo abierto, le alcanza con decir *"fijate que ahí tendrían que ser 120"* para que el inventario cuadre sin haberse contado. Contamina más que un contador mirando su propia hoja, porque llega a todos.

Pero esa razón **se termina cuando el ciclo se cierra**: un inventario con el conteo cerrado ya no se puede contaminar — las cantidades están fijas y no hay nadie contando. Ahí el coordinador tiene motivos legítimos para mirar, porque es quien va a explicarle al equipo por qué su tienda quedó con faltante.

De ahí la regla, que honra a las dos fuentes en vez de elegir una: Gilmer hablaba del inventario en curso (era de lo que se hablaba en esa reunión) y el mockup le da visibilidad del cierre. La regla vive en `auditoria.permisos.ts#validarAccesoALaMatriz`, no en las rutas, porque depende del **inventario** y no solo del rol.

Todos los roles quedan además recortados a su propia sucursal (salvo el administrador, que no tiene ninguna).

#### De dónde sale cada columna

| Columna | Origen |
|---|---|
| `stockErp`, `precioVenta`, `esEmpresa` | `CatalogoItem` — el snapshot de Dynamics tomado al abrir el mes. **No se relee de Dynamics al auditar**: el inventario se compara contra la foto del arranque, no contra lo que el ERP diga hoy. |
| `conteo1` / `conteo2` / `conteo3` | Los `Conteo` de las hojas **finalizadas** de cada ronda. Una hoja a medio contar no entra: un conteo parcial leído como definitivo reporta faltantes que no existen. |
| `zona`, `productoId` | El `Producto` de la ronda 1, que es la que cubre el catálogo entero. |

El puente entre las tres rondas es el **código** del ítem, no el id: el mismo artículo se materializa como un `Producto` distinto en cada hoja de cada ronda.

> **Por qué esos tres campos viven en `CatalogoItem` y no en `Producto`**: esa distinción *es* el conteo ciego. `Producto` es lo que ve la persona que cuenta — por eso no tiene stock ni precio, y no puede tenerlos nunca. `CatalogoItem` es el snapshot crudo del ERP, que solo consumen el backend y esta pantalla. Si esas columnas estuvieran en `Producto`, cualquier endpoint de conteo podría filtrarlas a un contador sin que nadie lo note.

#### Cómo se lee un ítem

- **`conteoFinal`** — la ronda **más avanzada que exista**, no siempre `conteo3`. Los ~7.350 ítems que cuadran en la primera pasada nunca tienen 3ra ronda; leer `conteo3` a secas daría `null` para casi todo el inventario.
- **`diferenciaUnidades`** — `conteoFinal − stockErp`. Negativo = faltante, positivo = sobrante. Un ítem que **nadie contó** da `0`, no "menos todo el stock": que no se haya contado no es lo mismo que haberlo contado en cero, y lo segundo inventaría un faltante por cada ítem al que no se llegó.
- **`diferenciaValor`** — valorizado a **precio de venta**, nunca de compra (así lo definió el cliente en la reunión).
- **`veredicto`** — `cuadrado` si no hay diferencia; `empresa` si hay diferencia y la categoría la asume gerencia (las cervezas, por seguimiento de robo: el faltante existe pero no se descuenta a nómina); `falta` para el resto, **sobrantes incluidos** — la maqueta valida solo esos tres buckets, no hay un cuarto para sobrantes.

Todo esto espeja `mobile/lib/dominio/auditoria.ts` función por función. La cuenta que decide si el inventario cuadra tiene que dar igual en el teléfono y en el servidor: si difieren, el Auditor ve un número en la pantalla y otro en el cierre, y no hay forma de saber cuál era el bueno.

---

#### `GET /api/auditoria/inventarios`

Qué inventarios puede auditar quien pregunta. Devuelve **también** los que no puede abrir todavía, marcados con `puedeVerMatriz: false` y el motivo — un coordinador que no ve la matriz del mes en curso necesita entender por qué, no encontrarse una lista vacía.

Query: `sucursalId` (opcional; solo el administrador puede filtrar por otra tienda).

Respuesta `200`:
```json
{
  "inventarios": [
    {
      "id": 8004,
      "sucursalId": 1,
      "sucursalNombre": "Market Central Luzuriaga",
      "estado": "conteo_cerrado",
      "periodo": "2026-05",
      "snapshotItems": 15,
      "hojas": 8,
      "puedeVerMatriz": true,
      "motivo": null
    },
    {
      "id": 1,
      "estado": "en_curso",
      "periodo": "2026-09",
      "puedeVerMatriz": false,
      "motivo": "La auditoria de un inventario en curso es solo del auditor (conteo ciego). Vas a poder verla cuando el conteo cierre."
    }
  ]
}
```

Los inventarios `anulado` no aparecen: no producen resultado que auditar.

#### `GET /api/auditoria/inventarios/:inventarioId/resumen`

Solo el encabezado, sin traer las filas. Lo usa la pantalla al entrar.

Respuesta `200`:
```json
{
  "inventarioId": 8004,
  "estado": "conteo_cerrado",
  "resumen": {
    "items": 15,
    "cuadrados": 10,
    "conFalta": 3,
    "deEmpresa": 2,
    "porcentajeCuadrado": 66.7,
    "unidadesFaltantes": 112,
    "unidadesSobrantes": 12,
    "valorFaltante": 781.4,
    "valorSobrante": 73.2,
    "valorFaltanteDescontable": 355.5,
    "sinContar": 1
  },
  "embudo": {
    "itemsTotales": 15,
    "itemsSegundoConteo": 7,
    "itemsTercerConteo": 5,
    "itemsConDiferencia": 5
  },
  "zonas": ["A", "B", "C", "D", "E"]
}
```

`valorFaltanteDescontable` es el faltante que **sí** va a nómina: el total menos lo que absorbe la empresa. Es el número que entra a la liquidación (Pantalla 6) como faltante bruto — separarlo acá evita que alguien reste las cervezas dos veces.

`embudo` tiene la misma forma que consume `ResultadoInventario`, así que cerrar el conteo puede alimentarse de acá sin recalcular nada.

#### `GET /api/auditoria/inventarios/:inventarioId/matriz`

La matriz completa, paginada.

Query: `filtro` (`todos` | `cuadrados` | `faltante` | `empresa`, default `todos`), `busqueda` (código o descripción, sin distinguir mayúsculas), `zona`, `limite` (1-500, default 100), `desplazamiento` (default 0).

Respuesta `200`:
```json
{
  "inventarioId": 8004,
  "estado": "conteo_cerrado",
  "resumen": { "items": 15, "cuadrados": 10, "...": "..." },
  "embudo": { "itemsTotales": 15, "...": "..." },
  "filtro": "todos",
  "total": 15,
  "limite": 100,
  "desplazamiento": 0,
  "matriz": [
    {
      "productoId": 42,
      "codigo": "IT-1008",
      "descripcion": "Detergente Bolívar 780g",
      "zona": "D",
      "precioVenta": 9.3,
      "stockErp": 180,
      "conteo1": 150,
      "conteo2": 158,
      "conteo3": 156,
      "esEmpresa": false,
      "conteoFinal": 156,
      "diferenciaUnidades": -24,
      "diferenciaValor": -223.2,
      "veredicto": "falta"
    }
  ]
}
```

**`resumen` y `embudo` se calculan siempre sobre el inventario COMPLETO**, nunca sobre el filtro ni sobre la página. El encabezado tiene que decir "7.870 de 8.000 cuadrados" siempre, no "98 de 100 en esta página" — un resumen que cambia al pasar de página no es un resumen.

El techo de 500 en `limite` no es un número al azar: el inventario real son 8.000 ítems, y devolverlos enteros en un JSON es como se cuelga la pantalla del Auditor en el celular de la tienda.

`productoId` es `0` cuando el ítem está en el catálogo del ERP pero ninguna hoja finalizada lo incluye todavía. Se devuelve igual, con los tres conteos en `null`: un ítem que nadie contó es información, no algo que esconder.

Errores: `401` sin token · `403` rol sin acceso, otra sucursal, o coordinador sobre un inventario en curso · `404` el inventario no existe.

---

### Datos de demo de la auditoría

```bash
npm run prisma:seed-auditoria     # matriz completa + un inventario en curso
npx tsx prisma/limpiar-auditoria-demo.ts   # borra solo los ids 8004-8005
```

| Inventario | Estado | Para qué |
|---|---|---|
| **8004** · Luzuriaga · 2026-05 | `conteo_cerrado` | La matriz completa: 15 ítems, 8 hojas (una por zona en la ronda 1), embudo 15 → 7 → 5. Están los cuatro casos: ítems que cuadran en la 1ra pasada, dos que se corrigen en la 2da, faltantes confirmados en la 3ra, un sobrante, dos cervezas de empresa con faltante, una cerveza de empresa que cuadra, y uno que nadie contó. |
| **8005** · Carhuaz · mes en curso | `en_curso` | Existe para ver la otra mitad de la regla: el coordinador de Carhuaz **no** puede abrir su matriz, el auditor y el administrador sí. |

Los conteos se cargan como los carga el operario ("2 cajas + 3 sueltas"), no como un total plano, así el seed ejercita el cálculo real de `totalUnidades` en vez de esquivarlo.

### Verificación contra la API

```bash
node scripts/verificar-auditoria-api.mjs   # requiere el backend corriendo en :3000
```

Prueba, con sesiones reales de cada rol: que `conteo` recibe 403 en cualquier estado, que el coordinador ve el cerrado pero no el en curso, que el auditor de otra sucursal no entra, que los cuatro filtros particionan el total sin solaparse, que el resumen no cambia al filtrar ni al paginar, y que cada caso de la matriz (cuadra en la 1ra, se corrige en la 2da, faltante en la 3ra, sobrante, empresa, sin contar) da el veredicto correcto.

### Histórico — `/api/historial` (requiere sesión + rol `administrador` o `auditor`)

Es el registro de todos los inventarios: en qué estado está cada uno, cómo cerró, quién lo firmó y qué se le descontó a cada persona. Responde la pregunta del cliente: *"falta el registro de todos los inventarios, dónde llevaremos el control y el histórico"*.

**`coordinador` y `conteo` NO tienen acceso** (403). No es una omisión: es la misma regla de conteo ciego que sostiene todo el sistema — quien cuenta no puede ver el resultado del mes pasado ni el faltante ya detectado, porque entonces deja de contar a ciegas y pasa a confirmar un número que vio antes. Ellos ven lo suyo del inventario en curso, nada más.

Un `auditor` queda recortado **siempre** a su propia sucursal: si manda `sucursalId` de otra tienda, el filtro se ignora (no falla) y el detalle de un inventario ajeno responde `403`. Un `administrador` no tiene recorte.

#### Ciclo de vida de un inventario

```
en_curso ──▶ conteo_cerrado ──▶ liquidado ──▶ lacrado
    │                                            (INMUTABLE)
    └──▶ anulado
```

| Estado | Qué significa |
|---|---|
| `en_curso` | Snapshot tomado, las 3 rondas de conteo todavía se pueden tocar. Es el único estado que acepta escrituras de conteo. |
| `conteo_cerrado` | La 3ra ronda quedó fija (cierre de Gilmer): las cantidades ya no se recuentan. |
| `liquidado` | La planilla de descuentos está calculada. Falta la firma. |
| `lacrado` | Cerrado e inmutable. Cualquier ajuste entra en el período siguiente. |
| `anulado` | Se abandonó sin llegar a lacrar (ej. snapshot equivocado). No produce histórico contable, pero libera la sucursal. |

#### Dos reglas que sostiene la base de datos, no el código

**1. Una sucursal no puede tener dos inventarios abiertos a la vez.**

`Inventario.abierto` es un `Boolean?` con solo dos valores legales: `true` (abierto) y `NULL` (cerrado) — **nunca `false`**. Junto con `@@unique([sucursalId, abierto])` alcanza, porque Postgres considera cada `NULL` distinto de todos los demás en un índice único: dos filas `(sucursal 1, true)` chocan, pero N filas `(sucursal 1, NULL)` conviven. Es el índice único parcial clásico, expresado con lo que Prisma sabe declarar. Cerrar un inventario es `abierto: null`, jamás `abierto: false` (eso volvería a bloquear la sucursal).

Hay una segunda restricción independiente: `@@unique([sucursalId, periodoAnio, periodoMes])` — no hay dos "agosto 2026" de Luzuriaga, ni siquiera entre inventarios ya cerrados.

**2. Un inventario lacrado es inmutable.**

En cuatro niveles, de arriba hacia abajo:

- **Estructura**: `LacradoInventario` es 1:1 con `Inventario` (`inventarioId @unique`) y **no tiene `updatedAt`**, a diferencia de todos los demás modelos escribibles del schema. La ausencia es deliberada: no hay campo donde registrar una modificación porque no debe existir ninguna.
- **Aplicación**: `historial.permisos.ts#verificarNoLacrado` corta cualquier escritura sobre un inventario lacrado (409).
- **Base de datos**: la migración `20260904020954_lacrado_inmutable` instala un trigger `BEFORE UPDATE OR DELETE` en `lacrados_inventario` que lanza excepción, y otro `BEFORE UPDATE` en `aprobaciones_cierre` (si se pudiera reescribir el `aprobador_id` de una firma, el control de dos personas se podría falsificar hacia atrás). El `INSERT` sigue permitido: es como nace un sello.
- **Verificable**: `hash` + `contenido` permiten recalcular la huella sobre el estado actual y compararla — `GET .../lacrado/verificacion`. Aunque alguien con acceso al servidor deshabilite el trigger, la verificación lo delata.

> El registro manual en Dynamics vive en su **propia tabla** (`RegistroErpInventario`, 1:1 con el lacrado) justamente por esto: si estuviera en `lacrados_inventario` haría falta un `UPDATE` sobre la fila del sello, y una tabla "inmutable salvo estas tres columnas" no es inmutable, es una tabla con una puerta.

#### El lacrado: folio y hash

- **`folio`** — `INV-2026-08-LUZ-8000-0AA`. El identificador legible que se cita en un acta o un mail (formato ya validado en `mobile/design/lacrado.html`). El sufijo son 3 caracteres del hash: un dígito verificador a ojo, no un control criptográfico.
- **`hash`** — SHA-256 hexadecimal de `contenido` serializado en forma **canónica** (claves ordenadas, sin espacios). Sin canonicalización, el mismo dato daría hashes distintos según el orden en que Prisma devuelva las columnas y la verificación daría falsos positivos.
- **`contenido`** — el JSON exacto que entró al hash: totales del inventario, detalle de diferencias, planilla de liquidación y aprobaciones. Sin él, el hash sería un número mágico irreproducible dentro de dos años.

Qué **no** entra al hash: nada volátil ni ajeno al cierre (`updatedAt`, el registro en el ERP, el nombre actual de un colaborador). Una alarma que suena sola termina ignorándose.

---

#### `GET /api/historial/inventarios`

Query (todos opcionales): `sucursalId`, `estado` (uno de los 5), `periodoAnio`, `periodoMes`, `limite` (1-100, default 24), `desplazamiento` (default 0).

Respuesta `200`:
```json
{
  "total": 3,
  "limite": 24,
  "desplazamiento": 0,
  "inventarios": [
    {
      "id": 8003,
      "sucursalId": 1,
      "sucursalNombre": "Market Central Luzuriaga",
      "estado": "liquidado",
      "periodo": "2026-08",
      "periodoAnio": 2026,
      "periodoMes": 8,
      "tamanoHoja": 50,
      "snapshotItems": 8000,
      "abiertoEn": "2026-08-01T09:00:00.000Z",
      "cerradoEn": "2026-08-28T18:00:00.000Z",
      "abierto": false,
      "resultado": {
        "itemsTotales": 8000,
        "itemsConDiferencia": 96,
        "itemsCuadrados": 7904,
        "porcentajeCuadrado": 98.8,
        "montoFaltanteBruto": 2200,
        "montoFaltanteNeto": 1650,
        "cuotaBase": 150
      },
      "lacrado": null,
      "aprobaciones": 0
    }
  ]
}
```

Ordenado del más reciente al más viejo. `itemsCuadrados`, `porcentajeCuadrado`, `montoFaltanteNeto` y `cuotaBase` **se calculan**, no son columnas — misma regla que deja a `Conteo` sin columna `total`.

#### `GET /api/historial/inventarios/:id`

Detalle completo: resultado con el embudo de los 3 conteos, resumen de liquidación, **hojas** (con asignados y avance), conteo de diferencias, **aprobaciones con identidad** y **lacrado**.

Respuesta `200` (recortada):
```json
{
  "id": 8001,
  "sucursal": { "id": 1, "nombre": "Market Central Luzuriaga" },
  "estado": "lacrado",
  "periodo": "2026-06",
  "tamanoHoja": 50,
  "abierto": false,
  "cerradoPor": { "id": 103, "nombre": "Gilmer Quispe" },
  "resultado": {
    "itemsTotales": 8000, "itemsConDiferencia": 130,
    "itemsSegundoConteo": 650, "itemsTercerConteo": 130,
    "unidadesFaltantes": 412, "unidadesSobrantes": 55,
    "montoFaltanteBruto": 1850, "montoNegativos": 310, "montoFaltanteEmpresa": 150,
    "colaboradoresAlcanzados": 11, "colaboradoresAsistieron": 8, "multaInasistencia": 20,
    "itemsCuadrados": 7870, "porcentajeCuadrado": 98.4,
    "resueltosEnSegundo": 520, "resueltosEnTercero": 0,
    "montoFaltanteNeto": 1390, "cuotaBase": 126.36,
    "faltantes": 3, "fondoMultas": 60, "bonoAsistencia": 7.5,
    "residuoCentavos": 0.04
  },
  "hojas": [{ "id": 1, "numeroConteo": 1, "numero": "002", "zona": "A", "gondola": "3",
              "tamano": 50, "estado": "finalizada", "sync": "sincronizado",
              "asignados": [{ "id": 102, "nombre": "María Rojas" }],
              "productos": 50, "contados": 50 }],
  "diferencias": 6,
  "liquidaciones": 11,
  "aprobaciones": [
    { "aprobadorId": 103, "aprobadorNombre": "Gilmer Quispe", "rolAlAprobar": "auditor",
      "aprobadoEn": "2026-06-29T10:00:00.000Z", "nota": null },
    { "aprobadorId": 106, "aprobadorNombre": "Rosa Melgarejo", "rolAlAprobar": "auditor",
      "aprobadoEn": "2026-06-29T14:00:00.000Z", "nota": "Revisado contra el reporte de negativos de Jocelyn." }
  ],
  "lacrado": {
    "folio": "INV-2026-06-LUZ-8000-06A",
    "hash": "06af20c9f741...",
    "hashAlgoritmo": "sha256",
    "lacradoEn": "2026-06-29T16:00:00.000Z",
    "lacradoPor": { "id": 103, "nombre": "Gilmer Quispe" },
    "registroErp": { "referencia": "AJ-2026-06-0114", "registradoEn": "2026-07-02T11:00:00.000Z",
                     "registradoPor": { "id": 103, "nombre": "Gilmer Quispe" } }
  }
}
```

`rolAlAprobar` es el rol **congelado al firmar**, no el actual del colaborador: si mañana esa persona cambia de rol, la firma tiene que seguir diciendo con qué autoridad se dio.

`residuoCentavos` son los centavos que deja el redondeo de la cuota (1390 ÷ 11 = 126.36 × 11 = 1389.96, sobran 4). Se expone en vez de esconderse. **Pendiente de definir con el cliente**: hoy el residuo queda a favor del personal.

Errores: `403` inventario de otra sucursal · `404` no existe.

#### `GET /api/historial/inventarios/:id/diferencias`

Paginado **siempre**: son hasta 8.000 ítems y devolverlos enteros en un JSON es como el sistema se cae el día que alguien abre un mes malo desde el celular.

Query: `tipo` (`faltante` | `sobrante`), `resueltoEnConteo` (1-3), `limite` (1-500, default 100), `desplazamiento`.

Respuesta `200`:
```json
{
  "total": 5, "limite": 100, "desplazamiento": 0,
  "diferencias": [
    { "codigo": "IT-1002", "descripcion": "Cerveza Cusqueña Dorada 620ml",
      "stockSistema": 240, "conteoFinal": 215, "diferencia": -25, "tipo": "faltante",
      "resueltoEnConteo": 3, "costoUnitario": 6.5, "montoDiferencia": -162.5 }
  ]
}
```
Ordenado por diferencia ascendente: los faltantes más grandes primero.

#### `GET /api/historial/inventarios/:id/liquidacion`

La planilla de la Pantalla 6, una fila por colaborador.

Respuesta `200` (recortada):
```json
{
  "inventarioId": 8001,
  "periodo": "2026-06",
  "resumen": { "montoFaltanteNeto": 1390, "cuotaBase": 126.36, "faltantes": 3,
               "fondoMultas": 60, "bonoAsistencia": 7.5, "residuoCentavos": 0.04 },
  "planilla": [
    { "colaboradorId": 108, "nombre": "Carla Depaz", "nombreActual": "Carla Depaz",
      "dni": "4483", "rol": "conteo", "asistio": true,
      "cuotaBase": 126.36, "multaInasistencia": 0, "bonoAsistencia": 7.5,
      "totalDescuento": 118.86 },
    { "colaboradorId": 107, "nombre": "Luis Shuan", "asistio": false,
      "cuotaBase": 126.36, "multaInasistencia": 20, "bonoAsistencia": 0,
      "totalDescuento": 146.36 }
  ]
}
```

`nombre` es el **congelado al liquidar** (lo que decía el recibo); `nombreActual` va al lado para identificar a la persona si se renombró después. `totalDescuento` se calcula (`cuota + multa − bono`), no es una columna.

#### `GET /api/historial/inventarios/:id/lacrado/verificacion`

Recalcula el hash sobre el estado **actual** del inventario y lo compara con el sellado. Es lo que convierte la inmutabilidad de una promesa en un control comprobable.

Respuesta `200`:
```json
{
  "inventarioId": 8001,
  "folio": "INV-2026-06-LUZ-8000-06A",
  "lacradoEn": "2026-06-29T16:00:00.000Z",
  "verificadoEn": "2026-09-04T02:20:00.000Z",
  "intacto": true,
  "hashGuardado": "06af20c9f741...",
  "hashRecalculado": "06af20c9f741...",
  "seccionesAlteradas": [],
  "versionDistinta": false
}
```

`seccionesAlteradas` dice **dónde** mirar (`diferencias`, `liquidaciones`, `resultado`, `aprobaciones`…). Un booleano solo dice "algo cambió"; esto es la diferencia entre una alarma útil y una que se ignora.

Errores: `409` el inventario todavía no está lacrado.

#### `GET /api/historial/items/:codigo`

El histórico de un artículo a través de todos los inventarios cerrados — *"este producto, cuántas veces dio diferencia este año"*. Un ítem que da faltante todos los meses no es un error de conteo: es merma sistemática o robo, y la única forma de verlo es mirar la serie, no un mes.

`:codigo` es el `ItemNumber` de Dynamics — la única identidad estable del artículo entre períodos (por eso `DiferenciaItem` guarda el código como texto y no una FK a `Producto`, que cuelga de una hoja de **un** inventario).

Query: `sucursalId`, `desdeAnio`, `hastaAnio`.

Respuesta `200`:
```json
{
  "codigo": "IT-1001",
  "descripcion": "Aceite Vegetal Primor 900ml",
  "resumen": {
    "veces": 3, "vecesFaltante": 3, "vecesSobrante": 0,
    "unidadesFaltantes": 66, "unidadesSobrantes": 0,
    "montoAcumulado": -587.4,
    "peorPeriodo": { "anio": 2026, "mes": 7, "diferencia": -29 }
  },
  "apariciones": [
    { "inventarioId": 8001, "sucursalNombre": "Market Central Luzuriaga",
      "periodo": "2026-06", "estadoInventario": "lacrado",
      "stockSistema": 120, "conteoFinal": 98, "diferencia": -22,
      "resueltoEnConteo": 3, "montoDiferencia": -195.8 }
  ]
}
```

Solo cuenta inventarios que llegaron a cerrar: uno en curso todavía puede resolver esa diferencia en el 2do o 3er conteo.

#### `GET /api/historial/comparativo`

Serie mes a mes con la variación contra el período anterior.

Query: `sucursalId`, `desdeAnio`, `hastaAnio` (400 si `desdeAnio > hastaAnio`).

Respuesta `200`:
```json
{
  "sucursalId": 1,
  "periodos": 3,
  "serie": [
    { "periodo": "2026-06", "periodoAnio": 2026, "periodoMes": 6,
      "itemsTotales": 8000, "itemsConDiferencia": 130, "montoFaltanteNeto": 1390,
      "porcentajeCuadrado": 98.4, "variacionFaltantePct": null,
      "inventarioId": 8001, "sucursalNombre": "Market Central Luzuriaga",
      "folio": "INV-2026-06-LUZ-8000-06A" },
    { "periodo": "2026-07", "montoFaltanteNeto": 1550, "variacionFaltantePct": 11.5, "folio": "INV-2026-07-LUZ-8000-844" }
  ]
}
```

`variacionFaltantePct` es `null` en el primer punto: no hay contra qué comparar, y devolver `0` ahí sería afirmar "no cambió", que es una mentira distinta.

---

### El control de dos personas — aprobación y lacrado

El cierre del mes exige **dos aprobaciones de dos personas distintas** (Gilmer y Michell en la reunión; los dos auditores en `mobile/design/lacrado.html`).

**Quien aprueba sale SIEMPRE del token, nunca del body.** Es la misma regla que ya gobierna el rol en todo el proyecto: lo que manda el cliente no define quién es. Una doble validación que una sola persona puede completar no es un control, es un botón doble.

> ⚠️ **La app móvil tiene que cambiar.** Hoy muestra los dos botones "Aprobar" a la vez en la misma pantalla, y un auditor puede tocar el de la fila del otro. Con este backend eso ya no funciona: cada firma se registra contra el colaborador de la sesión que la envía. **En la práctica hacen falta dos sesiones — dos dispositivos, o un logout/login — para lacrar.** Es correcto: es exactamente el punto de un control de dos personas. La pantalla debería mostrar un solo botón "Aprobar como <el usuario logueado>" y el estado de la otra firma como información, no como acción.

Quién puede firmar: `administrador` y `auditor`. **Pendiente de confirmar con el cliente**: la Decisión 1 de `docs/pantallas.md` aclara que Michell es *coordinador*, lo que haría la doble validación auditor + coordinador; la maqueta ya validada muestra dos auditores. Se tomó la lectura restrictiva porque el costo de los dos errores no es simétrico: si sobra un rol, alguien que no corresponde cierra el mes de forma irreversible; si falta, se agrega en una línea.

#### `POST /api/historial/inventarios/:id/aprobaciones`

Registra la firma **del colaborador de la sesión**.

Body:
```json
{ "nota": "Revisado contra el reporte de Jocelyn." }
```
`nota` es opcional y es **el único campo aceptado**. El schema es `.strict()`: un body con `aprobadorId`, `colaboradorId` o `rolAlAprobar` responde **`400`**, no se ignora en silencio — quien intenta firmar por otro tiene que enterarse, y si la app vieja todavía manda ese campo, el 400 es la señal que necesita para corregirse.

Respuesta `201`:
```json
{
  "inventarioId": 8003,
  "aprobadorId": 103,
  "aprobadorNombre": "Gilmer Quispe",
  "rolAlAprobar": "auditor",
  "aprobadoEn": "2026-09-04T02:19:00.000Z",
  "nota": null,
  "aprobacionesTotales": 1,
  "listoParaLacrar": false
}
```

Errores:
- `400` — el body trae un campo de identidad (ver arriba).
- `403` — rol sin permiso, o inventario de otra sucursal.
- `409` — **ya aprobaste este inventario** (la segunda firma la tiene que dar otra persona, desde su propia sesión); el inventario está `en_curso`, `lacrado` o `anulado`; o ya tiene las dos firmas.

La base lo sostiene además con `@@unique([inventarioId, aprobadorId])`: la regla de "tienen que ser dos personas distintas" sale gratis de esa restricción, no de un `if`.

#### `POST /api/historial/inventarios/:id/lacrado`

Cierra el mes. **Es la operación más irreversible del sistema.**

Body: `{}` — no acepta ningún campo (`.strict()`). El contenido a sellar lo arma el backend leyendo el inventario; aceptarlo del cliente sería dejar que el sellado declare lo que quiere haber sellado.

En una sola transacción: se crea el sello, el inventario pasa a `lacrado` y se libera la sucursal (`abierto: null`) para el inventario del mes siguiente. Si fueran operaciones sueltas y fallara la del medio, quedaría un sello sin inventario cerrado — o peor, una sucursal bloqueada con un inventario ya firmado.

Respuesta `201`:
```json
{
  "inventarioId": 8003,
  "folio": "INV-2026-08-LUZ-8000-0AA",
  "hash": "0aa84d76e3ea...",
  "hashAlgoritmo": "sha256",
  "lacradoEn": "2026-09-04T02:19:05.000Z",
  "lacradoPor": { "id": 103, "nombre": "Gilmer Quispe" },
  "aprobadoPor": [
    { "id": 103, "nombre": "Gilmer Quispe", "rol": "auditor", "aprobadoEn": "..." },
    { "id": 106, "nombre": "Rosa Melgarejo", "rol": "auditor", "aprobadoEn": "..." }
  ]
}
```

Errores: `403` rol o sucursal · `409` ya está lacrado, faltan aprobaciones (*"el lacrado exige 2 de personas distintas y hay 1"*), o el estado no es `conteo_cerrado`/`liquidado`.

#### `POST /api/historial/inventarios/:id/lacrado/registro-erp`

Constancia de que TI cargó el ajuste **a mano** en Dynamics. El backend **no escribe al ERP**: el ajuste automático es fase 2, decisión del cliente (`docs/pantallas.md`, Decisión 5). Este endpoint solo deja registro de que alguien lo hizo.

Body: `{ "referencia": "AJ-2026-08-0221" }` — el número de asiento o diario del ERP, opcional.

Respuesta `201`:
```json
{
  "inventarioId": 8003,
  "folio": "INV-2026-08-LUZ-8000-0AA",
  "referencia": "AJ-2026-08-0221",
  "registradoEn": "2026-09-04T02:19:06.000Z",
  "registradoPor": { "id": 103, "nombre": "Gilmer Quispe" }
}
```

Errores: `409` el inventario no está lacrado, o ya figura como registrado.

---

### Datos de demo del histórico

`npm run prisma:seed` siembra el **padrón** (tiendas y personas reales). El histórico es aparte, porque son datos de ejemplo de un proceso que todavía no corrió nunca:

```bash
npm run prisma:seed-historial     # 2 inventarios lacrados + 1 esperando firmas
npm run prisma:limpiar-historial  # borra solo los ids 8001-8003, para re-sembrar
```

Deja en Market Central Luzuriaga:

| Período | Estado | Datos |
|---|---|---|
| 2026-06 | `lacrado` + registrado en ERP | Los números del mockup del cliente: 8.000 ítems, 130 con diferencia, S/1850 − 310 − 150 = **1390 neto**, cuota **126.36**, 3 faltas. Folio `INV-2026-06-LUZ-8000-06A`. |
| 2026-07 | `lacrado`, **sin** registrar en ERP | S/2050 − 340 − 160. Tamaño de hoja 30 (es configurable y cambia entre inventarios). Muestra el caso real "lacrado pero pendiente de registro manual". |
| 2026-08 | `liquidado`, **0 / 2 firmas** | Los números de `mobile/design/liquidacion.html`: S/2200 − 380 − 170 = **1650**, cuota **150** exacta. Es el que deja ver la pantalla de lacrado en su estado interesante, con el botón bloqueado. |

Los mismos códigos de artículo se repiten en los tres períodos a propósito: sin repetición no hay histórico por artículo que mirar.

El hash de los sellos de demo se calcula con **las mismas funciones** que usa el endpoint real, así que `GET .../lacrado/verificacion` sobre ellos da `intacto: true` de verdad y la pantalla se puede validar de punta a punta.

### Verificación contra la base real

Los dos scripts que se usaron para verificar todo esto quedan en el repo — sin ellos nadie puede repetir la comprobación:

```bash
npm run verificar:db    # restricciones contra Postgres (transacción + rollback: no deja filas)
npm run verificar:api   # flujo completo contra el backend vivo en :3000
```

`verificar:db` prueba, escribiendo **directo en la base** (no por la API), que Postgres rechaza: un segundo inventario abierto en la misma sucursal, dos inventarios del mismo período, la misma persona firmando dos veces, un segundo lacrado sobre el mismo inventario, y el `UPDATE`/`DELETE` sobre un sello o una firma. Una regla que solo vive en un `if` la saltea cualquiera que escriba directo en la tabla.

`verificar:api` prueba el conteo ciego (403 para rol `conteo`), el recorte por sucursal, los derivados calculados, la verificación del sello, y el control de dos personas completo: una firma por sesión, el 409 cuando la misma persona intenta dar la segunda, el 409 al lacrar con una sola, y el 400 cuando el body intenta declarar `aprobadorId`.

## Desarrollo

```bash
npm install
npm run typecheck
npm test          # tests de codigo puro (Zod, permisos, hasheo de PIN, mapeo/paginacion/token D365), no requieren Postgres ni red
npm run dev        # requiere backend/.env con DATABASE_URL apuntando a Postgres corriendo
```
