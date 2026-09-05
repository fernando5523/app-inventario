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
Cualquier rol autenticado. `{ "configurado": true | false }` — `d365AuthService.isConfigured()` mira `credenciales().origen`: `true` si hay credenciales completas en la base (`config_dynamics`) **o** en el entorno (`D365_*`, ver `.env.example`), `false` solo si `origen === "ninguno"`. Ver "Credenciales de Dynamics" más abajo para la precedencia entre las dos fuentes.

#### `GET /api/d365/almacenes`
Rol **`administrador`** unicamente. Lista los almacenes de Dynamics (entidad `Warehouses`) para que el Administrador **elija uno** al dar de alta una tienda.

**Viene FILTRADO por `ALMACENES_INVENTARIO`** (ver `d365.almacenes-inventario.ts`): el tenant tiene **70 almacenes** y solo **10** se inventarían. El resto son de **Tránsito** (mercadería en viaje) y **Cuarentena** (mercadería bloqueada), que no se cuentan — y sus nombres se parecen tanto a los de tienda que elegir el equivocado era cuestión de tiempo: *"ALMACÉN CUARENTENA MARKET LUZURIAGA"* contra *"ALMACÉN DISPONIBLE MARKET LUZURIAGA"*. Ese error no se avisa: se evita no ofreciéndolo.

`?todos=1` saltea el filtro, para dar de alta una tienda cuyo almacén todavía no está habilitado.

> **Por qué es una lista y no una regla sobre el código.** La nomenclatura parece sistemática (2ª letra = tipo: `D`isponible / `T`ránsito / `C`uarentena; 1ª = canal: `M`arket / `A`mayorista / `P`roducción), y tienta escribir `/^MD\d{2}/`. **Está mal, y hay contraejemplo**: `MD07_CEN` (ALMACÉN DISPONIBLE MARKET CENTER) cumple el patrón y el cliente lo excluyó explícitamente. Un patrón habría metido una tienda que nadie cuenta, y el faltante habría aparecido como un descuadre a fin de mes. **Cuál almacén se inventaría es una decisión de negocio, no una propiedad del código.**
>
> Se buscó primero en `app_inventarioautomatico`, donde se creía que estaba este filtro: **no existe**. Ese proyecto lo resuelve con el operador escribiendo los códigos a mano (`--warehouses MD11_CENT,AD04_TCE`).

**Alta automática**: al asociar un almacén a una tienda (`POST`/`PATCH /api/tiendas`), si no estaba habilitado **queda habilitado**, con registro en auditoría. Es lo que resuelve "cuando abre una tienda nueva" sin una pantalla aparte — la lista de almacenes de inventario y la lista de tiendas dadas de alta son, en la práctica, la misma cosa. Desasociar **no** lo saca: otra tienda puede estar usándolo.

**Sin configuración se muestran los 70, no cero.** Un selector vacío parecería que Dynamics no responde, y dejaría al Administrador sin poder dar de alta ninguna tienda sin ningún mensaje que lo explique.

Respuesta `200`, ordenada por codigo:
```json
[
  { "codigo": "AD04_TCE", "nombre": "ALMACEN DISPONIBLE TERRANOVA CENTER" },
  { "codigo": "MD11_CENT", "nombre": "ALMACEN DISPONIBLE MARKET CENTENARIO" }
]
```
Medido contra el tenant real: **70 almacenes**.

**Por que un endpoint y no un campo de texto:** un codigo mal tipeado no falla — trae el stock de OTRA tienda. La auditoria compara contra numeros que parecen validos y nadie se entera hasta que no cuadra a fin de mes. Si la lista sale del ERP, el error deja de ser posible.

#### `POST /api/d365/snapshot`
Rol `administrador` o `coordinador` — es el paso 1 del wizard del Coordinador (`mobile/lib/puertos/repositorios.ts#RepositorioInventario.traerSnapshot`).

Body:
```json
{ "sucursalId": 1, "modo": "real" }
```
- `tipo` es opcional, default `"mensual"`. **Define QUE UNIVERSO se cuenta**, no es una preferencia:
  - `"mensual"` → SOLO productos de responsabilidad del **empleado**. Los que asume la empresa quedan fuera. Medido contra el tenant real: **6.297 items**.
  - `"anual"` → **todo** el catalogo activo, empresa incluida ("en el anual ya cuentan todo"). Medido: **11.835 items** (6.732 del empleado + 5.103 de la empresa).

  El default es el mensual porque es el que se hace todos los meses; el anual hay que pedirlo explicito. Que alguien cuente 11.835 items creyendo que cuenta 6.297 es una jornada perdida.

  El filtro sale de `TRU_InventoryManagerPEEntities` (entidad CUSTOM del tenant): `ModuleType eq 'Invent'`, campo `TRU_InventoryManagerPE` con valores `Employee`/`Company`/`None`. Los `None` y los que no tienen fila NO se cuentan en el mensual: sin responsable asignado no hay a quien liquidarle una diferencia.

  El tipo se persiste en `Inventario.tipo` (`d365-catalogo.service.ts:703`) — ver la sección "Tipo de inventario: mensual y anual" más abajo para las restricciones que gobierna.
- **Solo se cuentan los productos CON EXISTENCIA en el almacen de la sucursal.** Decision del cliente, misma condicion que el desarrollo que la empresa ya usa en produccion (`qty === undefined || qty <= 0`): se descartan tanto los que el ERP no registra como los que declara en cero.

  La respuesta trae `descartados: { sinRegistro, stockCero }` y el snapshot lo deja ademas en `RegistroAuditoria` (`accion: "inventario.snapshot"`). Es la respuesta a "por que esta hoja no trae tal producto" sin volver a correr el snapshot.

  Medido con almacen `MD11_CENT`: **6.297 activos → 1.506 contables**, 4.749 sin registro y 42 en cero.

  ⚠️ Contrapartida a tener presente: un producto que ESTA en la gondola pero que el ERP cree en cero **nunca se va a contar**. El inventario deja de poder descubrir ese caso.

- `almacen` es opcional (`WarehouseId` de Dynamics, ej. `"MD11_CENT"`) — por defecto sale de `Sucursal.almacenId`, ver "El almacén de Dynamics: un atributo de la sucursal" más abajo; el parámetro es un **override explícito** para probar otro almacén sin reconfigurar la tienda. **El stock NO viene del catalogo de productos**: vive en la data entity `WarehousesOnHandV2` y se consulta POR ALMACEN (`$filter: InventoryWarehouseId eq '<codigo>'`). Sin almacén (ni por la sucursal ni por parámetro) no se consulta stock y `stockErp` queda en **null**.

  `null` NO es `0`, y la diferencia importa: "no se cuanto hay" y "hay cero" llevan a conclusiones opuestas. Un 0 falso hace que la auditoria reporte un faltante que no existe y que alguien lo pague.
- `modo` es opcional, default `"real"`. `"ejemplo"` nunca toca red ni exige credenciales: devuelve siempre los mismos 4 productos ya validados en `mobile/design/conteo.html` (Aceite Vegetal Primor, Cerveza Cusqueña, Leche Evaporada, Fideos Canuto), cada uno con sus empaques — el Aceite trae dos (Emp.12 y Emp.6) para poder probar de verdad la pantalla con más de un empaque por producto. Nunca se sustituye `"real"` por datos de ejemplo en silencio — si no hay credenciales y se pide `"real"`, es un `400`, no un fallback automático.

Respuesta `200`:
```json
{ "inventarioId": 7, "items": 8000, "tomadoEn": "2026-09-03T14:00:00.000Z" }
```

**Idempotente**: si la sucursal ya tiene un `Inventario` **en curso**, se devuelve ese mismo (mismo `inventarioId`/`items`/`tomadoEn`) en vez de crear uno nuevo ni volver a golpear Dynamics — mismo contrato que el puerto del front. La búsqueda es `{ sucursalId, abierto: true }` (`d365-catalogo.service.ts:657`), no "la fila más reciente": una sucursal que ya cerró su mes puede abrir el siguiente sin que el snapshot le devuelva el cerrado.

El catálogo mapeado (con barcode, empaque y **categoría** de cada ítem) se guarda en `CatalogoItem`, colgado del `Inventario` — es el catálogo crudo del snapshot, antes de partirse en hojas. Lo consume el paso 2 (`POST /api/inventarios/:id/hojas`, ver más abajo), que lo ordena por categoría y lo materializa en `HojaConteo` + `Producto`.

Errores: `400` `sucursalId` inválido, o `modo="real"` sin credenciales configuradas · `502` Dynamics respondió con error o no se pudo autenticar.

---

### Inventarios — `/api/inventarios` (requiere sesión + rol `coordinador` o `administrador`)

Los **pasos 2 y 3 del wizard del Coordinador**. El paso 1 (traer el catálogo) vive en `/api/d365/snapshot`, donde está la integración con el ERP.

> **Estos tres endpoints no existían.** El wizard corría contra el adaptador **en memoria** del móvil: el Coordinador creaba hojas, las repartía, cerraba la app y no quedaba nada. `mobile/lib/adaptadores/inventario-api.ts` tenía las rutas escritas y marcadas como *"Adivinadas: el backend todavía no tiene módulo de hojas/inventario"*. Este módulo es ese módulo, y `contenedor.ts` ya apunta a HTTP.

**Solo Coordinador y Administrador.** No es un detalle de permisos: quien reparte las hojas decide **quién cuenta qué**, y un Contador que pudiera repartirse las suyas elegiría las góndolas fáciles. El Auditor tampoco — audita lo que otros contaron, no arma el lote.

#### `POST /api/inventarios/:inventarioId/hojas`

Parte el catálogo en hojas del tamaño elegido — **todas de una**, no una por una. Body: `{ "tamano": 20 | 30 | 50 }` (`z.literal`, no un rango: 37 no es "un tamaño raro pero aceptable", es un error).

Respuesta `201` con el arreglo completo de `HojaDto`.

**El orden es lo que hace útil a la hoja.** Los ítems se agrupan por `categoria` (ver `dominio/lote.ts#ordenarParaContar`), no por código: el código de ítem de Dynamics no sigue el recorrido físico de la tienda, así que ordenando por código el operario arranca con un shampoo, sigue con una gaseosa y después una lata de atún — cruza el local en cada renglón, y con 31 hojas cruza la tienda 31 veces. Los que el ERP no clasificó van **al final, juntos, nunca afuera**: un producto que está en la góndola se cuenta igual.

Cada hoja se rotula con su categoría dominante (`zona`). Una hoja de 50 puede cruzar el límite entre dos categorías; se rotula con la que más aporta, porque el rótulo existe para que el operario sepa **dónde pararse**.

**Es DESTRUCTIVO a propósito**: borra las hojas previas del inventario y las rehace. El Coordinador tiene que poder equivocarse de tamaño — es una decisión que se toma antes de empezar. **Pero se niega con `409` si ya hay conteos cargados**: rehacer borraría trabajo hecho. Ese es el límite entre "todavía estoy armando" y "ya arrancamos".

**El conteo ciego es estructural acá.** Crear hojas es copiar `CatalogoItem` → `Producto` **dejando atrás** `stockErp`, `precioVenta` y `esEmpresa`. No es una omisión que haya que recordar: es el motivo por el que son dos tablas. Hay un test que se pone rojo si alguien los copia "para tenerlos a mano".

Errores: `400` sin ítems en el inventario (falta el paso 1) o tamaño inválido · `404` inventario inexistente **o de otra sucursal** (404 y no 403: no se confirma que exista) · `409` inventario cerrado, o ya hay conteos.

#### `POST /api/inventarios/:inventarioId/hojas/asignar`

Reparte entre los presentes las hojas **sin asignar**. Body: `{ "colaboradorIds": [10, 20, 30] }`. Respuesta `200` con todas las hojas.

**Sin asignar y no todas**: si el Coordinador reparte, llega alguien más tarde y vuelve a repartir, quien ya empezó a contar no puede quedarse sin sus hojas a mitad de camino.

**EL ORDEN DEL ARREGLO ES EL ORDEN DE REPARTO** — el primero se lleva el primer bloque. Con las hojas ordenadas por categoría, ese bloque es el primer tramo del recorrido, así que el Coordinador decide quién arranca por dónde. Prisma devuelve las filas en el orden que quiere, así que el service las reordena según el arreglo; un `orderBy: { id: 'asc' }` daba un reparto válido pero **no el pedido**, y nadie se enteraba.

El reparto es en **bloques contiguos** (`dominio/lote.ts#repartir`): cada persona camina un tramo, no salta de punta a punta. Si hay menos hojas que personas, las que sobran quedan sin hojas — no se parte una hoja a medias entre dos, que es como se cuenta dos veces lo mismo y nada de lo otro.

Los ids tienen que existir, estar activos y ser **de esa tienda**: sin esa verificación se le asigna una hoja a alguien de otra sucursal, que después la ve en "Mis hojas" y cuenta góndolas que no son las suyas.

Errores: `400` lista vacía o alguien que no es de la tienda · `409` no quedan hojas sin asignar.

#### `GET /api/sucursales/:sucursalId/inventarios/activo`

El inventario en curso de una sucursal. **Los 4 roles** — Contador y Auditor necesitan saber si hay uno abierto para mostrar la pantalla correcta; lo que no pueden es crear ni repartir.

Respuesta `200` con `{ inventarioId, items, tomadoEn, tamanoHoja, totalHojas }`, o **`null` con 200** si no hay ninguno en curso — no `404`: "esta sucursal todavía no tiene inventario" es el estado normal del día 1 del mes, no un error.

`tamanoHoja` es `null` mientras no haya hojas. La columna `Inventario.tamanoHoja` tiene `@default(50)`, así que devolverla siempre diría "hojas de 50" cuando no hay ninguna.

"En curso" es `estado: en_curso`, no "el último": un inventario cerrado no puede seguir apareciendo como activo o el Coordinador reabriría por error el del mes pasado.

#### Verificarlo

```bash
npm run verificar:wizard          # los 4 pasos por HTTP, con modo "ejemplo"
npm run verificar:wizard -- --dejar   # deja el inventario para revisarlo
```

Corre el flujo completo como lo haría el teléfono y chequea lo que importa: que no se pierda ningún ítem, que el conteo ciego se respete, y que cada persona tenga un tramo contiguo. **Borra el inventario de prueba al final** — corre contra la base del cliente, que tiene datos reales.

Para limpiar a mano: `npx tsx scripts/borrar-inventario.ts <id>`, que se niega si el inventario tiene conteos cargados (eso ya no es una prueba, es trabajo de alguien).

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
- `ronda` opcional, default `1` (`HojaConteo.numeroConteo`: 1er conteo, reconteo, auditoría). `RepositorioHojas` (`mias`/`todas`/`porNumero`, el que consume este endpoint) todavía no lo pasa — pero el ciclo de rondas SÍ es un concepto de primera clase en el front: `RepositorioInventario.resumenRonda(inventarioId, ronda)` / `.cerrarRonda(inventarioId, ronda)` (`mobile/lib/puertos/repositorios.ts`).
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

| Inventario | Tipo | Estado | Para qué |
|---|---|---|---|
| **8004** · Luzuriaga · 2026-05 | `mensual` | `conteo_cerrado` | 17 ítems — **solo responsabilidad del empleado**, las cervezas ni aparecen en su catálogo. Embudo 17 → 7 → 5. |
| **8006** · Luzuriaga · **2026-05** | `anual` | `lacrado` | 21 ítems — **todo**, empresa incluida. Mismo período que el 8004: conviven porque `tipo` entra en la restricción de período. Con sus dos firmas. |
| **8005** · Carhuaz · mes en curso | `mensual` | `en_curso` | Para ver la otra mitad de la regla del coordinador: **no** puede abrir la matriz de un inventario en curso. |

**El contraste mensual/anual es el punto**, y se ve en el resumen de cada uno:

```
MENSUAL (8004)  17 items · 14 auditables · 0 de empresa
                faltante S/355.50 · descontable S/355.50   <- todo va a nomina

ANUAL   (8006)  21 items · 18 auditables · 3 de empresa
                faltante S/847.20 · descontable S/355.50   <- S/491.70 los absorbe la empresa
```

#### Los datos tienen la forma del negocio real

**Empaques**: varios por producto, con los símbolos tal como los carga el ERP. El factor **no se hardcodea**: sale de `factorDesdeSimbolo()`, la misma función del catálogo real — si esa regla se rompe, el seed se rompe con ella.

```
Emp.12 = 12   Emp.6 = 6   Emp.24 = 24   Emp.20 = 20
Unidad = 1    Saco = 1    Ltr = 1
```

14 de los 17 ítems del mensual tienen **más de un empaque** (`Emp.24 + Emp.6 + Unidad`), y 3 tienen todos sus empaques en factor 1 (el arroz se cuenta por saco, el yogurt por litro).

**Stock del ERP en los tres estados**, porque los tres hacen falta para probar que la auditoría los distingue:

| Estado | Ítems | Qué significa |
|---|---|---|
| `> 0` | 17 | El ERP dice cuánto debería haber |
| `0` explícito | 2 | El ERP dice que **no debería haber ninguno** |
| `null` | 2 | El ERP **no trajo el dato**: no se puede auditar |

Los dos casos de stock cero están elegidos a propósito: uno se contó en 0 y **cuadra** (panetón fuera de temporada), y el otro aparece con 8 unidades — un sobrante puro, mercadería que entró sin registrarse. Ese segundo caso desaparecería de la matriz si un `0` se tratara como "sin dato".

Hay además un ítem **con diferencia pero sin precio**: la diferencia en unidades vale, el monto no (`sinPrecio: 1` en el resumen).

**Los conteos se cargan como los carga el operario** — "2 cajas + 1 pack + 3 sueltas", repartido del empaque más grande al más chico — no como un total plano. Así el seed ejercita el camino real (`LineaConteo` por empaque + `totalUnidades`) en vez de esquivarlo guardando un número ya sumado.

#### Idempotente

Correr cualquiera de los seeds dos veces no duplica ni rompe nada: las sucursales y colaboradores van por `upsert`, y cada inventario de demo se salta si ya existe. Verificado con una consulta de duplicados sobre `catalogo_items` y `empaques_catalogo` después de la segunda corrida: ninguno.

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
| `conteo_cerrado` | La 3ra ronda quedó fija (cierre de Gilmer): las cantidades ya no se recuentan. Lo escribe `rondas.service.ts#cerrar` junto con `ResultadoInventario` y el detalle de diferencias. |
| `liquidado` | La planilla de descuentos está calculada **y persistida**. Falta la firma. Lo escribe `POST /api/liquidacion/inventarios/:id/liquidar`. |
| `lacrado` | Cerrado e inmutable. Cualquier ajuste entra en el período siguiente. |
| `anulado` | Se abandonó sin llegar a lacrar (ej. snapshot equivocado). No produce histórico contable, pero libera la sucursal. |

**Las flechas no se saltean: se liquida ANTES de lacrar.** Decisión del cliente, y la única compatible con lo que el sello contiene — el hash incluye la planilla (`armarDatosLacrado` lee `inv.liquidaciones`), así que firmar antes de liquidar sellaba `liquidaciones: []` y la verificación respondía "intacto" para siempre. Por eso `ESTADOS_APROBABLES` es `['liquidado']` y nada más: que el estado no lo permita, en vez de una guarda que alguien puede saltear, es lo que hace de esto un control y no un recordatorio.

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

> **La app móvil ya está corregida** (`app/auditor/lacrado.tsx`): la fila de cada auditor solo tiene botón "Aprobar" si `auditor.id === yo` (la sesión actual); la fila del otro auditor muestra un badge "Falta su firma", no tocable. **En la práctica hacen falta dos sesiones — dos dispositivos, o un logout/login — para lacrar**, que es correcto: es exactamente el punto de un control de dos personas.

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

Errores: `403` rol o sucursal · `409` ya está lacrado, faltan aprobaciones (*"el lacrado exige 2 de personas distintas y hay 1"*), o el inventario **todavía no está liquidado** (*"el coordinador tiene que cerrar la planilla antes de que se pueda firmar el lacrado"*).

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

---

### Liquidación — `/api/liquidacion` (requiere sesión + rol `administrador`, `auditor` o `coordinador`)

La pantalla 6: faltante neto, cuota base, multas de asistencia y la planilla de descuentos. Espeja `RepositorioLiquidacion` del puerto del front.

**El `coordinador` SÍ entra acá**, al revés que en `/api/auditoria`. No es una inconsistencia: la matriz de auditoría contiene `stockErp` —el número que los 3 conteos cruzados existen para no conocer— y la liquidación no. Es plata y nómina; nada de eso le dice a nadie cuánto stock espera el ERP de un artículo, así que no hay conteo ciego que romper. Por eso el mockup le da al coordinador la Pantalla 6 y no la 5, y por eso el puerto dice textual *"solo lo usa el Coordinador (cierre de fin de mes, pantalla 6)"*.

El rol `conteo` no entra: el descuento de sus compañeros no es asunto de quien cuenta. Cada persona ve el suyo en el recibo, no la planilla de los once.

> **Por qué existe aparte de `GET /api/historial/inventarios/:id/liquidacion`**: ese endpoint pide un `inventarioId` y sirve para mirar un mes cerrado del archivo. La pantalla 6 no sabe ningún `inventarioId` — sabe en qué tienda está parada y pregunta "cómo quedó el último cierre de acá". Son dos preguntas distintas sobre los mismos datos.

#### `GET /api/liquidacion/sucursales/:sucursalId`

La liquidación del **último ciclo cerrado** de esa sucursal.

Respuesta `200`:
```json
{
  "periodo": "Agosto 2026",
  "faltanteBruto": 2200,
  "negativosDelMes": 380,
  "faltanteEmpresa": 170,
  "faltanteNeto": 1650,
  "cuotaBase": 150,
  "multaInasistencia": 20,
  "bonoAsistencia": 7.5,
  "totalFaltas": 3,
  "planilla": [
    { "colaboradorId": 108, "nombre": "Carla Depaz", "rol": "conteo", "asistio": true, "monto": 142.5 },
    { "colaboradorId": 107, "nombre": "Luis Shuan", "rol": "conteo", "asistio": false, "monto": 170 }
  ]
}
```

**Devuelve `200` con body `null`** —no `404`— cuando esa tienda todavía no tiene ningún inventario con el conteo cerrado. El puerto declara `Promise<Liquidacion | null>` y "todavía no hay nada que liquidar" es una respuesta válida, no un error: un 404 obligaría a la pantalla a tratar un estado normal como una falla. Y una planilla de ceros sería peor todavía — se lee como "no se descuenta nada", que es una afirmación muy distinta.

`monto` se **calcula** (`cuota + multa − bono`), no es una columna: misma regla que deja a `Conteo` sin columna `total`. `nombre` es el congelado al liquidar — lo que decía el recibo de sueldo de ese mes, no el nombre actual.

Un inventario `en_curso` nunca se liquida: las cantidades todavía pueden cambiar en el 2do o 3er conteo.

Errores: `403` rol sin acceso, o sucursal ajena.

#### `GET /api/liquidacion/sucursales/:sucursalId/conciliacion`

El detalle de "de dónde sale este número", para cuando Contabilidad pregunte por qué el total descontado no da exactamente igual al faltante neto.

Respuesta `200`:
```json
{
  "periodo": "Agosto 2026",
  "faltanteNeto": 1650,
  "sumaPlanilla": 1650,
  "diferenciaPorRedondeo": 0,
  "colaboradores": 11,
  "asistieron": 8,
  "faltaron": 3
}
```

`diferenciaPorRedondeo` son los centavos que deja el redondeo de la cuota (1390 ÷ 11 = 126.36 × 11 = 1389.96, sobran 4). Se expone en vez de esconderse. **Pendiente de definir con el cliente**: hoy queda a favor del personal.

Va aparte y no dentro de `Liquidacion` porque esa forma espeja el puerto del front y no se le pueden agregar campos sin romperlo.

#### `POST /api/liquidacion/inventarios/:inventarioId/liquidar`

Cierra la planilla: calcula el descuento de cada persona, lo **persiste** en `LiquidacionColaborador` y deja el inventario en `liquidado`. Los dos hechos van en una transacción — son un solo hecho de negocio, igual que cerrar la última ronda y cerrar el conteo.

Respuesta `201`:
```json
{
  "inventarioId": 20,
  "estado": "liquidado",
  "colaboradores": 11,
  "cuotaBase": 126.36,
  "bonoAsistencia": 11.42,
  "faltantes": 4,
  "totalDescontado": 1390
}
```

**Rol `administrador` o `coordinador` — el auditor NO.** Es quien firma el lacrado, y el sello incluye la planilla: si pudiera cerrarla y después firmarla, el control de dos personas se completa solo. No alcanza con que sean dos pasos, tienen que ser dos personas.

**Por qué existe**: `LiquidacionColaborador` se leía en el histórico y en el armado del sello, y solo la escribía el seed. En un inventario real la tabla quedaba vacía, el lacrado hasheaba `liquidaciones: []` y la verificación respondía "intacto" para siempre. Un sello sobre un documento vacío es peor que no tener sello.

El bono sale de `repartirExacto`, no de `bonoBase × asistentes`: la suma de la columna da el fondo al centavo (S/80 entre 7 daba S/80.01 con la multiplicación). Las filas guardan las **tres partes** — cuota, multa, bono — y nunca el total: misma regla que deja a `Conteo` sin columna `total`.

> ⚠️ **Hoy este endpoint responde `409` siempre, y está bien que así sea.** No existe mecanismo para registrar la asistencia ni para cargar los ajustes del mes, así que `ResultadoInventario.colaboradoresAsistieron` y `montoNegativos` son `NULL`. Sin esos dos datos no hay cuota ni bono que valgan, y escribir la planilla igual sería descontarle a alguien un monto calculado sobre un dato que nadie cargó. El endpoint queda listo y testeado para el día que el cliente defina la captura.
>
> **Para quien implemente esa captura**: un contador no alcanza. `colaboradoresAsistieron` es *cuántos*; la planilla necesita *quiénes* (`LiquidacionColaborador.asistio` es por persona). Si el mecanismo solo guarda el total, `liquidacion.cierre.ts#liquidar` sigue sin poder armar la planilla.

Errores: `404` inventario inexistente · `403` rol sin permiso (el mensaje dice quién sí puede) o sucursal ajena · `409` conteo todavía abierto, planilla ya cerrada, sin resultado calculado, o sin asistencia/ajustes registrados.

---

### Estado del lacrado — `GET /api/historial/inventarios/:id/lacrado/estado`

Requiere sesión + rol `administrador` o `auditor`. Es lo único que la pantalla 7 necesita para dibujarse entera: las dos filas de firma, la banda de sincronización y el botón. Espeja `EstadoLacrado` del puerto del front.

Respuesta `200`:
```json
{
  "inventarioId": 8001,
  "aprobaciones": [
    { "colaboradorId": 103, "nombre": "Gilmer Quispe", "fecha": "2026-06-29T10:00:00.000Z" },
    { "colaboradorId": 106, "nombre": "Rosa Melgarejo", "fecha": "2026-06-29T14:00:00.000Z" }
  ],
  "aprobacionesRequeridas": 2,
  "todoSincronizado": true,
  "lacrado": true,
  "hash": "06af20c9f741...",
  "lacradoEn": "2026-06-29T16:00:00.000Z",
  "registradoManualmenteEnDynamics": true
}
```

`aprobacionesRequeridas` viaja en la respuesta en vez de estar hardcodeado en el front: el día que sean tres, la pantalla se entera sola.

**`todoSincronizado`** es nuevo y trae una regla que el lacrado no tenía: **no se lacra con hojas sin sincronizar**. El puerto lo dice textual — *"no se puede lacrar con datos que no llegaron a Dynamics"*. Sellar un inventario al que le faltan conteos por subir es firmar un resultado incompleto, y como el sello es inmutable, esos conteos ya no entran nunca. `POST .../lacrado` ahora responde `409` en ese caso.

El orden de los chequeos al lacrar es deliberado: primero las aprobaciones, después la sincronización. La sincronización se resuelve sola esperando la WiFi de la tienda; las firmas no. Primero se le dice a la persona lo que **sí** tiene que ir a hacer.

Los tres endpoints de escritura (`POST .../aprobaciones`, `POST .../lacrado`, `POST .../lacrado/registro-erp`) ya estaban documentados más arriba, con la regla que los gobierna: **quien firma sale del token, nunca del body**.

---

### Credenciales de Dynamics — `/api/config-dynamics` (requiere sesión + rol `administrador`)

Espeja `RepositorioConfigDynamics`. **Solo `administrador`, sin excepciones — ni siquiera el auditor.** Son las llaves de la integración con el ERP de la empresa: quien las cambia puede apuntar todo el sistema a otro Dynamics.

#### La regla que gobierna este módulo entero

**El `clientSecret` entra, se cifra y se guarda. NUNCA sale.** No hay un solo endpoint que lo devuelva, ni siquiera enmascarado: la única forma de que un secreto no aparezca en un log, un cache o una captura de pantalla es que la respuesta no lo tenga. Lo único que se dice de él es `secretoConfigurado: true | false`.

Además se guarda **cifrado** con AES-256-GCM (`config-dynamics.cifrado.ts`), y eso resuelve un problema distinto del anterior: que la API no lo devuelva evita que se filtre por HTTP, pero no evita que quede en claro en una columna de Postgres — donde lo lee cualquier `SELECT *`, cualquier backup copiado a un disco compartido y cualquier dump que alguien mande por mail para "revisar un problema". Un backup viaja a muchos más lugares que una respuesta HTTP.

GCM y no CBC porque trae autenticación: un secreto manipulado en la base **falla** al descifrar, en vez de devolver bytes cualquiera que después se le mandan a Azure AD como si fueran válidos.

> **Lo que esto no protege, dicho de frente**: la clave sale de una variable de entorno del mismo servidor. Quien tiene acceso al proceso tiene las dos mitades. No es defensa contra un servidor comprometido — es defensa contra la ruta por la que estas cosas se filtran de verdad, que es un dump de base de datos dando vueltas.

**Paso manual pendiente** (igual que el del `.env`): para poder guardar un secreto hace falta `APP_CIFRADO_CLAVE` en `backend/.env`. Se genera con:

```bash
openssl rand -hex 32
```

Sin esa variable, `PUT` **rechaza** el secreto con `503` en vez de guardarlo en claro — un secreto que no se puede proteger no se guarda. Pero sí deja guardar `tenantId`/`clientId`/`urlBase`, que no son secretos, así que la pantalla no queda muerta.

#### Cargarlas desde el servidor — `npm run config:dynamics`

La vía recomendada para la carga INICIAL. Toma las `D365_*` que ya están en `backend/.env`, las cifra y las guarda en la base, por el mismo service que usa la pantalla del móvil (mismo cifrado, misma validación, mismo registro de auditoría):

```bash
cd backend
npm run config:dynamics            # carga
npm run config:dynamics -- --estado  # solo muestra qué hay hoy, no toca nada
```

Verifica de ida y vuelta: después de guardar vuelve a leer de la base y **descifra**, porque que el guardado no tire excepción no prueba que lo guardado se pueda recuperar. El `client_secret` no se imprime nunca — solo una huella enmascarada (`zN******48 (34 caracteres)`), que alcanza para confirmar "cargué el que empieza con zN" y no sirve para nada más.

**Por qué existe, si hay una pantalla**: un `client_secret` de Azure son 40+ caracteres sin sentido, y tipearlos en el teclado de un teléfono produce un error que después se diagnostica como "la integración no anda" — Azure responde `401` sin decir cuál de los cuatro campos está mal. La pantalla del móvil quedó de **solo lectura**: muestra el origen y permite probar la conexión, que es el diagnóstico que el Administrador sí necesita en la mano.

**Después de cargar hay que reiniciar el backend**: `d365Config` lee `process.env` una sola vez al importarse.

#### Precedencia sobre el `.env`

Si hay una fila en `config_dynamics` **con secreto**, gana sobre las `D365_*` del entorno; si no, se cae al `.env`. Ese orden y no el inverso porque la base es lo que una persona puede cambiar desde la pantalla, y el `.env` solo lo toca alguien con acceso al servidor. Si el entorno ganara, cargar las credenciales por pantalla no tendría ningún efecto y nadie entendería por qué.

> **El módulo `d365` usa esta precedencia de verdad** (verificado: `GET /api/d365/almacenes` trae los 70 almacenes reales con las credenciales de la base). Ningún archivo de `src/modules/d365/` importa ya `d365Config`: el token, la baseUrl de OData y el `dataAreaId` salen todos de `d365AuthService`, que las pide a `credencialesEfectivas()` y las cachea 60 segundos.
>
> Hubo un tiempo en que **no** era así, y vale la pena decir cómo se veía: `d365-auth.service.ts` leía el `.env` directo mientras la pantalla mostraba las de la base y la prueba de conexión respondía `origen: base`. Todo verde, y nada de lo que se cargaba tenía efecto sobre el traído del catálogo. Lo cubren dos suites: `config-dynamics.precedencia.test.ts` (la función decide bien) y `d365-auth.credenciales.test.ts` (el auth service la usa) — la primera sola pasaba igual durante el bug.

#### `GET /api/config-dynamics`

Respuesta `200`:
```json
{
  "tenantId": "11111111-2222-3333-4444-555555555555",
  "clientId": "66666666-7777-8888-9999-000000000000",
  "urlBase": "https://market-trujillo.operations.dynamics.com",
  "secretoConfigurado": true,
  "origen": "entorno",
  "puedeGuardarSecreto": false,
  "actualizadoEn": null
}
```

- `secretoConfigurado` — lo único que se dice del secreto.
- `origen` — `base` | `entorno` | `ninguno`: de dónde salen las credenciales que se están usando hoy.
- `puedeGuardarSecreto` — `false` si falta `APP_CIFRADO_CLAVE`. Se informa para que la pantalla explique por qué el campo está bloqueado, en vez de dejar que el guardado falle recién al apretar el botón.

Sin fila propia, refleja lo que hay en el entorno: así la pantalla muestra la configuración real y no un formulario vacío que haga pensar que Dynamics no está configurado cuando sí lo está.

#### `PUT /api/config-dynamics`

Body:
```json
{
  "tenantId": "11111111-...",
  "clientId": "66666666-...",
  "urlBase": "https://market-trujillo.operations.dynamics.com",
  "dataAreaId": "trv",
  "clientSecret": "Abc8Q~..."
}
```

- `clientSecret` es **opcional a propósito**: sin él se actualizan los otros campos y el secreto ya guardado queda intacto. Es lo que permite corregir un tenant mal tipeado sin obligar a nadie a ir a buscar el secreto entero a Azure de nuevo — y sin ese detalle, la gente termina pegando el secreto en un chat para tenerlo a mano.
- `urlBase` **exige `https://`** (un secreto no viaja en claro) y se le saca la barra final.
- `dataAreaId` opcional; vacío = se usa el del entorno.
- El schema es `.strict()`: un campo mal escrito (`client_secret` en vez de `clientSecret`) da **`400`**, no se ignora en silencio. Con un secreto, "se ignoró y no te avisamos" es la peor respuesta posible — la pantalla diría que guardó y Azure seguiría rechazando.

Respuesta `200`: el mismo shape del `GET`. **Nunca incluye el secreto**, ni el que acaba de recibir.

Errores: `400` forma inválida · `403` no es administrador · `503` vino un `clientSecret` y falta `APP_CIFRADO_CLAVE`.

Cada guardado escribe en `RegistroAuditoria` con `accion: "config_dynamics.actualizada"`. El secreto **nunca** viaja al log, ni cifrado: solo queda registrado que se cambió y una huella enmascarada (`Ab******re (48 caracteres)`) para poder confirmar "cargué el que empieza con ab" — mismo criterio que el reseteo de PIN.

#### `POST /api/config-dynamics/probar`

Prueba las credenciales **ya guardadas** contra Azure AD. Pide un token y nada más: no trae los 8.000 ítems del catálogo. La pregunta que responde es "estas credenciales sirven", y para eso alcanza con que Azure conteste — bajar el catálogo entero para averiguarlo son varios minutos de la WiFi de la tienda para una respuesta de sí/no.

Sin body. Respuesta **siempre `200`**:
```json
{ "ok": true, "mensaje": "Conexión correcta con Azure AD (credenciales tomadas de: entorno)." }
```
```json
{ "ok": false, "mensaje": "Azure AD rechazó las credenciales (HTTP 401). AADSTS7000215: Invalid client secret provided..." }
```

Que Azure rechace un secreto **no es un error del servidor**: es exactamente el resultado que esta prueba viene a averiguar, y la pantalla tiene que poder mostrarlo sin un `catch`. El mensaje incluye el código `AADSTS` de Azure (acotado a 300 caracteres) porque es lo que distingue un tenant inexistente de un secreto vencido de una app sin permisos.

### Verificación de estos tres

```bash
node scripts/verificar-puertos-pendientes-api.mjs   # backend en :3000
BASE_URL=http://localhost:3001 node scripts/verificar-puertos-pendientes-api.mjs   # otro puerto
```

Verifica, entre otras cosas, que el secreto no aparece en **ninguna** respuesta (ni en el `PUT` que lo recibe, ni en el `GET`, ni en el mensaje de la prueba), que el `409` de sincronización funciona, y que el body con `aprobadorId` sigue dando `400`.

---

### Cambio de PIN propio — `POST /api/sesion/cambiar-pin` (requiere sesión, **cualquier rol**)

Cualquiera cambia el suyo, incluido el rol `conteo`. Es el único camino por el que un PIN pasa a ser conocido **solo por su dueño**.

**Por qué hace falta, además del reseteo del administrador**: quien resetea **elige** el PIN, así que lo conoce. Un PIN que otra persona conoce no autentica a nadie — identifica a dos. Y este sistema apoya sobre el PIN algo bastante más serio que un login: la firma que cierra el inventario del mes. Si el administrador sabe el PIN de Gilmer y el de Rosa, puede entrar como los dos y completar solo la doble validación del lacrado, que es justamente el control que el sistema existe para sostener.

El reseteo del administrador sigue haciendo falta (alguien se olvida el PIN y hay que devolverle el acceso), pero es el camino de **excepción**: entrega un PIN que dos personas conocen, y el dueño debería cambiarlo enseguida por este endpoint.

Body:
```json
{ "pinActual": "000102", "pinNuevo": "820394" }
```

No lleva `colaboradorId`: quien cambia el PIN es el de la sesión, y eso sale del token. El schema es `.strict()`, así que un `colaboradorId` en el body da **400** — misma regla que la aprobación del lacrado.

**Exige el PIN actual** aunque el token ya pruebe quién es, y no es redundante: un token robado (un teléfono desbloqueado sobre el mostrador, una sesión que quedó abierta) alcanzaría para cambiarle el PIN al dueño y dejarlo afuera de su propia cuenta. Pedir el actual convierte ese robo en "puede usar la sesión hasta que expire" en vez de "se quedó con la cuenta".

**Al cambiar el PIN se cierran todas las sesiones de esa persona**, incluida la actual. Si lo está cambiando porque sospecha que alguien lo conocía, dejar vivas las sesiones abiertas de ese alguien haría que el cambio no sirviera de nada. Cuesta un segundo (volver a ingresar) y hace que el cambio signifique de verdad "desde ahora, solo yo".

PINs rechazados (`400`):
- El **predecible del seed** — el id del colaborador con ceros (`102` → `000102`). La pantalla de login lista a todas las personas con su nombre, así que cualquiera que abra la app lo deduce. Sería volver voluntariamente al agujero.
- Los **triviales**: todos los dígitos iguales (`000000`, `111111`) y secuencias corridas (`123456`, `654321`).
- Uno igual al actual.

Rate-limited igual que el ingreso (8 intentos / 15 min): pide el PIN actual, así que es otra puerta por donde se podría probar a fuerza bruta.

Respuesta `204`, sin body. Errores: `400` PIN inválido o rechazado · `401` el PIN actual no es correcto, o la cuenta no está disponible · `429` demasiados intentos.

Escribe en `RegistroAuditoria` con `accion: "colaborador.pin_cambiado_por_si_mismo"`. Nunca el PIN, ni el viejo ni el nuevo.

#### El camino completo de rotación de PINs

| Quién | Qué puede | Endpoint |
|---|---|---|
| `administrador` | Resetear el PIN de **cualquiera**, cualquier sucursal | `POST /api/usuarios/:id/resetear-pin` |
| `auditor` | Resetear solo `coordinador`/`conteo` **de su propia sucursal**. Nunca a otro auditor ni al administrador | `POST /api/usuarios/:id/resetear-pin` |
| `coordinador`, `conteo` | No resetean a nadie | — |
| **Cualquiera** | Cambiar **el suyo**, sabiendo el actual | `POST /api/sesion/cambiar-pin` |

> **Los PIN del seed ya no se derivan del id** (cambiado 2026-09-04). `prisma/seed.ts` los siembra fijos por rol (`PIN_DEV_POR_ROL`) y los imprime al terminar, así que hay que leer el repo o la consola para conocerlos — la app pública ya no los revela. Sirven igual para probar. Esto tapa solo la base de desarrollo; el endurecimiento de producción sigue pendiente, ver la sección siguiente.

---

### PIN de producción — Plan A implementado, B/C/D pendientes

> **Estado**: diagnóstico hecho y medido el 2026-09-04. **Plan A ya está implementado** (`usuarios.service.ts#crear`/`resetearPin` llaman a `validarPinElegible`, ver más abajo) — B, C y D siguen pendientes, postergados a propósito para no romper el flujo mientras se prueba conteo/auditoría/liquidación contra el catálogo real. Quien tome el resto no necesita volver a investigar: la evidencia y el plan están acá.

**El agujero, en una frase**: la lista de colaboradores es pública (la pantalla de login la necesita antes de que nadie se autentique) y el PIN que sembraba el seed era el id del colaborador con ceros. Cruzando las dos cosas, cualquiera con la app deducía el PIN de todos —incluido el administrador— sin leer una línea de código.

**Evidencia medida** (contra la base viva, `http://localhost:3000`):

- **Lista pública**: `GET /api/sesion/sucursales/:id/colaboradores` y `GET /api/sesion/administradores` responden `200` **sin token**, con id + nombre + DNI + rol. Solo `/ingresar` y `/cambiar-pin` llevan middleware de sesión.
- **PIN derivable**: probado un intento por colaborador con `pin = String(id).padStart(6,'0')`. En la base viva de ese día, **1 de 6** entró: `Admin Sistema` (id 1000, PIN `001000`), rol **administrador** — el peor caso. Los otros 5 ya tenían PIN propio (habían sido reseteados a mano). El riesgo real no era ese 1: era el seed, que dejaba a **los 30** derivables cada vez que se corría. Eso es lo que se corrigió (arriba).
- **Limitador** (`sesion.routes.ts#limitadorIngreso`): 8 intentos / 15 min, `key = colaboradorId ?? ip`. Verificado: el 9.º intento devuelve `429`. Es **por colaborador, no por IP** (bien: la WiFi de tienda es compartida). Dos costados: (1) permite un **DoS de cuenta** trivial — 8 intentos fallidos con el id de alguien lo dejan sin entrar 15 min; (2) comparte el cupo con `cambiar-pin` y usa MemoryStore (no se comparte entre instancias). Con PIN aleatorio, 8/15 min ≈ 768 intentos/día → ~28 % de acierto **en un año**; con PIN derivable, se acierta al primer intento y el limitador es irrelevante.
- **Plan A implementado (2026-09-04)**: `validarPinElegible` (`sesion.pin.ts`) ahora se llama también desde `usuarios.service.ts#crear` (solo el chequeo trivial — al crear, el id lo autogenera Prisma, así que el predecible no se puede evaluar todavía) y `#resetearPin` (los dos chequeos, predecible y trivial, porque ahí ya se conoce el id). Un admin ya **no** puede fijar `000022` ni `123456` — el backend los rechaza con `400`.
- **B, C y D siguen sin implementar** — ver el plan abajo.

**Plan, por orden de prioridad y costo:**

| | Qué | Estado | Cambios | Qué rompe | Costo |
|---|---|---|---|---|---|
| **A** | Bloquear PINs predecibles/triviales también al **crear** y **resetear** | ✅ Implementado (2026-09-04) | `validarPinElegible` en `usuarios.service.ts` crear y `resetearPin` | Nada del flujo; solo rechaza PINs malos que antes pasaban | **Bajo** (½ día) |
| **B** | **Forzar cambio de PIN en el primer ingreso** | Pendiente | Columna `debeCambiarPin Boolean @default(true)` en `Colaborador` + migración; `ingresar()` devuelve el flag; `crear`/`resetearPin` lo ponen en `true`, `cambiar-pin` en `false`; el login intercala el cambio antes del token útil (toca front) | El login gana un paso obligatorio; hay que sembrar el flag en los usuarios existentes | **Medio-alto** (2-3 días, front incluido) |
| **C** | Reset/alta genera PIN **aleatorio**, se muestra **una sola vez** | Pendiente | `resetearPin`/`crear` sin `pin` en el body: el server genera 6 dígitos (evitando predecible/trivial), hashea, y devuelve el valor una vez; la UI de Usuarios lo muestra en un modal "anotalo". Combina natural con B (entra como temporal) | El admin ya no teclea el PIN; cambia la UI de Usuarios | **Medio** (1-2 días) |
| **D** | Endurecer el limitador | Pendiente | Bajar `limit`, backoff incremental, separar la key de `cambiar-pin` de la de `ingresar` (que un ataque no bloquee el cambio legítimo), evaluar el DoS de cuenta | Poco; calibrar para no molestar el uso normal | **Bajo** (½ día) |

**Recomendación**: B como siguiente paso (tapa el resto del agujero de raíz), C encima para que un reset no deje el PIN en dos manos, D como ajuste fino. B rompe pruebas en curso, así que se implementa cuando el flujo esté validado, no antes.

---

### La auditoría contra un catálogo sin stock del ERP

`CatalogoItem.stockErp` es nullable, y el módulo de auditoría **distingue "sin dato" de "cero"**. No es un detalle de tipos: es la diferencia entre un inventario auditable y uno que miente.

Los 11.835 productos traídos de Dynamics todavía no tienen stock cargado. Con la primera versión del módulo —que hacía `stockErp ?? 0`— esos ítems daban diferencia 0, veredicto `cuadrado`, y el resumen decía **"100% cuadrados"**: un falso "todo bien" en la única pantalla donde se decide si el inventario cierra. Corregido.

**El stock sale únicamente de `CatalogoItem.stockErp`** — el snapshot de Dynamics tomado al abrir el mes — y nunca de otro lado. `Producto` no tiene stock y no puede tenerlo: es lo que ve quien cuenta.

Dos veredictos nuevos para lo que no se puede afirmar:

| Veredicto | Cuándo | `diferenciaUnidades` |
|---|---|---|
| `sin_erp` | El snapshot no trajo stock: no hay contra qué comparar | `null` |
| `sin_contar` | Hay stock del ERP, pero ninguna hoja finalizada incluye el ítem | `null` |
| `cuadrado` | El conteo final coincide con el ERP | `0` |
| `empresa` | Hay diferencia y la asume gerencia | el número |
| `falta` | Hay diferencia (faltante **o** sobrante) | el número |

`sin_erp` gana sobre `esEmpresa`: sin stock no se puede afirmar nada del ítem, ni siquiera que la empresa lo absorbe.

Cada fila trae `motivoSinDato` con el texto legible, para que la pantalla lo muestre tal cual sin traducir un enum.

Un `0` **sí** es un dato real de los dos lados: `stockErp: 0` dice "no debería haber ninguno" y un conteo de `0` dice "no hay ninguno en góndola". Lo que no puede ser `0` es "no sé".

El resumen agrega:

```json
{
  "items": 11835,
  "cuadrados": 0,
  "sinDatoErp": 11835,
  "sinContar": 0,
  "auditables": 0,
  "porcentajeCuadrado": 0,
  "porcentajeAuditable": 0,
  "sinPrecio": 0
}
```

- `porcentajeCuadrado` se calcula sobre los **auditables**, no sobre el total: con 11.835 ítems sin stock, un porcentaje sobre el total no significa nada.
- `porcentajeAuditable` dice qué porción del inventario se puede auditar hoy.
- `sinPrecio` cuenta los ítems con diferencia que no se pudieron valorizar. Si son muchos, el monto del faltante está incompleto y quien lo lee tiene que saberlo.

Y un filtro nuevo, `sin_dato`, que junta `sin_erp` + `sin_contar`. Los cuatro de la maqueta (`todos`, `cuadrados`, `faltante`, `empresa`) no cambian de significado — solo dejan de incluir por error a los que no tienen con qué compararse.

> **Para el front**: `stockErp`, `precioVenta`, `diferenciaUnidades` y `diferenciaValor` viajan como `number | null`. El tipo `ItemAuditoria` de `mobile/lib/dominio/tipos.ts` los declara `number` a secas — hay que hacerlos nullables ahí también. Un tipo que no puede expresar "no sé" fuerza a inventar un cero, que es exactamente el bug que se acaba de corregir. Y `VeredictoAuditoria` pasa de 3 valores a 5.

### Verificación de todo esto

```bash
node scripts/verificar-cierre-pendientes.mjs   # backend en :3000
```

Verifica los tres frentes: que la auditoría distinga NULL de 0 contra los datos reales, el camino completo de rotación de PINs con sus permisos, y las tres reglas del histórico **escribiendo directo en Postgres** (no por la API) — porque una regla que solo vive en un `if` la saltea cualquiera que escriba en la tabla.

---

### El almacén de Dynamics: un atributo de la sucursal

Decisión textual del cliente: **"al crear el sitio, se debe asociar el almacén"**. No una tabla de traducción sucursal → almacén que alguien tiene que mantener sincronizada a mano, sino un dato que se elige cuando se da de alta la tienda y vive con ella.

`Sucursal.almacenId` guarda el `WarehouseId` de Dynamics (`MD01_LUZ`, `AD04_TCE`) y `Sucursal.almacenNombre` el nombre legible, copiado del ERP al elegirlo.

#### Nullable, y por qué

`null` significa **"todavía no sabemos cuál es"**, que es la verdad para una tienda recién dada de alta. La alternativa era hacerlo obligatorio y rellenar las existentes con un placeholder, y **un almacén inventado es peor que ninguno**: trae el stock de otra tienda, la auditoría compara contra números que parecen válidos, y nadie se entera hasta que el inventario no cuadra a fin de mes — con once personas ya habiendo contado. Es el mismo criterio que `CatalogoItem.stockErp`: "no sé" nunca se escribe como un valor.

Sin almacén **no se puede traer snapshot**, y eso se rechaza al pedirlo con un mensaje que dice qué falta y quién lo arregla. Pero dar de alta la tienda sigue siendo posible: trabar el padrón porque alguien todavía no fue a buscar el código en Dynamics sería bloquear el alta por un dato que se agrega después.

`GET /api/tiendas` expone `puedeTraerStock` para que la pantalla lo diga al listar, en vez de que el Coordinador se entere recién cuando aprieta "traer snapshot" y falla.

#### Se elige de la lista del ERP, no se tipea

`GET /api/d365/almacenes` (rol `administrador`) devuelve los 70 almacenes del tenant:

```json
[
  { "codigo": "MD01_LUZ", "nombre": "ALMACÉN DISPONIBLE MARKET LUZURIAGA" },
  { "codigo": "MD03_CRH", "nombre": "ALMACÉN DISPONIBLE MARKET CARHUAZ" }
]
```

El servidor **verifica el código contra esa lista** antes de guardarlo, y no alcanza con validar el formato: `MD01_LUZ` y `MD01_LZU` tienen los dos la forma correcta, y el segundo traería el stock de otra tienda — o de ninguna — sin fallar. Un almacén inexistente responde `400` con los códigos parecidos sugeridos, porque casi siempre es un dedazo:

```json
{ "error": "El almacen \"MD01_LZU\" no existe en Dynamics. ¿Quisiste decir alguno de estos? MD01_LUZ. Un almacen mal escrito trae el stock de otra tienda y el error recien se nota cuando el inventario no cuadra." }
```

Se acepta el código en minúsculas, pero **se guarda el del ERP con su capitalización original**: si se guardara lo que vino del cliente, dos tiendas podrían quedar con `md01_luz` y `MD01_LUZ` para el mismo almacén y cualquier comparación posterior fallaría.

Si Dynamics no contesta, el alta **falla** con un mensaje claro en vez de guardar un almacén sin verificar.

#### En la gestión de tiendas

`POST /api/tiendas` acepta `almacenId` (opcional). `PATCH /api/tiendas/:id` también, y ahí `null` **desasocia** el almacén — que se pueda desasociar es a propósito: si alguien detecta que estaba mal configurado, dejarlo en `null` es mejor que dejar uno equivocado. El primero falla ruidosamente al pedir el snapshot; el segundo trae números de otra tienda en silencio.

`GET /api/tiendas` ahora devuelve, además de lo de antes:
```json
{ "almacenId": "MD01_LUZ", "almacenNombre": "ALMACÉN DISPONIBLE MARKET LUZURIAGA", "puedeTraerStock": true }
```

#### El snapshot lo toma de la sucursal

`POST /api/d365/snapshot` ya no necesita `almacen`: sale de `Sucursal.almacenId`. El parámetro queda como **override explícito** para probar otro almacén sin reconfigurar la tienda, pero el camino normal es no mandarlo.

Que sea la sucursal y no un parámetro es lo que hace imposible el error caro: un almacén que se tipea en cada llamada es un almacén que alguna vez se va a tipear mal.

Sin almacén configurado y `modo: "real"` → `400`. Con un inventario ya en curso, la idempotencia responde antes y ni mira el almacén: no hay nada que traer del ERP.

> **A confirmar con el cliente**: cada tienda tiene **tres** almacenes en el ERP y el seed eligió el **DISPONIBLE**:
> ```
> MD01_LUZ  ALMACÉN DISPONIBLE MARKET LUZURIAGA   <- el que se usa
> MC01_LUZ  ALMACÉN CUARENTENA MARKET LUZURIAGA
> MT01_LUZ  ALMACÉN TRÁNSITO MARKET LUZURIAGA
> ```
> "Disponible" es el stock vendible en góndola, que es lo que once personas salen a contar; cuarentena es mercadería retenida y tránsito lo que va en camino. Es la lectura razonable, pero **es una lectura**: si el cliente también cuenta la cuarentena, estos códigos cambian. Los códigos en sí son reales, no placeholders — salen de `Warehouses` del tenant y el nombre coincide exactamente con cada sucursal.

Mapeo sembrado: Luzuriaga → `MD01_LUZ` · Carhuaz → `MD03_CRH` · Bolívar → `MD06_BOL` · Sucre → `MD04_SUC`.

---

### Tipo de inventario: mensual y anual

`Inventario.tipo` es `mensual` (default) o `anual`. Son **dos universos distintos**, confirmados por el cliente:

| Tipo | Qué cuenta |
|---|---|
| `mensual` | Solo los productos de **responsabilidad del empleado** — 6.297 de 11.835 en el catálogo real. Los que asume la empresa quedan fuera. |
| `anual` | **Todo** el catálogo activo, empresa incluida ("en el anual ya cuentan todo"). |

Default `mensual` a propósito: es el que se hace todos los meses. El anual es la excepción y hay que pedirlo explícito — que alguien cuente 11.835 ítems creyendo que cuenta 6.297 es una jornada entera perdida.

#### Las dos restricciones únicas, ajustadas de forma asimétrica

Esta es la parte que hay que entender antes de tocarla: `tipo` entra en una y **no** en la otra, por razones distintas.

**`@@unique([sucursalId, periodoAnio, periodoMes, tipo])`** — `tipo` **sí** entra.

El anual de 2026 y el mensual de diciembre 2026 son **dos cierres distintos del mismo período**, y los dos tienen que poder existir en el histórico. Sin `tipo`, el segundo chocaría contra el primero y no se podría archivar el anual.

**`@@unique([sucursalId, abierto])`** — `tipo` **no** entra. Un solo inventario abierto por sucursal, del tipo que sea.

Y no es que la restricción "restrinja de más". El anual es un **superconjunto** del mensual (11.835 ⊃ 6.297). Si los dos pudieran estar abiertos a la vez:

- los mismos productos se estarían contando en dos inventarios simultáneos, con dos conteos que pueden diferir;
- si los dos llegan a liquidarse, al empleado **se le descuenta dos veces el mismo faltante**.

Además, en la práctica: son once personas en la tienda. No pueden hacer dos inventarios a la vez.

Así que la restricción dice exactamente lo que el negocio necesita: **primero se cierra uno, después se abre el otro**. Verificado contra Postgres — un anual abierto con un mensual abierto da `P2002 (sucursal_id, abierto)`; cerrado el mensual, el anual del mismo período se abre sin problema y los dos conviven en el histórico.

### Verificación

```bash
node scripts/verificar-almacen-y-tipo.mjs   # backend en :3000
```

Prueba el almacén contra la lista real del ERP (incluido el rechazo de un código mal tipeado y la normalización de mayúsculas), el snapshot tomando el almacén de la sucursal, y las dos restricciones **escribiendo directo en Postgres** — porque una regla que solo vive en un `if` la saltea cualquiera que escriba en la tabla.

---

## ⚠️ Reset para poblar con datos reales — `npm run db:reset-demo`

> **ESTE SCRIPT BORRA TODOS LOS DATOS DE LA BASE. No hay deshacer.**
> Existe para un momento puntual: cuando el cliente empieza a cargar datos reales y hay que sacar del medio todo lo de demo. Si lo corrés con datos de producción adentro, se pierden.

Pedido textual del cliente: *"ahora sí necesito probar todo el flujo con datos reales. Solo dejar los usuarios administradores para acceder y empezar a poblar la app"*.

### Cómo se corre

Hacen falta **las dos cosas**, a propósito:

```bash
RESET_DEMO=SI_BORRAR_TODO npm run db:reset-demo -- --si-estoy-seguro
```

Sin las dos, el script se niega y explica qué falta. Se piden dos y no una porque **un flag solo se copia y se pega de un README sin leerlo**, y **una variable de entorno sola se queda pegada en la terminal** y se dispara con el comando siguiente. Las dos juntas exigen escribir dos cosas distintas, en el mismo momento, a propósito.

Además se niega a correr si no hay ninguna cuenta de administrador, o si todas están deshabilitadas: borrar todo en ese estado dejaría a todos afuera de la app **sin forma de arreglarlo desde el teléfono**.

### Qué borra

Sucursales, colaboradores (menos administradores), inventarios, hojas, conteos, productos, catálogo, empaques, resultados, diferencias, liquidaciones, aprobaciones, lacrados, registros de ERP, sesiones y el log de auditoría.

El orden respeta las foreign keys — hijos antes que padres — y **no se confía en el `ON DELETE CASCADE`**: la mayoría de las FK son `RESTRICT`, y depender de que Postgres arrastre las dependencias hace que el día que alguien cambie una regla el script falle a mitad de camino, con media base borrada.

Para borrar los sellos hay que desactivar el trigger `lacrado_inmutable`. Se hace en un `try`/`finally`: **si el borrado falla a mitad, la tabla no puede quedar sin su protección**. Verificado después de correrlo: los dos triggers quedan en `O` (habilitado) y siguen rechazando un `UPDATE` sobre un sello.

### Qué deja, y por qué

**Todas las cuentas con `rol = administrador`** — no solo una. El cliente escribió "los usuarios administradores", en plural, y hoy hay tres. La asimetría del error manda: si sobra un administrador, se deshabilita desde la app en dos toques; si falta, **nadie puede entrar** y no hay forma de arreglarlo desde el teléfono. De los dos errores posibles, uno es reversible y el otro no.

**Las 3 configuraciones del sistema** (`TAMANO_HOJA_DEFECTO`, `CANTIDAD_CONTEOS_CICLO`, `UMBRAL_MEDIA_UNIDAD_PAQUETE`). Son **parámetros**, no datos de demo: definen cómo se comporta el sistema, no qué pasó en una tienda. Borrarlas dejaría al primer inventario sin tamaño de hoja por defecto y sin saber cuántas rondas tiene el ciclo.

**Las credenciales de Dynamics** (`config_dynamics`), si las hay. Son configuración real, y recargarlas exige ir a buscar el secreto a Azure. Su `actualizado_por_id` puede apuntar a un colaborador que desaparece, pero esa FK es `SET NULL`: no rompe nada.

### Es idempotente

Correrlo dos veces no falla ni deja la base en un estado raro: la segunda corrida solo borra lo que se haya generado en el medio (sesiones, log de auditoría) y reporta el resto en cero. Verificado.

### Cómo quedó la base tras correrlo

De **80.364 filas a 6**:

| Tabla | Filas |
|---|---|
| `colaboradores` | **3** (los administradores) |
| `configuraciones` | **3** (los parámetros del sistema) |
| todas las demás | 0 |

---

## El flujo de carga desde la app — `npm run verificar:flujo`

Con la base vacía, esto es lo que el cliente hace desde el teléfono. Está **verificado por HTTP, paso por paso**, con la base ya reseteada:

```bash
node scripts/verificar-flujo-de-carga.mjs        # backend en :3000
node scripts/verificar-flujo-de-carga.mjs --dejar # deja la tienda de prueba creada
```

| Paso | Endpoint | Estado |
|---|---|---|
| 1. El administrador entra | `GET /api/sesion/administradores` → `POST /api/sesion/ingresar` | ✅ |
| 2. Elige el almacén de la lista del ERP | `GET /api/d365/almacenes` (70 almacenes) | ✅ |
| 3. Crea la tienda con ese almacén | `POST /api/tiendas` | ✅ |
| 4. Crea los usuarios de la tienda | `POST /api/usuarios` × N | ✅ |
| 5. La tienda y su gente aparecen en el login | `GET /api/sesion/sucursales` · `.../colaboradores` | ✅ |
| 6. El coordinador entra | `POST /api/sesion/ingresar` | ✅ |
| 7. Arranca el inventario | `POST /api/d365/snapshot` | ✅ |

El administrador se lista por un camino aparte (`GET /api/sesion/administradores`) porque **no tiene sucursal**: no aparece en `/sucursales/:id/colaboradores`. Sin ese endpoint, la app no tendría cómo ofrecerlo en el selector de login y el cliente quedaría afuera con la base recién vaciada.

La prueba también verifica que se creen **dos auditores**: sin dos personas distintas, el inventario no se puede lacrar (control de dos personas).

Por defecto la prueba borra la tienda que creó. Con `--dejar` la conserva, útil para inspeccionarla a mano.

## Desarrollo

```bash
npm install
npm run typecheck
npm test          # tests de codigo puro (Zod, permisos, hasheo de PIN, mapeo/paginacion/token D365), no requieren Postgres ni red
npm run dev        # requiere backend/.env con DATABASE_URL apuntando a Postgres corriendo
```
