import * as AuthSession from 'expo-auth-session';
import { Redirect, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { FlaskConical, LogIn } from 'lucide-react-native';
import { useEffect, useState, type JSX } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, EstrellaMarca, ScreenContainer } from '../../components/ui';
import { ingresoDePrueba, mensajeParaAprobadora, quienSoy } from '../../lib/aprobacion/aprobacion-api';
import { ESQUEMA, RUTA_REDIRECCION, configEntra, ingresoDePruebaVisible, type ConfigEntraMovil } from '../../lib/aprobacion/entra';
import { useAprobador } from '../../lib/aprobacion/sesion-aprobador';
import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

WebBrowser.maybeCompleteAuthSession();

/**
 * Ingreso de la aprobadora. Con su cuenta de la empresa (Entra ID, PKCE): el
 * token que devuelve Microsoft se manda al servidor, que lo valida y decide si
 * esa cuenta puede aprobar. El teléfono no decide nada.
 */
export default function IngresoAprobador(): JSX.Element {
  const { sesion, ingresar } = useAprobador();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const config = configEntra();

  if (sesion) return <Redirect href="/aprobador/pendientes" />;

  /** Confirma con el servidor quién es y si puede aprobar; recién ahí entra. */
  const confirmarYEntrar = async (token: string): Promise<void> => {
    try {
      const { aprobador } = await quienSoy(token);
      ingresar(token, aprobador);
      router.replace('/aprobador/pendientes');
    } catch (e) {
      setError(mensajeParaAprobadora(e));
    }
  };

  const entrarDePrueba = async (): Promise<void> => {
    setError(null);
    setOcupado(true);
    try {
      const { token } = await ingresoDePrueba();
      await confirmarYEntrar(token);
    } catch (e) {
      setError(mensajeParaAprobadora(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <ScreenContainer scrollable contentStyle={styles.contenido}>
      <View style={styles.marca}>
        <Image source={require('../../assets/logo-trujillo.png')} style={styles.logo} resizeMode="contain" />
      </View>

      <View style={styles.tarjeta}>
        <Text style={styles.titulo}>Aprobación de consumo interno</Text>
        <Text style={styles.subtitulo}>
          Revisa las solicitudes de salida por consumo interno que envían las tiendas y decide cada producto. Al aprobar, la salida se
          registra sola en Dynamics.
        </Text>

        {config ? (
          <BotonMicrosoft config={config} ocupado={ocupado} onToken={(t) => confirmarYEntrar(t)} onError={setError} onOcupado={setOcupado} />
        ) : (
          <Text style={styles.aviso}>
            El ingreso con la cuenta de la empresa todavía no está activado en esta versión de la aplicación. Pide a sistemas que lo active.
          </Text>
        )}

        {ingresoDePruebaVisible() ? (
          <Button label="Ingreso de prueba (solo desarrollo)" variant="outline" icon={FlaskConical} loading={ocupado} disabled={ocupado} onPress={entrarDePrueba} />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" style={styles.volver}>
        <Text style={styles.volverTexto}>← Volver al ingreso de tienda</Text>
      </Pressable>

      <View style={styles.pie}>
        <EstrellaMarca size={13} color={colors.dorado} />
        <Text style={styles.pieTexto}>porque mereces lo mejor</Text>
        <EstrellaMarca size={13} color={colors.rojo} />
      </View>
    </ScreenContainer>
  );
}

interface BotonMicrosoftProps {
  config: ConfigEntraMovil;
  ocupado: boolean;
  onToken: (token: string) => Promise<void>;
  onError: (mensaje: string | null) => void;
  onOcupado: (ocupado: boolean) => void;
}

/** Separado para que sus hooks existan solo cuando el ingreso con Microsoft está configurado. */
function BotonMicrosoft({ config, ocupado, onToken, onError, onOcupado }: BotonMicrosoftProps): JSX.Element {
  const discovery = AuthSession.useAutoDiscovery(`https://login.microsoftonline.com/${config.tenantId}/v2.0`);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: ESQUEMA, path: RUTA_REDIRECCION });
  const [request, respuesta, abrir] = AuthSession.useAuthRequest(
    { clientId: config.clientId, scopes: [config.scope, 'openid', 'profile', 'offline_access'], redirectUri, usePKCE: true },
    discovery,
  );

  useEffect(() => {
    if (!respuesta || !discovery || !request) return;
    if (respuesta.type === 'error') {
      onError('Microsoft no completó el ingreso. Intenta de nuevo.');
      return;
    }
    if (respuesta.type !== 'success') return;
    onOcupado(true);
    AuthSession.exchangeCodeAsync(
      {
        clientId: config.clientId,
        code: respuesta.params.code ?? '',
        redirectUri,
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : {},
      },
      discovery,
    )
      .then((t) => onToken(t.accessToken))
      .catch(() => onError('No se pudo completar el ingreso con tu cuenta. Intenta de nuevo.'))
      .finally(() => onOcupado(false));
    // Solo reacciona a una respuesta nueva de Microsoft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respuesta]);

  return (
    <Button
      label="Ingresar con mi cuenta de la empresa"
      icon={LogIn}
      size="lg"
      loading={ocupado}
      disabled={!request || ocupado}
      onPress={() => {
        onError(null);
        void abrir();
      }}
    />
  );
}

const styles = StyleSheet.create({
  contenido: { padding: spacing.xl, gap: spacing.lg, justifyContent: 'center', flexGrow: 1 },
  marca: { alignItems: 'center', paddingTop: spacing.md },
  logo: { width: 172, height: 62 },
  tarjeta: { gap: spacing.md, borderWidth: 1, borderColor: colors.borde, borderRadius: radius.xl, padding: spacing.xl },
  titulo: { fontFamily: fonts.bold, fontSize: fontSize.xl, color: colors.tinta },
  subtitulo: { fontFamily: fonts.regular, fontSize: 14, color: colors.gris, lineHeight: 20 },
  aviso: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.proceso,
    backgroundColor: colors.procesoSuave,
    borderRadius: radius.md,
    padding: spacing.md,
    lineHeight: 19,
  },
  error: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.falta, backgroundColor: colors.faltaSuave, borderRadius: radius.md, padding: spacing.md },
  volver: { alignSelf: 'center' },
  volverTexto: { fontSize: 13.5, color: colors.rojo, fontFamily: fonts.regular },
  pie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  pieTexto: { fontFamily: fonts.marca, fontSize: 13, color: colors.gris },
});
