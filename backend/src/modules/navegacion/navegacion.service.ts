/**
 * LA NAVEGACION CONFIGURABLE: que ve cada rol en el home y en la barra.
 *
 * Unico archivo del modulo que toca Prisma. El catalogo (que elementos
 * existen y como se llaman) vive en `navegacion.catalogo.ts`; la lista blanca
 * (que puede tener cada rol) en `navegacion.lista-blanca.ts`; en la base solo
 * esta lo que el Administrador cambia -- orden y prendido.
 *
 * ESTO ES PRESENTACION, NO AUTORIZACION. Esconder una tarjeta es una
 * comodidad; mostrarla no es un permiso. Si alguien llega igual por otro
 * camino, el `requiereRol` del router y los `*.permisos.ts` lo frenan lo
 * mismo.
 */

import type { Rol, TipoNavegacion } from '@prisma/client';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  ACCESOS_CATALOGO,
  MAXIMO_TABS,
  TABS_CATALOGO,
  type AccesoCatalogo,
  type TabCatalogo,
} from './navegacion.catalogo';
import { rolAdmiteAcceso } from './navegacion.lista-blanca';

/** Un acceso resuelto: el catalogo mas lo que el Administrador decidio. */
export interface AccesoDto extends AccesoCatalogo {
  visible: boolean;
  orden: number;
}

export interface TabDto extends TabCatalogo {
  visible: boolean;
  orden: number;
}

/** Lo que la app pide al iniciar sesion: SOLO lo visible, en orden. */
export interface NavegacionDeUnRolDto {
  rol: Rol;
  accesos: AccesoDto[];
  tabs: TabDto[];
}

/** Lo que ve el Administrador: TODO, incluidos los apagados. */
export interface ConfiguracionDeUnRolDto extends NavegacionDeUnRolDto {
  /** Cuantos tabs se pueden prender a la vez, y por que. Lo muestra la pantalla. */
  maximoTabs: number;
}

/**
 * Las filas guardadas de un rol, indexadas por clave. Una sola consulta para
 * los dos tipos: la pantalla del Administrador los pide juntos y la app
 * tambien.
 */
async function guardadasDe(rol: Rol): Promise<Map<string, { orden: number; visible: boolean }>> {
  const filas = await prisma.configuracionNavegacion.findMany({
    where: { rol },
    select: { tipo: true, clave: true, orden: true, visible: true },
  });
  // La clave del Map incluye el tipo: un acceso y un tab pueden llamarse
  // igual (`/coordinador/ciclo` y `ciclo` no, pero nada lo impide a futuro).
  return new Map(filas.map((f) => [`${f.tipo}:${f.clave}`, { orden: f.orden, visible: f.visible }]));
}

/**
 * Resuelve el catalogo de un rol contra lo guardado.
 *
 * EL CATALOGO MANDA SOBRE QUE EXISTE, la base sobre el orden y el prendido.
 * Un elemento del catalogo SIN fila en la base sale visible y al final: es
 * una pantalla nueva que todavia nadie configuro, y nacer apagada la
 * convertiria en una funcionalidad que se entrega y nadie encuentra.
 *
 * Una fila en la base SIN elemento en el catalogo se ignora en silencio: es
 * una pantalla que se saco de la app y la fila quedo huerfana. Devolverla
 * seria ofrecer una tarjeta que lleva a una ruta que ya no existe.
 */
function resolver<T extends { nota?: string }>(
  catalogo: T[],
  clavesDe: (elemento: T) => string,
  guardadas: Map<string, { orden: number; visible: boolean }>,
  tipo: TipoNavegacion,
): Array<T & { visible: boolean; orden: number }> {
  return catalogo
    .map((elemento, i) => {
      const guardada = guardadas.get(`${tipo}:${clavesDe(elemento)}`);
      return {
        ...elemento,
        visible: guardada?.visible ?? true,
        // Sin fila, el orden del catalogo -- que es el de hoy en la app. Se
        // desplaza por `catalogo.length` para que un elemento nuevo caiga
        // DESPUES de todo lo que alguien ya ordeno a mano.
        orden: guardada?.orden ?? catalogo.length + i + 1,
      };
    })
    .sort((a, b) => a.orden - b.orden);
}

/** El estado completo de un rol, apagados incluidos. Lo usa el Administrador. */
export async function configuracionDe(rol: Rol): Promise<ConfiguracionDeUnRolDto> {
  const guardadas = await guardadasDe(rol);
  return {
    rol,
    accesos: resolver(ACCESOS_CATALOGO[rol], (a) => a.ruta, guardadas, 'acceso'),
    tabs: resolver(TABS_CATALOGO[rol], (t) => t.name, guardadas, 'tab'),
    maximoTabs: MAXIMO_TABS,
  };
}

/**
 * Lo que la app arma al iniciar sesion: solo lo PRENDIDO.
 *
 * Si esto devolviera los apagados, la app tendria que filtrarlos -- y el dia
 * que una version vieja no lo haga, el Administrador apagaria una tarjeta y
 * seguiria apareciendo.
 */
export async function navegacionDe(rol: Rol): Promise<NavegacionDeUnRolDto> {
  const todo = await configuracionDe(rol);
  return {
    rol,
    accesos: todo.accesos.filter((a) => a.visible),
    tabs: todo.tabs.filter((t) => t.visible),
  };
}

/**
 * EL LIMITE DE TABS, con su razon. No es un numero elegido al azar: con cinco
 * quedan tan angostos que "Armar hojas" no entra sin cortarse (ver
 * `MAXIMO_TABS` y TabBar.tsx). El mensaje lo DICE, porque "máximo 4" no le
 * explica nada a quien se lo encuentra.
 *
 * Funcion aparte y exportada para poder probarla: hoy ningun rol tiene cinco
 * tabs en el catalogo, asi que por el camino de `guardar` esta rama no se
 * puede alcanzar con datos validos. Una guarda que no se puede ejercitar es
 * una guarda que nadie sabe si anda -- y el dia que alguien agregue un quinto
 * tab al catalogo, esta es la que lo frena.
 */
export function validarCantidadDeTabs(prendidos: number): void {
  if (prendidos <= MAXIMO_TABS) return;
  throw new Conflicto(
    `La barra de abajo aguanta ${MAXIMO_TABS} entradas y estás dejando ${prendidos} prendidas. ` +
      'Con una más quedan tan angostas que "Armar hojas" no entra sin cortarse. ' +
      'Apagá una antes de prender otra.',
  );
}

/** Lo que el Administrador manda: la lista completa de un tipo, EN ORDEN. */
export interface ElementoAGuardar {
  clave: string;
  visible: boolean;
}

/**
 * GUARDA el orden y el prendido de un tipo para un rol.
 *
 * Se recibe la lista ENTERA y en orden, no un diff. Un diff obliga a las dos
 * puntas a acordar como se numera, y reordenar es exactamente la operacion
 * donde eso se rompe: dos cambios simultaneos dejan el orden a medias. Con la
 * lista entera, lo ultimo que llego es lo que queda.
 */
export async function guardar(
  actor: ColaboradorAutenticado,
  rol: Rol,
  tipo: TipoNavegacion,
  elementos: ElementoAGuardar[],
): Promise<ConfiguracionDeUnRolDto> {
  const catalogo: string[] =
    tipo === 'acceso' ? ACCESOS_CATALOGO[rol].map((a) => a.ruta) : TABS_CATALOGO[rol].map((t) => t.name);

  /**
   * LA LISTA BLANCA, y es la guarda que sostiene el conteo ciego.
   *
   * Una clave que no esta en el catalogo DE ESTE ROL se rechaza. Para los
   * accesos se chequea ademas `rolAdmiteAcceso`, que dice lo mismo por otro
   * camino -- la ruta tiene que ser del grupo del rol. Son dos por la misma
   * razon por la que el service revalida lo que ya valido el router: si
   * manana alguien agrega una ruta al catalogo del rol equivocado, este
   * segundo chequeo lo frena igual.
   */
  const desconocidas = elementos.filter((e) => !catalogo.includes(e.clave));
  if (desconocidas.length > 0) {
    throw new SolicitudInvalida(
      `Estos elementos no existen para el rol ${rol}: ${desconocidas.map((e) => e.clave).join(', ')}. ` +
        'Un rol solo puede tener las pantallas de su propio grupo.',
    );
  }
  if (tipo === 'acceso') {
    const ajenas = elementos.filter((e) => !rolAdmiteAcceso(rol, e.clave));
    if (ajenas.length > 0) {
      throw new SolicitudInvalida(
        `Estas rutas no son del grupo de ${rol}: ${ajenas.map((e) => e.clave).join(', ')}. ` +
          'Darle a un rol la pantalla de otro rompería el conteo ciego.',
      );
    }
  }

  const repetidas = elementos.map((e) => e.clave).filter((c, i, todas) => todas.indexOf(c) !== i);
  if (repetidas.length > 0) {
    throw new SolicitudInvalida(`Hay elementos repetidos: ${[...new Set(repetidas)].join(', ')}.`);
  }

  if (tipo === 'tab') validarCantidadDeTabs(elementos.filter((e) => e.visible).length);

  const antes = await configuracionDe(rol);

  await prisma.$transaction(
    elementos.map((e, i) =>
      prisma.configuracionNavegacion.upsert({
        where: { rol_tipo_clave: { rol, tipo, clave: e.clave } },
        // Orden consecutivo desde 1: la posicion en la lista que llego.
        create: { rol, tipo, clave: e.clave, orden: i + 1, visible: e.visible, actualizadoPorId: actor.colaboradorId },
        update: { orden: i + 1, visible: e.visible, actualizadoPorId: actor.colaboradorId },
      }),
    ),
  );

  const despues = await configuracionDe(rol);

  /**
   * AUDITORIA CON EL ANTES Y EL DESPUES. Sacarle un acceso a un rol puede
   * dejar a alguien sin poder trabajar un lunes a las 7 de la mañana, y
   * entonces la pregunta es quien lo hizo y que habia antes. Se guarda el
   * orden completo de los dos lados, no solo lo que cambio: reconstruir el
   * estado anterior a partir de un diff obliga a tener todos los diffs.
   */
  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'navegacion.actualizada',
    entidad: 'navegacion',
    // No hay una fila unica que identifique el cambio (son varias), asi que
    // `entidadId` no sirve como puntero. Se deja en 0 y el detalle lleva el
    // rol, que es la unidad real de este cambio.
    entidadId: 0,
    detalle: {
      rol,
      tipo,
      antes: (tipo === 'acceso' ? antes.accesos : antes.tabs).map((e) => ({
        clave: 'ruta' in e ? e.ruta : e.name,
        visible: e.visible,
      })),
      despues: (tipo === 'acceso' ? despues.accesos : despues.tabs).map((e) => ({
        clave: 'ruta' in e ? e.ruta : e.name,
        visible: e.visible,
      })),
    },
  });

  return despues;
}

/**
 * VUELVE AL VALOR DE FABRICA: el catalogo, en su orden, todo prendido.
 *
 * Es la salida cuando alguien se equivoca reordenando y no se acuerda de como
 * estaba. Borra las filas del rol en vez de reescribirlas: sin filas, el
 * resolutor cae en el catalogo, que ES la fabrica -- y asi no hay dos
 * definiciones de "como venia de origen" que puedan separarse.
 */
export async function restablecer(
  actor: ColaboradorAutenticado,
  rol: Rol,
  tipo: TipoNavegacion,
): Promise<ConfiguracionDeUnRolDto> {
  const antes = await configuracionDe(rol);

  await prisma.configuracionNavegacion.deleteMany({ where: { rol, tipo } });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'navegacion.restablecida',
    entidad: 'navegacion',
    entidadId: 0,
    detalle: {
      rol,
      tipo,
      antes: (tipo === 'acceso' ? antes.accesos : antes.tabs).map((e) => ({
        clave: 'ruta' in e ? e.ruta : e.name,
        visible: e.visible,
      })),
    },
  });

  return configuracionDe(rol);
}
