⚠️ **`package.json` desapareció DOS VECES en esta sesión (2 y 3 de septiembre) mientras
varios agentes trabajaban en paralelo sobre esta carpeta. `package-lock.json` y
`node_modules/` sobrevivieron las dos veces — son la fuente para reconstruirlo si
vuelve a pasar. Ver "Por qué desaparece `package.json`" más abajo antes de correr
`expo prebuild` con otro agente activo en `mobile/`.**

# Inventario Movil — Validador de Escaner

App Expo (SDK 55) para toma de inventario. Esta primera version es un **banco de
pruebas del escaner**: valida que la camara del telefono lea codigos de barra
reales de gondola con la velocidad y precision necesarias antes de construir el
flujo completo de los 3 conteos.

Arquitectura clonada de `D:\Documentos\mobile\app-gre-validacion`:
expo-router (file-based routing) + `components/ui` (primitivas) + `lib/theme.ts`
(tokens de diseno) + `lib/types.ts` (contratos de dominio).

## Stack

- Expo SDK 55 / React Native 0.83 / React 19.2
- `expo-router`, `expo-camera` (escaneo), `expo-haptics` (feedback), `expo-sqlite`
- TypeScript strict

## Desarrollo

```bash
npm install
npm start          # Expo dev server
npm run typecheck  # tsc --noEmit
```

## Login

### El Administrador entra por un camino aparte, sin sucursal

`Sesion.sucursal` es `Sucursal | null`, y `null` solo pasa para
`rol=administrador`: un administrador es del sistema, no de una tienda (así
se decidió a propósito al sacar la vieja `SUCURSAL_SISTEMA` ficticia — el
tipo tenía que decir la verdad). Lo que faltó en ese momento fue que la
pantalla de login acompañara el cambio: como pedía sucursal Y persona
siempre, y el administrador no aparece en el padrón de ninguna sucursal, no
había forma de entrar con ese rol en ningún build (bug real, encontrado
2026-09-03 probando el APK v2.0.0 contra la base real).

**Se resolvió con un camino de login separado**, no mezclando al
administrador en el combo de una sucursal:
- Backend: `GET /api/sesion/administradores` (`sesion.service.ts#listarAdministradores`)
  — colaboradores con `sucursalId: null` y `activo: true`. Nueva, junto a
  `GET /api/sesion/sucursales/:id/colaboradores`, no la reemplaza.
- Mobile: `app/index.tsx` tiene un link "¿Sos administrador del sistema?
  Ingresá acá" que oculta el selector de Sucursal y carga el padrón de
  administradores en su lugar. El PIN sigue validándose contra argon2 en
  `POST /api/sesion/ingresar` — el cliente no valida nada, solo pide otra
  lista de personas para elegir.

**Por qué NO se mezcló al administrador en el padrón de las 4 tiendas**
(alternativa descartada, y la que tenía el adaptador en memoria antes de
esta corrección): habría aparecido repetido en las 4 sucursales a la vez,
inflando el "N colaboradores" que ya se muestra en el selector de Sucursal
y en las pantallas de Coordinador/Auditor — un dato falso por conveniencia
de login. Tampoco se dejó la sucursal como "opcional": reusar ese mismo
campo para significar dos cosas distintas ("no elegí todavía" vs. "elegí
explícitamente que no hay sucursal") es más confuso que un camino aparte,
explícito, para un rol que es conceptualmente distinto de entrada.

## Apuntar la app al backend

La URL base **no esta hardcodeada**: sale de configuracion, en este orden
(`lib/adaptadores/_http.ts#urlBase`).

1. `EXPO_PUBLIC_API_URL` -- variable de entorno. Metro la inlinea en tiempo de
   build, asi que **hay que definirla ANTES de compilar el APK**.
2. `extra.apiUrl` de `app.config.ts` -- para cuando el backend tenga una URL
   fija de despliegue.
3. Fallback de desarrollo, con un `console.warn`.

### El detalle que rompe el APK: localhost NO es tu maquina

| Donde corre la app | Que es `localhost` | Que hay que usar |
|---|---|---|
| Emulador Android | el propio emulador | `http://10.0.2.2:3000` |
| Telefono fisico (WiFi de la tienda) | el propio telefono | la **IP real** de la maquina, ej. `http://192.168.1.50:3000` |
| Simulador iOS / web | la maquina | `http://localhost:3000` |

El fallback ya resuelve el caso del emulador Android solo (`10.0.2.2`), pero
**en un telefono fisico ninguno de los dos sirve**: ahi hay que setear la IP a
mano. Por eso `urlBase()` avisa por consola cuando cae al fallback.

```bash
# Emulador Android -- el fallback ya alcanza, pero explicito es mejor:
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 npm run android

# Telefono fisico: la IP de ESTA maquina en la WiFi de la tienda.
# (Windows: ipconfig | Linux/Mac: ip addr / ifconfig)
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000 ./gradlew assembleRelease
```

El backend tiene que escuchar en `0.0.0.0`, no solo en `127.0.0.1`, para que
el telefono lo alcance por la red.

### Cleartext HTTP — solo para desarrollo, y ACOTADO (sacarlo con HTTPS)

Desde Android 9 (API 28) el tráfico HTTP sin cifrar está bloqueado por
default en un build de release. La URL correcta (`10.0.2.2:3000`) no alcanza
sola: sin esto, el fetch ni siquiera abre una conexión TCP — falla en
silencio y el login contra la base queda con la sucursal vacía (confirmado
así en el APK v2.0.0 antes de esta config).

La solución NO es `android.usesCleartextTraffic: true`: esa bandera
habilitaría HTTP contra CUALQUIER host, para siempre, en un APK que después
se instala en teléfonos reales de la tienda. En cambio, `mobile/plugins/withNetworkSecurityConfigDev.js`
instala un `network_security_config` que permite cleartext **solo** contra
`10.0.2.2`, `localhost` y `127.0.0.1` — el resto del tráfico sigue exigiendo
HTTPS.

**Esto es configuración de DESARROLLO.** El día que el backend tenga un
dominio con HTTPS de verdad, hay que borrar el plugin y su referencia en
`app.config.ts` — no dejarlo "por las dudas".

### APK para un TELEFONO FISICO (el caso que fallo)

Un APK compilado sin `EXPO_PUBLIC_API_URL` **no funciona en un telefono real**:
queda apuntando a `10.0.2.2`, que es un alias del EMULADOR hacia su maquina y
en un telefono no lleva a ningun lado. La app abre, loguea contra nada y no
muestra datos -- sin decir por que.

Son TRES cosas que tienen que coincidir, y las tres se resuelven con la misma
variable:

```bash
# 1. Averiguar la IP de ESTA maquina en la red (Windows)
ipconfig | findstr IPv4

# 2. Compilar el APK con esa IP. La variable hace DOS cosas a la vez:
#    - define a donde apunta la app (lib/adaptadores/_http.ts)
#    - agrega esa IP a la excepcion de cleartext de Android
#      (plugins/withNetworkSecurityConfigDev.js)
cd mobile
EXPO_PUBLIC_API_URL=http://10.5.21.144:3000 npx expo prebuild --platform android --clean
cd android
EXPO_PUBLIC_API_URL=http://10.5.21.144:3000 ./gradlew assembleRelease
```

> La variable va en **los dos** comandos: `prebuild` la usa para generar
> `network_security_config.xml`, y `gradlew` para que Metro la inlinee en el
> bundle. Si falta en el primero, Android bloquea la conexion; si falta en el
> segundo, la app apunta al emulador. Los dos fallan igual de callados.

**3. El backend tiene que escuchar en la red**, no solo en localhost. Ya lo
hace por default (`HOST=0.0.0.0`, ver `backend/src/index.ts`). Para verificar
desde otra maquina de la red:

```bash
curl http://10.5.21.144:3000/salud    # tiene que devolver {"ok":true}
```

**Firewall**: en esta maquina los tres perfiles estan DESACTIVADOS, asi que el
puerto 3000 ya es alcanzable. Si en otra maquina estuviera activo, la regla
es (ejecutar como Administrador, **no** es algo que corra el proyecto):

```powershell
netsh advfirewall firewall add rule name="app-inventario backend 3000" dir=in action=allow protocol=TCP localport=3000
```

El telefono tiene que estar en la **misma red WiFi** que la maquina.

### Volver a memoria sin backend

Para demostrar la app sin levantar nada, `EXPO_PUBLIC_PUERTOS_MEMORIA`
(`lib/contenedor.ts`): `*` manda todo a memoria, o una lista
(`sesion,usuarios`) para volver solo algunos. Vacio = cada puerto usa lo que
dice `contenedor.ts`, que hoy es el backend real para sesion, usuarios,
tiendas y config.

## Generar el APK (Gradle local)

Esta maquina tiene el Android SDK completo y el JDK 21 del JBR de Android Studio,
asi que **no hace falta EAS Build en la nube**.

```bash
# 1. generar el proyecto nativo (solo si android/ no existe o cambio app.config.ts)
npx expo prebuild -p android --no-install

# 2. compilar
cd android
export ANDROID_HOME='C:\Users\User\AppData\Local\Android\Sdk'
export JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
./gradlew assembleRelease --console=plain
```

Salida: `android/app/build/outputs/apk/release/app-release.apk` (~124 MB, incluye
las 4 ABIs). El template de Expo firma el build `release` con la keystore de
debug, por eso el APK es instalable tal cual sin generar una keystore propia.

### Trampas verificadas en este entorno

1. **`JAVA_HOME` es obligatorio.** El `java` del PATH es JDK 1.8 y el build falla
   con el. El JDK 21 correcto ya viene con Android Studio (`jbr`); no instales uno
   aparte. Exportalo por shell, no global.
2. **Gradle puede devolver exit code 0 sin regenerar el APK.** Nunca des un build
   por bueno por el codigo de salida: verifica el *timestamp* del `.apk`.
3. **Un APK viejo instalado crashea al arrancar** por modulos nativos faltantes.
   Parece un bug de codigo y es un binario desactualizado — mira el timestamp antes
   de debuggear.
4. **`adb` en Git Bash** convierte rutas `/sdcard/...` a rutas Windows. Prefija
   `MSYS_NO_PATHCONV=1` en cualquier comando adb que lleve una ruta del telefono.

Antes de subir version, actualizar `version` y `android.versionCode` en
`app.config.ts`: Android rechaza instalar un `versionCode` menor al ya instalado.

### Por qué desaparece `package.json` (y cómo evitarlo)

Pasó dos veces esta sesión: `mobile/package.json` desapareció de golpe mientras
varios agentes trabajaban a la vez en esta carpeta. Investigado el 3 de
septiembre, con el código instalado de `@expo/cli` como evidencia (no solo la
doc):

- **`expo prebuild --clean` NO es la causa directa.** Se leyó
  `node_modules/@expo/cli/build/src/prebuild/prebuildAsync.js`: `--clean` llama
  a `clearNativeFolder(projectRoot, options.platforms)`, y `options.platforms`
  es literalmente `['android']`/`['ios']` — solo puede borrar esas dos carpetas,
  nunca `package.json`. Se descarta como culpable directo.
- **`expo prebuild` SÍ reescribe `package.json` en CADA corrida** (con o sin
  `--clean`) — `updatePackageJson.js` lee el archivo, lo mezcla con el template,
  y lo vuelve a escribir con `fs.promises.writeFile` al final del comando (que
  puede tardar varios minutos: limpia `android/`, corre config plugins, gradle).
  Si otro agente edita/borra algo en `mobile/` en esa ventana, o si dos
  `prebuild` corren pisándose, hay una carrera real de lectura-escritura sobre
  ese archivo.
- **La app no tiene repo git**, y el propio `expo prebuild --clean` trae una
  protección para exactamente este caso (avisa y pide confirmar si el working
  tree está sucio) — pero esa protección necesita un repo git para funcionar, y
  además se salta sola en modo no interactivo (`git.js`,
  `maybeBailOnGitStatusAsync`: sin repo git, y sin TTY interactivo, solo
  loggea un warning y sigue). Sin git, ese cinturón de seguridad no existe.
- Las dos veces que pasó, `package-lock.json` y `node_modules/` quedaron
  intactos — consistente con que lo que se rompió fue específicamente la
  escritura de `package.json` de `prebuild` (que toca solo ese archivo), no un
  `rm -rf` ni un `npm install` fallido (que sí tocarían el lockfile).

**Hipótesis, no certeza absoluta**: la causa más probable es la combinación de
(a) `expo prebuild` corriendo repetidas veces la misma noche mientras (b) otros
agentes editaban archivos en la misma carpeta al mismo tiempo, sin (c) ningún
repo git que frenara o permitiera revertir el resultado.

**Cómo evitarlo:**

1. **Iniciar un repo git en el proyecto cuanto antes.** Es la protección de
   mayor impacto: reactiva el chequeo propio de `expo prebuild --clean`, y le
   da a cualquier agente un `git status`/`git diff` antes de tocar algo — y,
   sobre todo, una forma real de recuperar lo que se pierda (esta vez hubo
   suerte con el lockfile; la próxima podría no ser recuperable).

   **Hecho — 2026-09-03.** `git init` corrido en la raíz del proyecto
   (`D:\Documentos\monorepo\app-inventario`, no en `mobile/`), con `.gitignore`
   raíz (node_modules/, `*.apk`, `mobile/android/`, `mobile/.expo/`, `.env*`) y
   un commit inicial con todo el trabajo hasta acá. Desde ahora, `expo prebuild
   --clean` con un working tree sucio SÍ avisa y pide confirmar antes de
   borrar nada — la protección de `maybeBailOnGitStatusAsync` (ver más abajo)
   ya tiene un repo git contra el cual funcionar. Seguí commiteando seguido:
   la protección solo cubre lo que ya está commiteado.
2. **No correr `expo prebuild` (con o sin `--clean`) mientras otro agente esté
   editando archivos en `mobile/`.** Esta sección del README ya decía que
   `prebuild` "solo si `android/` no existe o cambió `app.config.ts`" — si
   `android/` ya existe, no hace falta repetirlo.
3. Si algo similar vuelve a pasar: `package-lock.json` + `node_modules/` alcanzan
   para reconstruir `package.json` exacto (`packages[""].dependencies` /
   `devDependencies` del lockfile tienen los rangos exactos) — no inventar
   versiones.

## Instalar en el telefono

```bash
# por USB (depuracion USB activada en el telefono)
adb install -r ../inventario-scanner-v1.0.0.apk
```

O copiar el `.apk` al telefono y abrirlo (hay que permitir "instalar apps de
origenes desconocidos").

## Verificar un APK sin instalarlo

```bash
SDK='C:\Users\User\AppData\Local\Android\Sdk'
"$SDK/build-tools/36.1.0/aapt2.exe" dump badging app-release.apk | grep -E "^package|uses-permission"
"$SDK/build-tools/36.1.0/apksigner.bat" verify --verbose app-release.apk
```

## Estructura

```
app/
  _layout.tsx     # Stack raiz + tema oscuro
  index.tsx       # Pantalla de escaneo: camara, catalogo demo, modal de conteo
components/ui/    # Badge, Button, Card, EmptyState, ScreenContainer
lib/
  theme.ts        # colores, spacing, radius, fontSize
  types.ts        # ProductoCatalogo, BarcodeScanResult, TipoEmpaque
```
