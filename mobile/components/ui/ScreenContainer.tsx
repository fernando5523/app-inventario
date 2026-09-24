import type { PropsWithChildren, JSX } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../../lib/theme';

export interface ScreenContainerProps extends PropsWithChildren {
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Solo tiene efecto con `scrollable` -- "tirar para refrescar" (`<RefreshControl />`), pasado directo al `ScrollView`. */
  refreshControl?: ScrollViewProps['refreshControl'];
}

export function ScreenContainer({
  children,
  scrollable = false,
  style,
  contentStyle,
  refreshControl,
}: ScreenContainerProps): JSX.Element {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, style]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {scrollable ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, anchoDeLectura, contentStyle]}
            showsVerticalScrollIndicator={false}
            refreshControl={refreshControl}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, styles.content, anchoDeLectura, contentStyle]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * ---------------------------------------------------------------------------
 * EN WEB LA PANTALLA NO SE ESTIRA: SE CENTRA
 * ---------------------------------------------------------------------------
 * Las mismas pantallas corren en el navegador (el Auditor trabaja en una PC,
 * no en un teléfono). Sin esto, en un monitor de 1.900px cada tarjeta se
 * estira de borde a borde: los montos quedan a medio metro de su etiqueta y
 * hay que barrer la pantalla con la vista para leer un renglón.
 *
 * 1120px es el ancho donde una tabla de auditoría entra completa y un texto
 * sigue siendo legible -- más angosto corta las columnas de la matriz, más
 * ancho vuelve al problema de la etiqueta lejos del número.
 *
 * VA EN UN SOLO LUGAR a propósito: toda pantalla pasa por acá
 * (`ScreenContainer` -> `PantallaConTabs`), así que el día que el ancho tenga
 * que cambiar se cambia una vez y no en treinta archivos. En Android e iOS el
 * objeto queda vacío y no toca nada.
 */
const ANCHO_MAX_WEB = 1120;

const anchoDeLectura = Platform.OS === 'web' ? { width: '100%' as const, maxWidth: ANCHO_MAX_WEB, alignSelf: 'center' as const } : null;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.fondo,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
});
