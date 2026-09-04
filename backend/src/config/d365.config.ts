/**
 * Configuracion de Dynamics 365 (F&O) desde variables de entorno -- ver
 * .env.example para el detalle de cada una. Mismo patron que
 * config/database.ts: un solo lugar sabe de donde salen estos valores,
 * nadie mas lee process.env.D365_* directo.
 */
export const d365Config = {
  tenantId: process.env.D365_TENANT_ID ?? '',
  clientId: process.env.D365_CLIENT_ID ?? '',
  clientSecret: process.env.D365_CLIENT_SECRET ?? '',
  baseUrl: process.env.D365_BASE_URL ?? '',
  /** "trv" -- CONFIRMADO por el cliente como Market Trujillo (ya no es un supuesto, ver README). */
  dataAreaId: process.env.D365_DATA_AREA_ID ?? '',

  /** Las 4 credenciales presentes -- sin esto no se puede ni pedir un token. */
  isConfigured(): boolean {
    return !!(this.tenantId && this.clientId && this.clientSecret && this.baseUrl);
  },

  /** Endpoint OAuth2 client_credentials de Azure AD para D365 F&O (no es el v2.0/scope). */
  getTokenEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/token`;
  },

  /** Base de las APIs OData de D365 (sin barra final). */
  getODataBaseUrl(): string {
    return `${this.baseUrl}/data`;
  },
};
