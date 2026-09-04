/**
 * Autenticacion OAuth2 client_credentials contra Azure AD para D365 F&O.
 * Mismo patron verificado en el proyecto hermano
 * (monorepo/inventario/backend/src/modules/d365/services/d365-auth.service.ts):
 * `resource` es la propia baseUrl de D365, no un scope v2.0.
 *
 * `esVigente` esta separada de `getTokenValido` a proposito -- es logica
 * pura (una resta de fechas), se testea sin red (ver d365-auth.test.ts).
 */

import { d365Config } from '../../config/d365.config';
import { ErrorHttp } from '../../shared/errores';
import type { D365Token, D365TokenResponse } from './d365.types';

const MARGEN_RENOVACION_MS = 5 * 60 * 1000;

/** Vigente si expira en mas de 5 minutos -- nunca se usa un token al filo del vencimiento. */
export function esVigente(token: D365Token, ahora: Date = new Date()): boolean {
  return token.expiresAt.getTime() > ahora.getTime() + MARGEN_RENOVACION_MS;
}

export class D365AuthService {
  private tokenCache: D365Token | null = null;

  async generarToken(): Promise<D365Token> {
    if (!d365Config.isConfigured()) {
      throw new ErrorHttp(400, 'Dynamics no configurado. Faltan D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET o D365_BASE_URL.');
    }

    const body = new URLSearchParams({
      client_id: d365Config.clientId,
      client_secret: d365Config.clientSecret,
      grant_type: 'client_credentials',
      resource: d365Config.baseUrl,
    });

    const respuesta = await fetch(d365Config.getTokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      throw new ErrorHttp(502, `No se pudo autenticar contra Dynamics: ${texto}`);
    }

    const datos = (await respuesta.json()) as D365TokenResponse;
    const token: D365Token = {
      accessToken: datos.access_token,
      tokenType: datos.token_type,
      expiresAt: new Date(parseInt(datos.expires_on, 10) * 1000),
    };
    this.tokenCache = token;
    return token;
  }

  /** Del cache si sigue vigente; si no, pide uno nuevo. */
  async getTokenValido(): Promise<string> {
    if (this.tokenCache && esVigente(this.tokenCache)) {
      return `${this.tokenCache.tokenType} ${this.tokenCache.accessToken}`;
    }
    const token = await this.generarToken();
    return `${token.tokenType} ${token.accessToken}`;
  }

  /** Fuerza pedir un token nuevo -- usado cuando D365 responde 401 con el actual. */
  async renovarToken(): Promise<string> {
    this.tokenCache = null;
    return this.getTokenValido();
  }

  isConfigured(): boolean {
    return d365Config.isConfigured();
  }
}

export const d365AuthService = new D365AuthService();
