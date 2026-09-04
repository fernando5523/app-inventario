/**
 * Autenticacion OAuth2 client_credentials contra Azure AD para D365 F&O.
 * Mismo patron verificado en el proyecto hermano
 * (monorepo/inventario/backend/src/modules/d365/services/d365-auth.service.ts):
 * `resource` es la propia baseUrl de D365, no un scope v2.0.
 *
 * `esVigente` esta separada de `getTokenValido` a proposito -- es logica
 * pura (una resta de fechas), se testea sin red (ver d365-auth.test.ts).
 *
 * ---------------------------------------------------------------------------
 * DE DONDE SALEN LAS CREDENCIALES
 * ---------------------------------------------------------------------------
 * De `credencialesEfectivas()`, NO de `d365Config` directo: la base gana
 * sobre el `.env` (ver el comentario de esa funcion). Este archivo leia el
 * `.env` sin pasar por ahi, y esa era una fuga silenciosa -- las credenciales
 * cargadas en la base se veian en la pantalla de Configuracion y la prueba de
 * conexion decia "origen: base", pero el traido real del catalogo seguia
 * usando el archivo. Todo parecia andar y nada de lo cargado tenia efecto.
 *
 * Por eso TODO el modulo d365 pide sus credenciales por aca: la baseUrl de
 * OData (d365-entity) y el dataAreaId (d365-catalogo) tambien. Un solo lugar
 * que sepa de donde salen, o vuelve a pasar lo mismo.
 */

import {
  credencialesEfectivas,
  type CredencialesDynamics,
} from '../config-dynamics/config-dynamics.service';
import { ErrorHttp } from '../../shared/errores';
import type { D365Token, D365TokenResponse } from './d365.types';

const MARGEN_RENOVACION_MS = 5 * 60 * 1000;

/**
 * Cuanto vive el cache de credenciales.
 *
 * No se atan al ciclo del token (que dura ~1 hora) porque entonces cambiar
 * las credenciales en la base no tendria efecto hasta que venciera el token,
 * y quien las cambia no tiene forma de saber cuanto falta para eso. Un minuto
 * es corto para una persona esperando y largo para la base: en una bajada de
 * catalogo de 16 paginas, se consulta una vez, no dieciseis.
 */
const TTL_CREDENCIALES_MS = 60 * 1000;

/** Vigente si expira en mas de 5 minutos -- nunca se usa un token al filo del vencimiento. */
export function esVigente(token: D365Token, ahora: Date = new Date()): boolean {
  return token.expiresAt.getTime() > ahora.getTime() + MARGEN_RENOVACION_MS;
}

export class D365AuthService {
  private tokenCache: D365Token | null = null;
  private credCache: { valor: CredencialesDynamics; vencenEn: number } | null = null;

  /**
   * Las credenciales que el sistema esta usando DE VERDAD: base si hay,
   * `.env` si no. Cacheadas por TTL_CREDENCIALES_MS para no consultar la
   * base en cada request de una bajada de catalogo.
   */
  async credenciales(): Promise<CredencialesDynamics> {
    const ahora = Date.now();
    if (this.credCache !== null && this.credCache.vencenEn > ahora) return this.credCache.valor;

    const valor = await credencialesEfectivas();
    this.credCache = { valor, vencenEn: ahora + TTL_CREDENCIALES_MS };
    return valor;
  }

  /** Base de las APIs OData (sin barra final). La usa d365-entity. */
  async getODataBaseUrl(): Promise<string> {
    const cred = await this.credenciales();
    return `${cred.baseUrl}/data`;
  }

  /** "trv" para Market Trujillo. La usa d365-catalogo para filtrar por empresa. */
  async getDataAreaId(): Promise<string> {
    return (await this.credenciales()).dataAreaId;
  }

  async generarToken(): Promise<D365Token> {
    const cred = await this.credenciales();
    if (cred.origen === 'ninguno') {
      throw new ErrorHttp(
        400,
        'Dynamics no configurado. Cargalas en el servidor con `npm run config:dynamics`, o poné D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET y D365_BASE_URL en el .env.',
      );
    }

    const body = new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      grant_type: 'client_credentials',
      resource: cred.baseUrl,
    });

    const respuesta = await fetch(`https://login.microsoftonline.com/${cred.tenantId}/oauth2/token`, {
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

  /**
   * Fuerza pedir un token nuevo -- usado cuando D365 responde 401 con el
   * actual. Tambien tira el cache de credenciales: si D365 rechaza el token,
   * una de las causas posibles es que las credenciales cambiaron, y
   * reintentar con las mismas cacheadas seria pedir el mismo 401 de nuevo.
   */
  async renovarToken(): Promise<string> {
    this.tokenCache = null;
    this.credCache = null;
    return this.getTokenValido();
  }

  /** Async ahora: saberlo puede requerir leer la base. */
  async isConfigured(): Promise<boolean> {
    return (await this.credenciales()).origen !== 'ninguno';
  }
}

export const d365AuthService = new D365AuthService();
