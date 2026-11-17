/**
 * Configuración del ingreso con Microsoft (Entra ID). Sale de variables que
 * Metro inlinea al COMPILAR (igual que EXPO_PUBLIC_API_URL): hay que definirlas
 * antes de generar el APK.
 *
 *   EXPO_PUBLIC_ENTRA_TENANT_ID   tenant de la empresa
 *   EXPO_PUBLIC_ENTRA_CLIENT_ID   app MÓVIL registrada en Entra (cliente público)
 *   EXPO_PUBLIC_ENTRA_API_SCOPE   scope de la API, ej. api://<id-api>/Consumo.Aprobar
 *
 * Redirect URI que hay que registrar en esa app (plataforma "Móvil y escritorio"):
 *   inventario://aprobador/auth
 */

export interface ConfigEntraMovil {
  tenantId: string;
  clientId: string;
  scope: string;
}

export const ESQUEMA = 'inventario';
export const RUTA_REDIRECCION = 'aprobador/auth';

export function configEntra(): ConfigEntraMovil | null {
  const tenantId = (process.env.EXPO_PUBLIC_ENTRA_TENANT_ID ?? '').trim();
  const clientId = (process.env.EXPO_PUBLIC_ENTRA_CLIENT_ID ?? '').trim();
  const scope = (process.env.EXPO_PUBLIC_ENTRA_API_SCOPE ?? '').trim();
  if (tenantId === '' || clientId === '' || scope === '') return null;
  return { tenantId, clientId, scope };
}

/** El botón de ingreso de PRUEBA solo se dibuja si el APK se compiló con esto. El servidor igual lo vuelve a exigir. */
export function ingresoDePruebaVisible(): boolean {
  return process.env.EXPO_PUBLIC_CONSUMO_INGRESO_DEV === '1';
}
