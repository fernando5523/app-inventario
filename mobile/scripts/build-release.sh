#!/usr/bin/env bash
#
# Build de release a mano, en Git Bash, sin EAS (esta maquina tiene el
# Android SDK completo y el JDK 21 del JBR de Android Studio -- ver
# mobile/README.md, "Generar el APK (Gradle local)").
#
# OJO CON QUE NO HACE: no corre `expo prebuild`. Compila lo que YA esta en
# mobile/android/, que es una carpeta GENERADA (esta en .gitignore, no
# viaja en el repo). Dos consecuencias directas:
#
#   1. El versionCode/versionName que usa este build salen de
#      android/app/build.gradle, NO de app.config.ts. Si alguien actualiza
#      la version en app.config.ts pero nadie corre `expo prebuild` de
#      nuevo, este script sigue empaquetando la version VIEJA. Edita los
#      dos archivos juntos (o corre prebuild) antes de subir version.
#
#   2. mobile/android/app/src/main/res/xml/network_security_config.xml
#      (que habilita HTTP sin cifrar SOLO para el host de
#      EXPO_PUBLIC_API_URL, ver plugins/withNetworkSecurityConfigDev.js)
#      tambien es generado por `expo prebuild`, leyendo esa variable EN ESE
#      MOMENTO. Si la IP del backend cambio desde el ultimo prebuild, este
#      script compila igual (Gradle no sabe nada de esto) pero el APK no va
#      a poder hablarle al backend por HTTP: Android bloquea el cleartext
#      contra un host que no esta en ese XML. Este script lo detecta y
#      avisa (no aborta) mas abajo.
#
# Si cambiaste la version o la IP del backend desde el ultimo build, corre
# primero:  npx expo prebuild -p android --no-install

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."   # mobile/, sin importar desde donde se invoque este script

export JAVA_HOME='/c/Program Files/Android/Android Studio/jbr'
export ANDROID_HOME='/c/Users/User/AppData/Local/Android/Sdk'
export EXPO_PUBLIC_API_URL='http://10.5.21.144:3000'

# ---------------------------------------------------------------------------
# Cinturon de seguridad: ningun EXPO_PUBLIC_PUERTOS_* prendido.
# ---------------------------------------------------------------------------
# lib/contenedor.ts#elegir lee EXPO_PUBLIC_PUERTOS_MEMORIA -- si queda
# exportada de una sesion de pruebas anterior en esta misma terminal, el
# APK sale con parte del catalogo (o TODO, con "*") resuelto a datos de
# memoria en vez del backend real. Es el mismo tipo de bug que se encontro
# en auditor/auditoria.tsx durante la auditoria de "numeros que mienten":
# ahi el riesgo era de config, no de codigo, y un release no puede salir
# con esa duda.
if env | grep -q '^EXPO_PUBLIC_PUERTOS_'; then
  echo "ABORTADO: hay una variable EXPO_PUBLIC_PUERTOS_* definida en el entorno:" >&2
  env | grep '^EXPO_PUBLIC_PUERTOS_' >&2
  echo "Un release no puede salir con puertos forzados a memoria. Desexportala (unset <NOMBRE>) y volve a correr este script." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Version que va a llevar el APK -- ANTES de compilar, no despues.
# ---------------------------------------------------------------------------
BUILD_GRADLE='android/app/build.gradle'
VERSION_NAME=$(sed -n 's/.*versionName "\([^"]*\)".*/\1/p' "$BUILD_GRADLE" | head -n1)
VERSION_CODE=$(sed -n 's/.*versionCode \([0-9][0-9]*\).*/\1/p' "$BUILD_GRADLE" | head -n1)

if [ -z "$VERSION_NAME" ] || [ -z "$VERSION_CODE" ]; then
  echo "No pude leer versionName/versionCode de ${BUILD_GRADLE}. ¿Corriste 'npx expo prebuild -p android' al menos una vez?" >&2
  exit 1
fi

echo "Version a compilar: ${VERSION_NAME} (versionCode ${VERSION_CODE})"
echo "Backend: ${EXPO_PUBLIC_API_URL}"

# Aviso (no aborta el build): el host de EXPO_PUBLIC_API_URL tiene que estar
# en el XML de cleartext generado por el ultimo `expo prebuild`, o el APK
# compila bien y no puede conectarse.
NSC_XML='android/app/src/main/res/xml/network_security_config.xml'
HOST_API=$(printf '%s' "$EXPO_PUBLIC_API_URL" | sed -E 's#^https?://([^:/]+).*#\1#')
if [ -f "$NSC_XML" ] && ! grep -q ">${HOST_API}<" "$NSC_XML"; then
  echo "AVISO: ${NSC_XML} no incluye el host '${HOST_API}' de EXPO_PUBLIC_API_URL." >&2
  echo "  Ese XML lo genera 'expo prebuild' leyendo esta variable -- si la IP del" >&2
  echo "  backend cambio desde el ultimo prebuild, el APK va a compilar pero" >&2
  echo "  Android va a bloquear el HTTP cleartext contra el backend en runtime." >&2
  echo "  Si esto paso: npx expo prebuild -p android --no-install, y volve a correr este script." >&2
fi

# ---------------------------------------------------------------------------
# Compilar. El log completo queda en un archivo -- gradle es verboso y la
# terminal no necesita ver cada tarea, solo el resultado.
# ---------------------------------------------------------------------------
mkdir -p logs
# Ruta ABSOLUTA calculada ahora (cwd = mobile/): más abajo se hace `cd
# android` para correr gradlew, y una ruta relativa cambiaría de
# significado en ese momento.
LOG="$(pwd)/logs/build-release-$(date +%Y%m%d-%H%M%S).log"
echo "Compilando (esto puede tardar varios minutos)... salida completa en ${LOG}"

cd android
# Marca de tiempo tomada ANTES de gradlew: contra esto se compara la fecha
# del APK mas abajo. Va aca y no despues a proposito -- todo lo que se
# escriba desde este instante es de ESTA corrida, y lo que sea anterior no.
INICIO_BUILD=$(date +%s)

# El `if` es a proposito: con `set -e` prendido, un comando que falla DENTRO
# de un `if` no mata el script -- es lo que permite capturar el exit code
# real de gradlew en vez de que bash aborte antes de leerlo.
if ./gradlew assembleRelease --no-daemon --console=plain > "${LOG}" 2>&1; then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi
cd ..

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "FALLO gradlew (exit ${EXIT_CODE}). Ultimas 40 lineas del log:" >&2
  tail -n 40 "$LOG" >&2
  echo "Log completo: ${LOG}" >&2
  exit "$EXIT_CODE"
fi

# Gradle puede devolver exit 0 sin regenerar el APK (ver mobile/README.md,
# "Trampas verificadas en este entorno") -- se verifica que el archivo
# exista Y que su timestamp sea de ESTA corrida, no un binario viejo.
APK='android/app/build/outputs/apk/release/app-release.apk'
if [ ! -f "$APK" ]; then
  echo "gradlew termino en 0 pero no encuentro el APK en ${APK}. Revisa el log: ${LOG}" >&2
  exit 1
fi

# Que el archivo exista NO alcanza, y este script lo aprendio a los golpes
# (5 sep 2026, release 2.12.0): gradle contesto "BUILD SUCCESSFUL, 515 tareas
# up-to-date" sin tocar el APK, el script imprimio "APK generado" y salio en
# 0 -- sobre el binario de una corrida ANTERIOR. Un APK viejo y uno recien
# hecho se ven identicos desde afuera: mismo exit code, mismo archivo en su
# lugar. La fecha es lo unico que los distingue, asi que se compara, no se
# imprime y se confia.
APK_MTIME=$(date -r "$APK" +%s)
if [ "$APK_MTIME" -lt "$INICIO_BUILD" ]; then
  echo "ABORTADO: gradlew termino en 0 pero el APK es ANTERIOR a este build." >&2
  echo "  APK:            $(date -d "@${APK_MTIME}" '+%Y-%m-%d %H:%M:%S')" >&2
  echo "  Build arranco:  $(date -d "@${INICIO_BUILD}" '+%Y-%m-%d %H:%M:%S')" >&2
  echo "" >&2
  echo "  Ese binario quedo de una corrida anterior: gradle lo dio por up-to-date" >&2
  echo "  y no lo regenero. NO se puede afirmar que corresponda al codigo actual." >&2
  echo "  Para forzar una compilacion real, borra la carpeta de salida y volve a" >&2
  echo "  correr este script:" >&2
  echo "    rm -rf android/app/build/outputs/apk/release/" >&2
  echo "  Log de esta corrida: ${LOG}" >&2
  exit 1
fi

echo "APK generado: $(cd "$(dirname "$APK")" && pwd)/$(basename "$APK")"
echo "Timestamp del APK: $(date -r "$APK" '+%Y-%m-%d %H:%M:%S') (verificado: posterior al inicio de este build)"
exit 0
