import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import { Baloo2_700Bold } from '@expo-google-fonts/baloo-2';

import { iniciarSincronizador } from '../lib/contenedor';
import { NavegacionProvider } from '../lib/navegacion-contexto';
import { SesionProvider } from '../lib/sesion-contexto';
import { colors } from '../lib/theme';

// Se mantiene el splash nativo hasta que las fuentes de marca esten
// listas -- sin esto la app arranca un instante con la fuente del
// sistema y "salta" a Figtree/Baloo 2, que no es el diseño aprobado.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Baloo2_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Arranca UNA sola vez, para toda la app: los disparadores automáticos
  // de sincronización (reconexión de red + primer plano). Ver
  // lib/adaptadores/sincronizador.ts para el resto de los disparadores
  // (al finalizar una hoja, manual desde la banda).
  useEffect(() => iniciarSincronizador(), []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SesionProvider>
      {/* ADENTRO de SesionProvider: la navegación depende del rol de la
          sesión. Y envuelve al Stack entero porque la consumen tanto el home
          (InicioScreen) como los layouts de tabs de cada grupo. */}
      <NavegacionProvider>
      <View style={styles.root}>
        <StatusBar style="dark" backgroundColor={colors.fondo} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.fondo },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Acceso al inventario' }} />
          <Stack.Screen name="administrador" />
          <Stack.Screen name="coordinador" />
          <Stack.Screen name="conteo" />
          <Stack.Screen name="auditor" />
        </Stack>
      </View>
      </NavegacionProvider>
    </SesionProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.fondo,
  },
});
