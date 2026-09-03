import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Inventario Movil',
  slug: 'app-inventario-mobile',
  scheme: 'inventario',
  version: '1.0.0',
  orientation: 'portrait',
  // El diseño aprobado es blanco con rojo Trujillo: "dark" pintaba de
  // oscuro los controles del sistema sobre una app clara.
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
  },
  android: {
    package: 'com.market.inventario',
    versionCode: 1,
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
  ],
};

export default config;
