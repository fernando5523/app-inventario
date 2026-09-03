/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura).
 *
 * LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO: el `clientSecret` entra, se
 * cifra y se guarda. NUNCA sale. No hay un solo `return` acá que lo
 * incluya, ni siquiera enmascarado dentro del DTO -- la unica forma de que
 * un secreto no aparezca en un log, un cache o una captura de pantalla es
 * que la respuesta no lo tenga.
 *
 * `credencialesEfectivas()` es la excepcion deliberada: descifra el secreto
 * para poder pedirle un token a Azure AD. Es de uso interno del servidor y
 * no la llama ningun controller.
 */

import { prisma } from '../../config/database';
import { d365Config } from '../../config/d365.config';
import { registrarAuditoria } from '../../shared/auditoria';
import { ErrorHttp } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { CifradoNoConfigurado, cifradoDisponible, cifrar, descifrar, enmascarar } from './config-dynamics.cifrado';
import type { GuardarConfigDynamicsInput } from './config-dynamics.schema';

/** Fila unica: la integracion con el ERP es una sola para todo el sistema. */
const ID_FILA = 1;

/** Espeja mobile/lib/puertos/repositorios.ts#EstadoConfigDynamics. */
export interface EstadoConfigDynamicsDto {
  tenantId: string;
  clientId: string;
  urlBase: string;
  /**
   * Lo UNICO que se dice del secreto. No su valor, no su largo, no sus
   * primeros caracteres: solo si hay uno guardado. El puerto del front lo
   * dice textual -- "un secreto que la pantalla puede mostrar de vuelta es
   * un secreto que alguien puede fotografiar".
   */
  secretoConfigurado: boolean;
  /** De donde salen las credenciales que se estan usando hoy. */
  origen: 'base' | 'entorno' | 'ninguno';
  /**
   * false = falta APP_CIFRADO_CLAVE en el entorno, asi que no se puede
   * guardar un secreto nuevo. Se informa para que la pantalla explique por
   * que el campo esta bloqueado, en vez de dejar que el guardado falle
   * recien al apretar el boton.
   */
  puedeGuardarSecreto: boolean;
  actualizadoEn: string | null;
}

/**
 * Las credenciales que EFECTIVAMENTE se usan, con la precedencia del
 * sistema: la fila de la base gana; si no hay, se cae a las D365_* del
 * entorno.
 *
 * Ese orden y no el inverso porque la base es lo que una persona puede
 * cambiar desde la pantalla, y el `.env` es un archivo que en este proyecto
 * solo puede tocar alguien con acceso al servidor (ver el paso manual del
 * README). Si el entorno ganara, cargar las credenciales por pantalla no
 * tendria ningun efecto y nadie entenderia por que.
 *
 * De uso INTERNO del servidor: devuelve el secreto en claro para poder
 * pedir el token. Ningun controller la llama.
 */
export async function credencialesEfectivas(): Promise<{
  tenantId: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  dataAreaId: string;
  origen: 'base' | 'entorno' | 'ninguno';
}> {
  const fila = await prisma.configDynamics.findUnique({ where: { id: ID_FILA } });

  if (fila !== null && fila.clientSecretCifrado !== null) {
    return {
      tenantId: fila.tenantId,
      clientId: fila.clientId,
      clientSecret: descifrar(fila.clientSecretCifrado),
      baseUrl: fila.urlBase,
      dataAreaId: fila.dataAreaId !== '' ? fila.dataAreaId : d365Config.dataAreaId,
      origen: 'base',
    };
  }

  if (d365Config.isConfigured()) {
    return {
      tenantId: d365Config.tenantId,
      clientId: d365Config.clientId,
      clientSecret: d365Config.clientSecret,
      baseUrl: d365Config.baseUrl,
      dataAreaId: d365Config.dataAreaId,
      origen: 'entorno',
    };
  }

  return { tenantId: '', clientId: '', clientSecret: '', baseUrl: '', dataAreaId: '', origen: 'ninguno' };
}

export async function obtener(): Promise<EstadoConfigDynamicsDto> {
  const fila = await prisma.configDynamics.findUnique({ where: { id: ID_FILA } });

  if (fila !== null) {
    return {
      tenantId: fila.tenantId,
      clientId: fila.clientId,
      urlBase: fila.urlBase,
      secretoConfigurado: fila.clientSecretCifrado !== null,
      origen: fila.clientSecretCifrado !== null ? 'base' : 'ninguno',
      puedeGuardarSecreto: cifradoDisponible(),
      actualizadoEn: fila.updatedAt.toISOString(),
    };
  }

  // Sin fila propia: se refleja lo que hay en el entorno, para que la
  // pantalla muestre la configuracion real y no un formulario vacio que
  // haga pensar que Dynamics no esta configurado cuando si lo esta.
  return {
    tenantId: d365Config.tenantId,
    clientId: d365Config.clientId,
    urlBase: d365Config.baseUrl,
    secretoConfigurado: d365Config.clientSecret !== '',
    origen: d365Config.isConfigured() ? 'entorno' : 'ninguno',
    puedeGuardarSecreto: cifradoDisponible(),
    actualizadoEn: null,
  };
}

/**
 * Guarda tenant/clientId/urlBase siempre, y el secreto solo si vino.
 *
 * `clientSecret` es opcional a proposito (asi lo declara el puerto del
 * front): sin el, se actualizan los otros tres campos y el secreto ya
 * guardado queda intacto. Es lo que permite corregir un tenant mal tipeado
 * sin obligar a alguien a ir a buscar el secreto entero a Azure de nuevo --
 * y sin ese detalle, la gente termina pegando el secreto en un chat para
 * tenerlo a mano.
 */
export async function guardar(
  actor: ColaboradorAutenticado,
  datos: GuardarConfigDynamicsInput,
): Promise<EstadoConfigDynamicsDto> {
  let cifrado: string | undefined;
  if (datos.clientSecret !== undefined) {
    if (!cifradoDisponible()) {
      // 503 y no 400: el request es correcto, lo que falta es una pieza de
      // configuracion del servidor. Se rechaza en vez de guardar el secreto
      // en claro -- un secreto que no se puede proteger no se guarda.
      throw new ErrorHttp(503, new CifradoNoConfigurado().message);
    }
    cifrado = cifrar(datos.clientSecret);
  }

  const comun = {
    tenantId: datos.tenantId,
    clientId: datos.clientId,
    urlBase: datos.urlBase,
    actualizadoPorId: actor.colaboradorId,
    ...(datos.dataAreaId !== undefined ? { dataAreaId: datos.dataAreaId } : {}),
  };

  const fila = await prisma.configDynamics.upsert({
    where: { id: ID_FILA },
    update: { ...comun, ...(cifrado !== undefined ? { clientSecretCifrado: cifrado } : {}) },
    create: { id: ID_FILA, ...comun, ...(cifrado !== undefined ? { clientSecretCifrado: cifrado } : {}) },
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'config_dynamics.actualizada',
    entidad: 'config_dynamics',
    entidadId: fila.id,
    // El secreto NUNCA viaja al log de auditoria, ni cifrado. Solo queda
    // registrado QUE se cambio y una huella enmascarada para poder
    // confirmar "cargué el que empieza con ab" -- mismo criterio que el
    // reseteo de PIN (ver prisma/schema.prisma#RegistroAuditoria).
    detalle: {
      tenantId: datos.tenantId,
      clientId: datos.clientId,
      urlBase: datos.urlBase,
      secretoActualizado: cifrado !== undefined,
      ...(datos.clientSecret !== undefined ? { huellaSecreto: enmascarar(datos.clientSecret) } : {}),
    },
  });

  return {
    tenantId: fila.tenantId,
    clientId: fila.clientId,
    urlBase: fila.urlBase,
    secretoConfigurado: fila.clientSecretCifrado !== null,
    origen: fila.clientSecretCifrado !== null ? 'base' : 'ninguno',
    puedeGuardarSecreto: cifradoDisponible(),
    actualizadoEn: fila.updatedAt.toISOString(),
  };
}

export interface ResultadoPruebaDto {
  ok: boolean;
  mensaje: string;
}

/**
 * Prueba las credenciales YA GUARDADAS contra Azure AD.
 *
 * Pide un token y nada mas: no trae los 8.000 items del catalogo. La
 * pregunta que responde es "estas credenciales sirven", y para eso alcanza
 * con que Azure conteste; bajar el catalogo entero para averiguarlo son
 * varios minutos de la WiFi de la tienda para una respuesta de si/no.
 *
 * Nunca lanza por credenciales invalidas: devuelve `ok: false` con el
 * motivo. Que Azure rechace un secreto no es un error del servidor -- es
 * exactamente el resultado que esta prueba viene a averiguar, y la pantalla
 * tiene que poder mostrarlo sin un catch.
 */
export async function probarConexion(): Promise<ResultadoPruebaDto> {
  const cred = await credencialesEfectivas();

  if (cred.origen === 'ninguno' || cred.clientSecret === '') {
    return { ok: false, mensaje: 'Faltan credenciales: cargá tenant, client id, URL y secreto antes de probar.' };
  }

  const cuerpo = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    grant_type: 'client_credentials',
    // `resource` es la propia baseUrl de D365, no un scope v2.0 -- mismo
    // patron que d365-auth.service.ts.
    resource: cred.baseUrl,
  });

  try {
    const respuesta = await fetch(`https://login.microsoftonline.com/${cred.tenantId}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (respuesta.ok) {
      return { ok: true, mensaje: `Conexión correcta con Azure AD (credenciales tomadas de: ${cred.origen}).` };
    }

    // El cuerpo del error de Azure trae el codigo AADSTS que dice QUE esta
    // mal (tenant inexistente vs secreto vencido vs app sin permisos). Se
    // acota a 300 caracteres: alcanza para diagnosticar y no vuelca una
    // respuesta entera de Azure en la pantalla de un celular.
    const detalle = (await respuesta.text()).slice(0, 300);
    return { ok: false, mensaje: `Azure AD rechazó las credenciales (HTTP ${respuesta.status}). ${detalle}` };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    return { ok: false, mensaje: `No se pudo contactar a Azure AD: ${motivo}` };
  }
}
