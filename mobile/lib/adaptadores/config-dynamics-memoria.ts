/**
 * Adaptador en memoria de RepositorioConfigDynamics.
 *
 * El `clientSecret` vive SOLO acá adentro (variable de módulo, nunca en
 * el objeto que devuelve `obtener()`) — ni siquiera este archivo lo
 * expone hacia afuera salvo como el booleano `secretoConfigurado`.
 */

import type {
  DatosConfigDynamics,
  EstadoConfigDynamics,
  RepositorioConfigDynamics,
  ResultadoPruebaDynamics,
} from '../puertos/repositorios';
import { simularLatencia } from './_compartido';

interface EstadoInterno {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  urlBase: string;
}

let estado: EstadoInterno | null = null;

function aEstadoPublico(): EstadoConfigDynamics {
  return estado
    ? { tenantId: estado.tenantId, clientId: estado.clientId, urlBase: estado.urlBase, secretoConfigurado: true }
    : { tenantId: '', clientId: '', urlBase: '', secretoConfigurado: false };
}

export const configDynamicsMemoria: RepositorioConfigDynamics = {
  async obtener() {
    await simularLatencia();
    return aEstadoPublico();
  },

  async guardar(datos: DatosConfigDynamics) {
    await simularLatencia();
    const tenantId = datos.tenantId.trim();
    const clientId = datos.clientId.trim();
    const urlBase = datos.urlBase.trim();
    if (!tenantId || !clientId || !urlBase) {
      throw new Error('Tenant, Client ID y URL base son obligatorios.');
    }
    // Sin clientSecret nuevo: se conserva el ya guardado (permite corregir
    // tenant/clientId/urlBase sin re-tipear el secreto). Si nunca hubo uno
    // guardado y tampoco viene uno nuevo, no hay nada que guardar.
    const clientSecret = datos.clientSecret?.trim() || estado?.clientSecret;
    if (!clientSecret) throw new Error('Falta el client secret.');

    estado = { tenantId, clientId, urlBase, clientSecret };
    return aEstadoPublico();
  },

  async probarConexion(): Promise<ResultadoPruebaDynamics> {
    // Latencia más larga que una lectura local: una prueba de conexión es
    // un viaje de red real (a Azure AD), no un cálculo en memoria.
    await simularLatencia(400, 900);
    if (!estado) {
      return { ok: false, mensaje: 'Todavía no hay credenciales guardadas.' };
    }
    // Sin Dynamics real contra qué probar: el mock no puede validar de
    // verdad tenant/clientId/secret — dice que sí, aclarando que es
    // simulado, en vez de fingir una validación que no hace.
    return { ok: true, mensaje: 'Conexión correcta (simulada) — el adaptador real prueba contra Azure AD.' };
  },
};
