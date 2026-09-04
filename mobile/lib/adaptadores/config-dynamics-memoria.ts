/**
 * Adaptador en memoria de RepositorioConfigDynamics. Solo para desarrollo
 * sin backend (ver TODO_A_MEMORIA en contenedor.ts).
 *
 * Ya no puede ESCRIBIR credenciales: el puerto perdió `guardar` cuando la
 * carga pasó al servidor (`backend/scripts/cargar-config-dynamics.ts`). Lo
 * que queda es el estado inicial vacío, que es exactamente lo que se ve sin
 * backend — y es honesto que se vea así en vez de simular credenciales que
 * no existen.
 */

import type { EstadoConfigDynamics, RepositorioConfigDynamics, ResultadoPruebaDynamics } from '../puertos/repositorios';
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
    ? {
        tenantId: estado.tenantId,
        clientId: estado.clientId,
        urlBase: estado.urlBase,
        secretoConfigurado: true,
        origen: 'base',
        actualizadoEn: null,
      }
    : { tenantId: '', clientId: '', urlBase: '', secretoConfigurado: false, origen: 'ninguno', actualizadoEn: null };
}

export const configDynamicsMemoria: RepositorioConfigDynamics = {
  async obtener() {
    await simularLatencia();
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
