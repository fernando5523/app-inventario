/**
 * Adaptador HTTP de RepositorioConfig. Mismo puerto que config-memoria.ts.
 * Configuración global del sistema — solo Administrador (el backend monta
 * `requiereRol('administrador')` en todo el router).
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra el código del backend
 * ---------------------------------------------------------------------------
 * Leído de backend/src/modules/config/{config.routes,config.schema,
 * config.service}.ts y del montaje en backend/src/config/app.ts:
 *
 *   GET /api/config          → ConfiguracionDto[]
 *   PUT /api/config/:clave   body { valor }  → ConfiguracionDto
 *
 * ---------------------------------------------------------------------------
 * OJO: el backend NO habla el mismo idioma que el puerto.
 * ---------------------------------------------------------------------------
 * El puerto pide un OBJETO cerrado (`ConfigSistema`: tamanoHojaDefecto,
 * conteosDelCiclo, umbralMediaUnidad). El backend guarda CLAVE-VALOR, una
 * fila por opción, y actualiza de a UNA clave por request.
 *
 * Mi primera versión de este archivo asumía `PUT /api/config` con el objeto
 * entero. Estaba mal. Traducir entre los dos modelos es exactamente el
 * trabajo de un adaptador — no se cambia el puerto para que se parezca al
 * backend, ni al revés: la pantalla sigue viendo un objeto y acá se arma y
 * se desarma.
 *
 * ⚠️ `actualizar()` NO es atómico, y no puede serlo con este contrato: son
 * 3 PUT sucesivos. Si el segundo falla, el primero YA quedó guardado. Se
 * documenta en vez de esconderse — y por eso devuelve el estado real que
 * respondió el servidor, no el objeto que se quiso escribir.
 */

import { TAMANOS_HOJA, type ConfigSistema, type TamanoHoja } from '../dominio/tipos';
import type { RepositorioConfig } from '../puertos/repositorios';
import { ErrorApi, pedir } from './_http';

const RUTA = '/api/config';

/** Las 3 claves de backend/src/modules/config/config.schema.ts. */
const CLAVE_TAMANO = 'TAMANO_HOJA_DEFECTO';
const CLAVE_CONTEOS = 'CANTIDAD_CONTEOS_CICLO';
const CLAVE_UMBRAL = 'UMBRAL_MEDIA_UNIDAD_PAQUETE';

/** Tal cual lo devuelve config.service.ts#ConfiguracionDto. */
interface ConfiguracionDto {
  clave: string;
  valor: number | string;
  tipo: 'entero' | 'decimal' | 'texto';
  descripcion: string;
  updatedAt: string;
}

function numeroDe(filas: ConfiguracionDto[], clave: string): number {
  const fila = filas.find((f) => f.clave === clave);
  // Una clave faltante es una instalación rota (el seed las crea), no un
  // caso a rellenar con un default inventado acá: cuántas pasadas tiene el
  // ciclo de conteo no es algo que este archivo pueda suponer.
  if (!fila) {
    throw new ErrorApi('respuesta-invalida', {
      mensaje: `El servidor no devolvió la configuración "${clave}". Revisá la carga inicial del sistema.`,
    });
  }
  const valor = Number(fila.valor);
  if (!Number.isFinite(valor)) {
    throw new ErrorApi('respuesta-invalida', {
      mensaje: `La configuración "${clave}" no es un número válido.`,
    });
  }
  return valor;
}

function comoTamanoHoja(valor: number): TamanoHoja {
  // El backend ya valida 20/30/50, pero eso no exime de chequear acá: el
  // tipo `TamanoHoja` es una promesa que hace ESTE archivo, y una base
  // editada a mano no la respeta sola.
  const tamano = TAMANOS_HOJA.find((t) => t === valor);
  if (!tamano) {
    throw new ErrorApi('respuesta-invalida', {
      mensaje: `El tamaño de hoja configurado (${valor}) no es 20, 30 ni 50.`,
    });
  }
  return tamano;
}

function armarConfig(filas: ConfiguracionDto[]): ConfigSistema {
  return {
    tamanoHojaDefecto: comoTamanoHoja(numeroDe(filas, CLAVE_TAMANO)),
    conteosDelCiclo: numeroDe(filas, CLAVE_CONTEOS),
    umbralMediaUnidad: numeroDe(filas, CLAVE_UMBRAL),
  };
}

export const configApi: RepositorioConfig = {
  async obtener() {
    return armarConfig(await pedir<ConfiguracionDto[]>(RUTA));
  },

  async actualizar(datos: ConfigSistema) {
    // Secuencial y no en paralelo a propósito: si algo falla, que falle
    // sobre un estado predecible. Con `Promise.all` no se sabría cuáles de
    // las 3 llegaron a aplicarse.
    const escrituras: Array<[string, number]> = [
      [CLAVE_TAMANO, datos.tamanoHojaDefecto],
      [CLAVE_CONTEOS, datos.conteosDelCiclo],
      [CLAVE_UMBRAL, datos.umbralMediaUnidad],
    ];

    const aplicadas: ConfiguracionDto[] = [];
    for (const [clave, valor] of escrituras) {
      aplicadas.push(
        await pedir<ConfiguracionDto>(`${RUTA}/${clave}`, { metodo: 'PUT', cuerpo: { valor } }),
      );
    }

    // Se devuelve lo que respondió el SERVIDOR, no `datos`: el backend
    // normaliza el valor antes de guardarlo (config.service.ts#VALIDADORES)
    // y la pantalla tiene que mostrar lo que quedó guardado de verdad, no lo
    // que creyó mandar.
    return armarConfig(aplicadas);
  },
};
