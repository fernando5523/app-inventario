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
