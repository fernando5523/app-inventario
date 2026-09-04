/**
 * Adaptador HTTP de RepositorioConfigDynamics. Mismo puerto que
 * config-dynamics-memoria.ts. Solo Administrador — el backend monta
 * `requiereRol('administrador')` en todo el router.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra el código del backend
 * ---------------------------------------------------------------------------
 * Leído de backend/src/modules/config-dynamics/{config-dynamics.routes,
 * config-dynamics.service}.ts y del montaje en backend/src/config/app.ts:
 *
 *   GET  /api/config-dynamics         → EstadoConfigDynamicsDto
 *   POST /api/config-dynamics/probar  → { ok, mensaje }
 *
 * El backend también expone `PUT /api/config-dynamics`, y este adaptador NO
 * lo usa a propósito: las credenciales del ERP se cargan en el servidor con
 * `npm run config:dynamics` desde backend/, no desde el teléfono. Por eso el
 * puerto tampoco declara `guardar` — ver el comentario de la interfaz en
 * lib/puertos/repositorios.ts.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ADAPTADOR NUNCA VA A RECIBIR
 * ---------------------------------------------------------------------------
 * El `client_secret`. No es que no lo pidamos: el backend NO lo devuelve, ni
 * en claro ni enmascarado, en ninguna respuesta. Lo único que llega sobre él
 * es el booleano `secretoConfigurado`. Si algún día una respuesta trajera un
 * secreto, sería un bug del backend, no un dato que esta capa deba mostrar.
 */

import type { EstadoConfigDynamics, RepositorioConfigDynamics, ResultadoPruebaDynamics } from '../puertos/repositorios';
import { pedir } from './_http';

const RUTA = '/api/config-dynamics';

/** Tal cual lo devuelve config-dynamics.service.ts#EstadoConfigDynamicsDto. */
interface EstadoDto {
  tenantId: string;
  clientId: string;
  urlBase: string;
  secretoConfigurado: boolean;
  origen: 'base' | 'entorno' | 'ninguno';
  puedeGuardarSecreto: boolean;
  actualizadoEn: string | null;
}

interface PruebaDto {
  ok: boolean;
  mensaje: string;
}

export const configDynamicsApi: RepositorioConfigDynamics = {
  async obtener(): Promise<EstadoConfigDynamics> {
    const dto = await pedir<EstadoDto>(RUTA);
    return {
      tenantId: dto.tenantId,
      clientId: dto.clientId,
      urlBase: dto.urlBase,
      secretoConfigurado: dto.secretoConfigurado,
      origen: dto.origen,
      actualizadoEn: dto.actualizadoEn,
    };
  },

  async probarConexion(): Promise<ResultadoPruebaDynamics> {
    // Timeout largo: esto NO es una lectura local. El backend le pide un
    // token a Azure AD de verdad, y un tenant lento o una red de tienda
    // floja tardan bastante más que cualquier otro request de la app.
    //
    // `idempotente: true` porque pedir un token no cambia nada — es seguro
    // que se reintente, a diferencia de un POST que escribe.
    const dto = await pedir<PruebaDto>(`${RUTA}/probar`, {
      metodo: 'POST',
      msTimeout: 40_000,
      idempotente: true,
    });
    return { ok: dto.ok, mensaje: dto.mensaje };
  },
};
