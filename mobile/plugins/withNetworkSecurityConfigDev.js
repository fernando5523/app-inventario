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
 * Que hosts entran en la excepcion, y por que cada uno:
 *   - 10.0.2.2         el alias que el EMULADOR de Android usa para llegar a
 *                      la maquina que corre `npm run dev` en backend/.
 *   - localhost/127.0.0.1  mismo caso para iOS simulator / testing local.
 * NO incluye la IP de la red local de la tienda: eso se suma reciene cuando
 * de verdad se pruebe contra un telefono fisico, no antes.
 *
 * Todo el resto del trafico (`base-config cleartextTrafficPermitted="false"`)
 * sigue exigiendo HTTPS -- el dia que el backend tenga un dominio real, la
 * app ya fuerza TLS sin que nadie tenga que tocar esto.
 *
 * BORRAR este plugin (y su referencia en app.config.ts) cuando el backend de
 * desarrollo deje de ser HTTP puro.
 */
const NOMBRE_ARCHIVO = 'network_security_config.xml';

const CONTENIDO_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Ver mobile/plugins/withNetworkSecurityConfigDev.js: cleartext habilitado
  SOLO para hosts de desarrollo (emulador/localhost). Todo lo demas exige
  HTTPS. Sacar este archivo (y el plugin que lo instala) cuando el backend
  de desarrollo deje de ser HTTP puro.
-->
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function withNetworkSecurityConfigDev(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const carpetaXml = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(carpetaXml, { recursive: true });
      fs.writeFileSync(path.join(carpetaXml, NOMBRE_ARCHIVO), CONTENIDO_XML);
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
