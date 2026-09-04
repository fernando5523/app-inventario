import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Inventario Movil',
  slug: 'app-inventario-mobile',
  scheme: 'inventario',
  version: '2.2.0',
  orientation: 'portrait',
  // El diseño aprobado es blanco con rojo Trujillo: "dark" pintaba de
  // oscuro los controles del sistema sobre una app clara.
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
  },
  android: {
    package: 'com.market.inventario',
    versionCode: 2,
  },
  plugins: [
    'expo-router',
    [
      'expo-camera',
      {
        cameraPermission: 'Permitir acceso a la camara para escanear codigos de barra de productos.',
      },
    ],
    'expo-sqlite',
    // Cleartext HTTP acotado a hosts de desarrollo (10.0.2.2, localhost) --
    // NO abre HTTP contra cualquier host. Ver el comentario completo en
    // plugins/withNetworkSecurityConfigDev.js y mobile/README.md.
    // BORRAR cuando el backend de desarrollo tenga HTTPS.
    './plugins/withNetworkSecurityConfigDev.js',
  ],
};

export default config;
