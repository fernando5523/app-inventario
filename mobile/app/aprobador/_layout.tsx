import { Stack } from 'expo-router';
import type { JSX } from 'react';

import { AprobadorProvider } from '../../lib/aprobacion/sesion-aprobador';
import { colors } from '../../lib/theme';

/**
 * Sección de la aprobadora de consumo interno. Tiene su propia sesión
 * (Entra ID) y su propio Stack: no comparte ni el PIN ni los tabs por rol del
 * inventario. Ver lib/aprobacion/sesion-aprobador.tsx.
 */
export default function AprobadorLayout(): JSX.Element {
  return (
    <AprobadorProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.fondo }, animation: 'slide_from_right' }} />
    </AprobadorProvider>
  );
}
