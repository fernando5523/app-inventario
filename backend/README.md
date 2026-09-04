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

### Dynamics 365 — `/api/d365` (requiere sesión)

Integración de **solo lectura** con D365 Finance & Operations (OAuth2 `client_credentials` contra Azure AD). No hay, ni va a haber en esta fase, ningún endpoint que escriba de vuelta a Dynamics — el ajuste automático es fase 2, decisión del cliente (ver `app/auditor/lacrado.tsx`).

**`D365_DATA_AREA_ID = "trv"` — CONFIRMADO POR EL CLIENTE como Market Trujillo (2026-09-03). Ya no es un supuesto.** Si algún día se reconecta contra otro ambiente/empresa, hay que volver a confirmar esto explícitamente antes de tocar `.env` — traer el catálogo de la empresa equivocada es peor que no traerlo: no tira ningún error, simplemente parece que funcionó.

**Las entidades y el mapeo de abajo salieron de probar contra el tenant real** (`mistr.operations.dynamics.com`, empresa `trv`), no de la documentación genérica de D365 — la primera versión de este módulo apuntaba a `ReleasedProducts`/`ProductBarcodes` (nombres "de manual") y ninguna de las dos funciona en este ambiente. Se corrigió después de traer una muestra chica (nunca los 8.000 de una) y, para el tema de las unidades de conversión, después de revisar cómo lo resuelven otros proyectos de integración con este mismo tenant (`D:\Documentos\python\app007-validacion_productos`).

**Entidades OData que se consultan:**
- `ReleasedProductsV2` — catálogo maestro. **`ReleasedProducts` a secas da 404** en este ambiente ("No route data was found"). Tampoco existen `ItemId`, `ProductName` ni `ProductDescription` en `ReleasedProductsV2` (dan 400 "property not found") — el único nombre disponible es `SearchName`, y viene recortado y en mayúsculas fijas (ej. `"SAPOLIOLIMPIATODOANT"`).
- `ProductBarcodesV2` — códigos de barra por producto (**no** `ProductBarcodes`, que es la V1; ambas responden pero V2 trae mejor dato). Trae `ProductDescription`, que sí es un nombre legible de verdad (ej. `"SAPOLIO LIMPIATODO ANTIBACTERIAL COCO 900 ML"`) — mejor fuente de descripción que `SearchName`.
- `ProductSpecificUnitOfMeasureConversions` — **acá vive el factor del empaque**, NO en `ProductBarcodesV2.ProductQuantity` (ver más abajo). No acepta filtro por `dataAreaId`; se trae completa (37.6k filas en este tenant, paginada igual que las demás) y se agrupa localmente por `ProductNumber`.

**HALLAZGO IMPORTANTE — el código de barras nunca identifica el empaque.** En una muestra real de 100+ productos, **el 100% de los barcodes de `ProductBarcodesV2` tienen `ProductQuantity: 0` y `IsDefaultDisplayedBarcode: "No"`** — nunca `1`, nunca `"Yes"`, nunca una cantidad mayor a 1. Es decir: todo barcode identifica la unidad suelta del producto, nunca "esto es una caja de 12". **Consecuencia real para el escáner: puede confirmar QUÉ producto es, pero nunca en qué empaque viene** — eso lo tiene que elegir a mano el operario. No es un bug de nuestro mapeo: es así como está cargado el dato en Dynamics hoy, y otro proyecto de integración contra el mismo tenant (`app-barcode`, `app007-validacion_productos`) se topa con la misma limitación sin resolverla.

**Dónde vive de verdad el factor de empaque** (`d365-catalogo.service.ts#elegirEmpaque`): en `ProductSpecificUnitOfMeasureConversions`, filtrada por `ProductNumber`. Cada fila tiene `FromUnitSymbol`, `ToUnitSymbol` y un `Factor` numérico real — confirmado contra datos reales: `{ProductNumber: '110605', FromUnitSymbol: 'Emp.12', ToUnitSymbol: 'U', Factor: 12}`. Una fila con `Factor: 1` es solo la equivalencia entre `"U"` y `"U."` (misma unidad, dos grafías) y no cuenta como empaque; el resto (`Factor != 1`) son empaques alternos de verdad. **La tabla admite varias filas por producto** (varios empaques simultáneos, ej. Caja y Pack) — en la muestra real que se probó (100 productos) ninguno mostró dos a la vez, pero el mecanismo lo soporta.

**Mapeo a nuestro dominio:**
- `codigoBarras` (unidad suelta) = el barcode marcado `IsDefaultDisplayedBarcode="Yes"` si existe, si no el primero que haya (`ProductQuantity` no sirve de desempate acá: siempre es 0). Sin ningún barcode, se usa el `ItemNumber` como último recurso (nunca queda vacío).
- `descripcion` = `ProductBarcodesV2.ProductDescription` del barcode elegido (nombre legible), si no `SearchName` de `ReleasedProductsV2`, si no el `ItemNumber`.
- `empaque` = la fila de `ProductSpecificUnitOfMeasureConversions` con mayor `Factor` (excluyendo las de `Factor: 1`). Sin ninguna, factor `1` con la unidad de inventario/compra de D365.
- `empaque.codigoBarras` **nunca se llena** — no existe un barcode específico por empaque en este tenant (ver el hallazgo de arriba).
- **Limitación documentada**: nuestro `Producto` modela un solo `Empaque` por ítem. Si D365 trae más de uno para el mismo producto, se toma el de mayor factor (el más grande, ej. Caja antes que Pack) y el resto se descarta — pendiente de decidir si el dominio pasa a admitir varios.

**Paginación**: `d365-entity.service.ts` primero pide `$count`, arma los lotes con `calcularPaginas(total, tamanoLote)` (500 por defecto) y trae cada lote con `$skip`/`$top` — con 8.000 ítems no es opcional. El token OAuth2 se cachea en memoria y se renueva solo si vence en menos de 5 minutos; si Dynamics responde `401` con el token cacheado, se pide uno nuevo una sola vez y se reintenta.

#### `GET /api/d365/estado`
Cualquier rol autenticado. `{ "configurado": true | false }` — si `false`, faltan una o más `D365_*` en el entorno (ver `.env.example`).

#### `POST /api/d365/snapshot`
Rol `administrador` o `coordinador` — es el paso 1 del wizard del Coordinador (`mobile/lib/puertos/repositorios.ts#RepositorioInventario.traerSnapshot`).

Body:
```json
{ "sucursalId": 1, "modo": "real" }
```
- `modo` es opcional, default `"real"`. `"ejemplo"` nunca toca red ni exige credenciales: devuelve siempre los mismos 4 productos ya validados en `mobile/design/conteo.html` (Aceite Vegetal Primor, Cerveza Cusqueña, Leche Evaporada, Fideos Canuto), cada uno con su empaque. Nunca se sustituye `"real"` por datos de ejemplo en silencio — si no hay credenciales y se pide `"real"`, es un `400`, no un fallback automático.

Respuesta `200`:
```json
{ "inventarioId": 7, "items": 8000, "tomadoEn": "2026-09-03T14:00:00.000Z" }
```

**Idempotente**: si la sucursal ya tiene un `Inventario`, se devuelve ese mismo (mismo `inventarioId`/`items`/`tomadoEn`) en vez de crear uno nuevo ni volver a golpear Dynamics — mismo contrato que el puerto del front. *Simplificación documentada*: como todavía no existe en este backend un módulo de hojas/inventario, "ya tiene un inventario" se resuelve como "existe al menos una fila para esa sucursal", no "hay uno en curso sin cerrar" — cuando exista ese módulo, esta regla se va a tener que afinar.

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
  "empaque": { "nombre": "Caja", "factor": 12, "codigoBarras": "17750123051" },
  "ubicacion": "Góndola A2 · Nivel 3"
}]
```

#### `GET /api/hojas/:id/productos/barras/:codigo`
`RepositorioCatalogo.porCodigoBarras`. Matchea contra el código de la **unidad suelta** y también contra el del **empaque** (la caja de 12 puede traer código propio): escanear la caja resuelve al mismo producto.

Respuesta `200`: un producto, mismo shape que arriba.

`404` cuando el código no pertenece a la hoja. **No es un error a mostrar en rojo**: es el caso de la góndola, donde el producto de al lado entra en cuadro del escáner. El front lo traduce a "este código no pertenece a la hoja" y no cuenta nada.

#### `PUT /api/hojas/:id/conteos/:productoId`
Guarda o corrige el conteo de un producto.

Body:
```json
{ "empaques": 2, "sueltas": 5, "confirmadoPorEscaner": true, "contadoEn": "2026-09-03T10:00:00.000Z" }
```
- `confirmadoPorEscaner` opcional, default `false`.
- `contadoEn` es la hora **del teléfono**, no la del servidor: la cola offline manda esto recién cuando vuelve el WiFi, y la diferencia puede ser de horas.
- **No se acepta `total`.** Si viene, se ignora. El total se calcula (`empaques × factor + sueltas`); guardarlo junto a sus partes garantiza que algún día no coincidan, y ése es el número que se audita contra el ERP.

Respuesta `200`:
```json
{ "conteo": { "productoId": 51, "empaques": 2, "sueltas": 5, "confirmadoPorEscaner": true, "contadoEn": "..." },
  "total": 53, "estadoHoja": "en-proceso" }
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

## Desarrollo

```bash
npm install
npm run typecheck
npm test          # tests de codigo puro (Zod, permisos, hasheo de PIN, mapeo/paginacion/token D365), no requieren Postgres ni red
npm run dev        # requiere backend/.env con DATABASE_URL apuntando a Postgres corriendo
```
