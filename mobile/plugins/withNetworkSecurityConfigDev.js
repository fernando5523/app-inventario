const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Habilita HTTP sin cifrar (cleartext) SOLO contra hosts de desarrollo, NUNCA
 * de forma global.
 *
 * Por que no `android.usesCleartextTraffic: true` a secas: esa bandera abre
 * HTTP contra CUALQUIER host, para siempre, en un APK que despues se instala
 * en telefonos reales de la tienda. El dia que el backend tenga un dominio
 * con HTTPS, nadie se va a acordar de sacarla -- queda una puerta abierta por
 * la conveniencia de hoy. Decision del cliente (2026-09-04): acotarlo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO HAY UN "RANGO 10.x / 192.168.x"
 * ---------------------------------------------------------------------------
 * Se pidio permitir el rango privado entero, y NO SE PUEDE: la
 * network-security-config de Android acepta dominios o IPs EXACTAS, no
 * mascaras CIDR ni comodines. `<domain>10.0.0.0/8</domain>` no es invalido de
 * forma ruidosa -- simplemente no matchea nada, y la conexion se bloquea
 * igual. Un rango que parece configurado y no lo esta es peor que no tenerlo.
 *
 * La solucion es mejor que un rango, ademas: el host permitido se DERIVA de
 * `EXPO_PUBLIC_API_URL`, la misma variable que define a donde apunta la app
 * (ver lib/adaptadores/_http.ts). Una sola fuente de verdad:
 *
 *   EXPO_PUBLIC_API_URL=http://10.5.21.144:3000 ./gradlew assembleRelease
 *
 * y ese APK queda apuntando a esa IP Y con la excepcion de cleartext para esa
 * IP. Si la maquina cambia de IP, se recompila con la nueva y las dos cosas
 * se mueven juntas -- no hay forma de que la URL diga una IP y el permiso
 * diga otra, que es exactamente el bug que dejo al cliente sin datos.
 *
 * Hosts fijos que siempre entran:
 *   - 10.0.2.2             alias del EMULADOR de Android hacia su maquina.
 *   - localhost/127.0.0.1  iOS simulator / testing local.
 *
 * Todo el resto del trafico (`base-config cleartextTrafficPermitted="false"`)
 * sigue exigiendo HTTPS -- el dia que el backend tenga un dominio real, la
 * app ya fuerza TLS sin que nadie tenga que tocar esto. Y si
 * `EXPO_PUBLIC_API_URL` es https, no se agrega ninguna excepcion: no hace
 * falta.
 *
 * BORRAR este plugin (y su referencia en app.config.ts) cuando el backend de
 * desarrollo deje de ser HTTP puro.
 */
const NOMBRE_ARCHIVO = 'network_security_config.xml';

/** Emulador y loopback: valen siempre, no dependen de como se compile. */
const HOSTS_FIJOS = ['10.0.2.2', 'localhost', '127.0.0.1'];

/**
 * Saca el host de `EXPO_PUBLIC_API_URL` cuando es HTTP sin cifrar.
 *
 * Devuelve null si la variable no esta, no parsea, o ya es HTTPS: en esos
 * casos no hay nada que permitir. Nunca tira -- una URL mal escrita no puede
 * romper el build; como mucho deja el APK sin la excepcion, que se nota al
 * primer pedido y no en silencio.
 */
function hostDeCleartextConfigurado() {
  const crudo = process.env.EXPO_PUBLIC_API_URL;
  if (!crudo) return null;
  try {
    const url = new URL(crudo);
    if (url.protocol !== 'http:') return null;
    return url.hostname || null;
  } catch {
    console.warn(`[network-security] EXPO_PUBLIC_API_URL no es una URL valida: ${crudo}`);
    return null;
  }
}

function construirXml() {
  const configurado = hostDeCleartextConfigurado();
  const hosts = [...HOSTS_FIJOS];
  if (configurado && !hosts.includes(configurado)) hosts.push(configurado);

  if (configurado) {
    console.log(`[network-security] cleartext habilitado para: ${hosts.join(', ')}`);
  } else {
    console.log(
      '[network-security] sin EXPO_PUBLIC_API_URL http: solo emulador/localhost. ' +
        'Un telefono FISICO no va a poder conectarse a este APK.',
    );
  }

  const dominios = hosts.map((h) => `    <domain includeSubdomains="false">${h}</domain>`).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  GENERADO por mobile/plugins/withNetworkSecurityConfigDev.js -- no editar a
  mano. Cleartext habilitado SOLO para los hosts de desarrollo listados; el
  host de red sale de EXPO_PUBLIC_API_URL al compilar. Todo lo demas exige
  HTTPS. Sacar este archivo (y el plugin que lo instala) cuando el backend de
  desarrollo deje de ser HTTP puro.
-->
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
${dominios}
  </domain-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`;
}

function withNetworkSecurityConfigDev(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const carpetaXml = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(carpetaXml, { recursive: true });
      fs.writeFileSync(path.join(carpetaXml, NOMBRE_ARCHIVO), construirXml());
      return config;
    },
  ]);

  return withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });
}

module.exports = withNetworkSecurityConfigDev;
