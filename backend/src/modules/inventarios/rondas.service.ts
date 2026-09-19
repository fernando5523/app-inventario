/**
 * Cierre de una ronda y apertura de la siguiente. Es el motor del ciclo de
 * 3 conteos.
 *
 * Toca Prisma; las REGLAS viven en `dominio/ciclo-conteos.ts`, sin Prisma,
 * para poder probarlas de verdad. En particular la del cliente -- EL ÚLTIMO
 * CONTEO MANDA -- que está aislada en `conteoQueManda()`: si algún día se
 * revierte, se cambia esa función y nada más.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS COSAS QUE NO SE PUEDEN ERRAR ACÁ
 * ---------------------------------------------------------------------------
 *
 * 1. NO SE BORRA NADA. La ronda 2 se AGREGA; las hojas, productos y conteos
 *    de la ronda 1 quedan intactos. La auditoría compara todas las pasadas
 *    (`auditoria.service.ts` arma la matriz con la lista `conteos`), así
 *    que borrar una ronda es destruir la evidencia que justifica el cierre.
 *    Es lo contrario de `crearHojas`, que sí es destructivo -- por eso vive
 *    en otra función y no se reusa.
 *
 * 2. CONTEO CIEGO. Las hojas de la ronda 2 materializan sus PROPIOS
 *    `Producto`, sin ningún `Conteo` asociado. El contador abre la hoja
 *    nueva y ve los renglones vacíos: no hay forma de que vea lo que él
 *    mismo cargó en la ronda 1, ni siquiera por accidente, porque son filas
 *    distintas de la tabla. Si viera su número anterior lo confirmaría en vez
 *    de contar, y las tres pasadas dejarían de servir para nada.
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import {
  aJustificacionAsistencia,
  aMarcaAsistencia,
  diasDelInventario,
  quienesCobranBono,
  SELECT_ASISTENCIA,
  SELECT_JUSTIFICACIONES,
} from '../../dominio/asistencia';
import {
  cuadro,
  destinoTrasRonda,
  itemsParaLaRondaSiguiente,
  puedeAbrirRondaSiguiente,
  puedeAuditorAbrirOtraRonda,
  rondaEmpezo,
  resumirRonda,
  RONDAS_DEL_CICLO,
  type ItemDeRonda,
  type ResumenDeRonda,
} from '../../dominio/ciclo-conteos';
import { numeroDeHoja, ordenarParaContar, partirEnHojas, zonaDeHoja } from '../../dominio/lote';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado, Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { armarMatriz } from '../auditoria/auditoria.service';
import { diferenciasParaPersistir, embudoDeConteos, resumir as resumirAuditoria } from '../auditoria/auditoria.calculos';
import { redondear } from '../historial/historial.calculos';
import { ROLES_DE_TIENDA } from '../sesion/sesion.service';
import { totalUnidades } from '../hojas/hojas.calculos';
import { INCLUIR_TODO, aHojaDto, type HojaDto } from '../hojas/hojas.service';
import {
  validarAbrirRondaExtra,
  validarAjusteEnCurso,
  validarIniciarAjuste,
  type EstadoConAjuste,
} from './ajuste.permisos';

/**
 * El inventario para LEER: existe y es de la sucursal del actor. NO chequea
 * estado -- un inventario ya cerrado (`conteo_cerrado`/`liquidado`) igual se
 * puede CONSULTAR: el Coordinador y el Auditor tienen que poder ver el
 * resultado del ciclo terminado (el embudo de la pantalla de Ciclo). Escribir
 * es otra cosa: para eso está `inventarioDelActor`, que sí exige en_curso.
 */
async function inventarioParaLeer(actor: ColaboradorAutenticado, inventarioId: number) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true, tamanoHoja: true },
  });
  if (!inventario) throw new NoEncontrado('Ese inventario no existe.');

  /**
   * EL AUDITOR TAMBIEN PASA, y hasta ahora no pasaba. Esta condicion decia
   * solo `actor.rol !== 'administrador'`, asi que un auditor -- que por
   * decision del cliente NO pertenece a ninguna tienda y tiene `sucursalId`
   * en null (ver ROLES_DE_TIENDA en sesion.service.ts) -- se comia un 403 en
   * CUALQUIER sucursal, incluido el resumen de ronda que
   * `inventarios.routes.ts#puedeLeerResumen` le abre explicitamente.
   *
   * Era inconsistente con `auditoria.permisos.ts#validarSucursal`, que desde
   * la correccion del cliente (2026-09-09) lo deja ver toda la cadena. Se
   * arregla ahora porque el tramo nuevo del Auditor lo vuelve bloqueante:
   * para decidir si abre otra pasada mira justamente este embudo.
   */
  if (actor.rol !== 'administrador' && actor.rol !== 'auditor' && actor.sucursalId !== inventario.sucursalId) {
    throw new Prohibido('Ese inventario es de otra sucursal.');
  }
  return inventario;
}

/** El inventario para ESCRIBIR (cerrar la ronda): además tiene que estar en curso. */
async function inventarioDelActor(actor: ColaboradorAutenticado, inventarioId: number) {
  const inventario = await inventarioParaLeer(actor, inventarioId);
  if (inventario.estado !== 'en_curso') {
    // Sin el enum crudo: `conteo_cerrado` es un valor de Postgres. Lo que la
    // persona necesita saber es que el ciclo ya se cerro y donde entra lo que
    // falte.
    throw new Conflicto(
      'El conteo de este inventario ya está cerrado: no se pueden abrir más rondas. ' +
        'Si falta recontar algo, entra en el inventario del mes que viene.',
    );
  }
  return inventario;
}

/**
 * Lo contado en CADA ronda hasta `hasta`, por CÓDIGO de item.
 *
 * Devuelve el histórico completo y no solo la última ronda porque la regla
 * del cliente es EL ÚLTIMO CONTEO MANDA, y "el último" puede ser el de una
 * ronda anterior: si un ítem entró a la ronda 2 y la hoja se finalizó sin
 * contarlo, manda el de la ronda 1 (ver `dominio/ciclo-conteos.ts`).
 *
 * Se agrupa por código y no por `productoId` porque cada ronda materializa
 * sus propios `Producto`: el mismo artículo es una fila distinta en cada
 * pasada, y el ItemNumber de Dynamics es lo único que los une.
 *
 * El total sale de `totalUnidades` (empaques × factor + sueltas), la misma
 * función que usa el módulo de hojas. No se recalcula acá: ese número es el
 * que se audita contra el ERP y no puede tener dos versiones.
 */
async function contadoHastaLaRonda(inventarioId: number, hasta: number): Promise<Map<string, Array<number | null>>> {
  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: { lte: hasta } },
    select: {
      numeroConteo: true,
      productos: {
        select: {
          codigo: true,
          empaques: { select: { nombre: true, factor: true } },
          conteos: { select: { sueltas: true, empaques: { select: { empaqueNombre: true, cantidad: true } } } },
        },
      },
    },
  });

  const porCodigo = new Map<string, Array<number | null>>();
  for (const hoja of hojas) {
    for (const producto of hoja.productos) {
      const fila = porCodigo.get(producto.codigo) ?? new Array<number | null>(hasta).fill(null);
      const conteo = producto.conteos[0];
      if (conteo !== undefined) {
        // Indice 0 = ronda 1.
        fila[hoja.numeroConteo - 1] = totalUnidades(
          { empaques: conteo.empaques, sueltas: conteo.sueltas },
          producto.empaques,
        );
      }
      porCodigo.set(producto.codigo, fila);
    }
  }
  return porCodigo;
}

/**
 * El universo de la ronda: qué ítems entraron y qué se contó de cada uno.
 *
 * La ronda 1 tiene el catálogo entero; las siguientes, solo lo que arrastró
 * la anterior. Por eso el universo sale de los `Producto` de las hojas DE ESA
 * RONDA y no del catálogo -- si saliera del catálogo, la ronda 2 volvería a
 * evaluar los 1.236 ítems y el embudo no serviría de nada.
 */
async function universoDeLaRonda(inventarioId: number, ronda: number): Promise<ItemDeRonda[]> {
  const [productos, catalogo, contado] = await Promise.all([
    prisma.producto.findMany({
      where: { hoja: { inventarioId, numeroConteo: ronda } },
      select: { codigo: true, descripcion: true, categoria: true },
      orderBy: { id: 'asc' },
    }),
    prisma.catalogoItem.findMany({
      where: { inventarioId },
      select: { codigo: true, stockErp: true },
    }),
    contadoHastaLaRonda(inventarioId, ronda),
  ]);

  const stockPorCodigo = new Map(catalogo.map((c) => [c.codigo, c.stockErp] as const));
  const vacio = new Array<number | null>(ronda).fill(null);

  return productos.map((p) => ({
    codigo: p.codigo,
    stockErp: stockPorCodigo.get(p.codigo) ?? null,
    conteos: contado.get(p.codigo) ?? vacio,
  }));
}

/** Las hojas de una ronda que todavía no están finalizadas. */
async function hojasSinFinalizar(inventarioId: number, ronda: number) {
  return prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: ronda, estado: { not: 'finalizada' } },
    select: { id: true, numero: true, estado: true, asignadoAId: true, zona: true },
    orderBy: { numero: 'asc' },
  });
}

/** Una hoja pendiente por sincronizar, con lo justo para nombrarla en el error. */
interface HojaSinSincronizar {
  numero: string;
  asignados: string[];
}

/** Cuántas hojas se nombran en el mensaje antes de resumir el resto. */
const HOJAS_A_LISTAR = 8;

/**
 * Hojas de la ronda YA finalizadas pero cuyo conteo todavía no llegó al
 * servidor (`sync !== 'sincronizado'`). Si se llega hasta acá,
 * `hojasSinFinalizar` ya dio vacío -- así que estas son hojas que alguien
 * SÍ terminó de contar, pero el teléfono no subió todavía (sin señal, o
 * esperando el próximo intento del sincronizador).
 *
 * Se traen los nombres de los asignados por la misma razón que
 * `historial.permisos.ts#mensajeHojasSinFinalizar`: el mensaje tiene que
 * decir A QUIÉN hay que pedirle que conecte su teléfono a la WiFi, no solo
 * qué número de hoja falta.
 */
async function hojasSinSincronizar(inventarioId: number, ronda: number): Promise<HojaSinSincronizar[]> {
  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: ronda, sync: { not: 'sincronizado' } },
    select: {
      numero: true,
      asignadoA: { select: { nombre: true } },
      asignadoA2: { select: { nombre: true } },
    },
    orderBy: { numero: 'asc' },
  });

  return hojas.map((h) => ({
    numero: h.numero,
    asignados: [h.asignadoA?.nombre, h.asignadoA2?.nombre].filter((n): n is string => Boolean(n)),
  }));
}

/**
 * El mensaje del rechazo por sincronización — DISTINTO del de hojas sin
 * finalizar a propósito, porque la acción que le toca a quien lo lee es
 * distinta: una hoja sin finalizar dice "andá a la góndola, alguien
 * todavía está contando"; esta dice "el conteo YA se hizo, andá a conectar
 * ese teléfono a la WiFi para que suba".
 *
 * Cerrar el conteo mirando solo lo que hay en la base, con una hoja
 * finalizada en el teléfono pero sin sincronizar, congelaría un número al
 * que le faltan ítems reales — y ese faltante se liquida igual, contra el
 * sueldo de alguien que sí hizo el trabajo. Mismo riesgo que ya cubre
 * `historial.permisos.ts#validarPuedeLacrar` con `todoSincronizado`, y por
 * la misma razón.
 */
function mensajeHojasSinSincronizar(hojas: HojaSinSincronizar[]): string {
  const cuantas = hojas.length;
  const detalle = hojas
    .slice(0, HOJAS_A_LISTAR)
    .map((h) => `#${h.numero} (${h.asignados.length > 0 ? h.asignados.join(' y ') : 'sin asignar'})`)
    .join(', ');
  const resto = cuantas > HOJAS_A_LISTAR ? ` y ${cuantas - HOJAS_A_LISTAR} más` : '';
  const plural = cuantas === 1;

  return (
    `No se puede cerrar el conteo: ${cuantas} ${plural ? 'hoja está' : 'hojas están'} finalizada${plural ? '' : 's'} pero ` +
    `${plural ? 'su conteo no llegó' : 'sus conteos no llegaron'} al servidor todavía. Alguien contó sin señal y ese ` +
    `trabajo sigue en la cola del teléfono, esperando la WiFi — cerrar ahora congelaría un número al que le faltan ` +
    `ítems reales, y ese faltante se liquida igual. Conecta a la red y espera a que sincronice: ${detalle}${resto}.`
  );
}

export interface ResumenRondaDto extends ResumenDeRonda {
  inventarioId: number;
  ronda: number;
  /** Hojas de la ronda que faltan finalizar: bloquean el cierre. */
  hojasSinFinalizar: Array<{ id: number; numero: string; estado: string; zona: string; asignada: boolean }>;
  /** true = la ronda se puede cerrar ahora mismo. */
  sePuedeCerrar: boolean;
  /** Qué pasaría al cerrar: se abre otra ronda, o el ciclo termina. */
  siguienteRonda: number | null;
  motivoSinSiguiente: string | null;
}

/**
 * PREVIEW: qué pasaría si se cerrara esta ronda. NO muta nada.
 *
 * Existe porque cerrar una ronda es una decisión, no un trámite. Si de 1.236
 * ítems quedan 12 por recontar, la ronda 2 es media hora; si quedan 900, algo
 * se contó mal y hay que mirar eso ANTES de mandar a once personas a
 * recontar. El Coordinador tiene que poder ver el número antes de apretar.
 */
export async function resumen(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  ronda: number,
): Promise<ResumenRondaDto> {
  // `inventarioParaLeer`, NO `inventarioDelActor`: el resumen es de solo
  // lectura y se muestra también para un inventario ya cerrado (el embudo del
  // ciclo terminado que ven Coordinador y Auditor en la pantalla de Ciclo).
  await inventarioParaLeer(actor, inventarioId);

  const hojas = await prisma.hojaConteo.count({ where: { inventarioId, numeroConteo: ronda } });
  if (hojas === 0) {
    throw new NoEncontrado(
      `El inventario todavía no tiene hojas de la ronda ${ronda}. ` +
        'Crea las hojas y repártelas (paso 2 del wizard) antes de cerrar la ronda.',
    );
  }

  const universo = await universoDeLaRonda(inventarioId, ronda);
  const base = resumirRonda(universo);
  const pendientes = await hojasSinFinalizar(inventarioId, ronda);
  const siguiente = puedeAbrirRondaSiguiente(ronda, base.aRecontar);

  return {
    inventarioId,
    ronda,
    ...base,
    hojasSinFinalizar: pendientes.map((h) => ({
      id: h.id,
      numero: h.numero,
      estado: h.estado,
      zona: h.zona,
      asignada: h.asignadoAId !== null,
    })),
    sePuedeCerrar: pendientes.length === 0,
    siguienteRonda: siguiente.puede ? ronda + 1 : null,
    motivoSinSiguiente: siguiente.motivo,
  };
}

export interface CierreDeRondaDto {
  inventarioId: number;
  rondaCerrada: number;
  resumen: ResumenDeRonda;
  /** La ronda que se abrió, o null si el ciclo no sigue. */
  rondaAbierta: number | null;
  motivoSinSiguiente: string | null;
  /** Hojas nuevas de la ronda siguiente. Vacío si no se abrió ninguna. */
  hojas: HojaDto[];
}

/**
 * Cierra la ronda y abre la siguiente SOLO con lo que no cuadró -- o, si
 * esta era la última del ciclo (o no quedó nada por recontar), cierra EL
 * CONTEO DEL INVENTARIO entero: `Inventario.estado -> 'conteo_cerrado'` Y
 * se calcula y persiste `ResultadoInventario` (reusando `armarMatriz` de
 * auditoria.service.ts). Las tres cosas son la misma operación: el dominio
 * (`ciclo-conteos.ts#puedeAbrirRondaSiguiente`) decide en el mismo cálculo
 * si el ciclo sigue o termina, así que no hay un endpoint aparte para
 * "cerrar el conteo" que alguien tenga que acordarse de apretar después.
 *
 * `ResultadoInventario` se calcula ACÁ y no al lacrar ni a pedido: es la
 * verdad que hay que congelar en el instante del cierre, no recalcularla
 * después con datos que ya cambiaron. `montoNegativos` se persiste en NULL a
 * propósito -- ver el comentario largo en schema.prisma#ResultadoInventario y
 * en el bloque de abajo: hoy no existe ningún mecanismo para capturarlo. La
 * asistencia SÍ se congela (`colaboradoresAsistieron` y `diasDelInventario`):
 * la registró el Coordinador durante el conteo y acá queda firme.
 *
 * REQUISITOS PARA CERRAR, EN ORDEN (el orden importa: primero lo que hay
 * que ir a resolver a mano, después lo que se resuelve solo):
 *   1. Todas las hojas de la ronda finalizadas. Una hoja sin finalizar es
 *      una hoja que alguien todavía está contando -- cerrar ahí congelaría
 *      un conteo a medias y lo compararía contra el ERP como si fuera
 *      definitivo.
 *   2. Todas esas hojas SINCRONIZADAS. Finalizada no es lo mismo que
 *      sincronizada: alguien puede haber contado sin señal y finalizado la
 *      hoja en el teléfono, con el conteo todavía en la cola esperando la
 *      WiFi. Cerrar mirando solo lo que hay en la base congelaría un
 *      número al que le faltan ítems reales, y ese faltante se liquida
 *      igual -- mismo riesgo que ya cubre
 *      `historial.permisos.ts#validarPuedeLacrar` con `todoSincronizado`,
 *      y por la misma razón.
 *
 * Sobre los renglones sin contar de una hoja finalizada (DECISIÓN DEL
 * CLIENTE, 2026-09-05): `hojas.service.ts#finalizar` ya NO los deja "sin
 * contar" -- registra un Conteo en 0 EXPLÍCITO por cada uno ("si no hay el
 * producto, es 0"). Este cierre no hace nada especial con ellos: los trata
 * como cualquier conteo real (0 vs stock > 0 = diferencia → recontar; 0 vs
 * stock 0 = cuadra; ver `dominio/ciclo-conteos.ts#destinoTrasRonda`). Antes
 * de esa decisión llegaban como `null` y el cierre los mandaba a recontar por
 * ausencia de dato; ahora llegan como el 0 que afirmó quien finalizó la hoja,
 * y el destino lo decide el número contra el ERP, no la falta de conteo.
 *
 * Todo va en transacción: si la creación de las hojas nuevas fallara a
 * mitad, quedaría una ronda 2 incompleta que nadie sabría interpretar; si
 * el cierre del conteo fallara a mitad, quedaría un inventario con la
 * ronda ya resuelta pero el estado todavía `en_curso` -- exactamente el
 * hueco que este cambio existe para cerrar.
 */
export async function cerrar(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  ronda: number,
): Promise<CierreDeRondaDto> {
  const inventario = await inventarioDelActor(actor, inventarioId);

  const hojasDeLaRonda = await prisma.hojaConteo.count({ where: { inventarioId, numeroConteo: ronda } });
  if (hojasDeLaRonda === 0) {
    throw new NoEncontrado(
      `El inventario todavía no tiene hojas de la ronda ${ronda}. ` +
        'Crea las hojas y repártelas (paso 2 del wizard) antes de cerrar la ronda.',
    );
  }

  // Ya cerrada: si existe la ronda siguiente, esta operación ya se hizo.
  const siguienteYaExiste = await prisma.hojaConteo.count({
    where: { inventarioId, numeroConteo: ronda + 1 },
  });
  if (siguienteYaExiste > 0) {
    throw new Conflicto(
      `La ronda ${ronda} ya se cerró: la ronda ${ronda + 1} tiene ${siguienteYaExiste} hoja(s). Cerrar de nuevo duplicaría el reconteo.`,
    );
  }

  const pendientes = await hojasSinFinalizar(inventarioId, ronda);
  if (pendientes.length > 0) {
    const cuales = pendientes.slice(0, 5).map((h) => `${h.numero} (${h.estado})`).join(', ');
    const resto = pendientes.length > 5 ? ` y ${pendientes.length - 5} más` : '';
    throw new Conflicto(
      `No se puede cerrar la ronda ${ronda}: quedan ${pendientes.length} hoja(s) sin finalizar — ${cuales}${resto}. ` +
        'Una hoja sin finalizar es una hoja que alguien todavía está contando.',
    );
  }

  // DESPUÉS de "sin finalizar" y no antes: es el que más probablemente se
  // resuelva solo con la WiFi de la tienda, así que primero se le dice a
  // la persona lo que SÍ tiene que ir a resolver a mano (mismo orden que
  // `historial.permisos.ts#validarPuedeLacrar`). Todas las hojas de la
  // ronda ya están finalizadas en este punto -- lo que falta es que el
  // servidor las tenga.
  const sinSincronizar = await hojasSinSincronizar(inventarioId, ronda);
  if (sinSincronizar.length > 0) {
    throw new Conflicto(mensajeHojasSinSincronizar(sinSincronizar));
  }

  const universo = await universoDeLaRonda(inventarioId, ronda);
  const resumenRonda = resumirRonda(universo);
  const aRecontar = itemsParaLaRondaSiguiente(universo);
  const siguiente = puedeAbrirRondaSiguiente(ronda, aRecontar.length);

  if (!siguiente.puede) {
    /**
     * HASTA ACA LLEGA EL TRAMO AUTOMATICO -- Y EL CONTEO **NO** SE CIERRA.
     *
     * ESTE BLOQUE CERRABA EL INVENTARIO. Pasaba `estado -> 'conteo_cerrado'`,
     * escribia `ResultadoInventario` y liberaba `abierto` en la misma
     * transaccion que cerraba la ronda. Dejo de hacerlo por pedido del
     * cliente: ahora, cerrada la ultima ronda, el inventario QUEDA
     * `en_curso` esperando al Auditor, que decide si abre otra pasada o
     * arranca su ajuste final. Todo lo que este bloque hacia se mudo, intacto,
     * a `cerrarAjuste()`.
     *
     * LAS DOS COSAS QUE ESTA ESPERA HABILITA, y que antes no existian:
     *
     *  1. El Auditor puede abrir un 4to o 5to conteo. Con el cierre
     *     automatico, la ronda 3 cerraba el inventario y no habia donde
     *     meter una pasada mas.
     *  2. El Coordinador sigue pudiendo corregir lo que cargaron los
     *     contadores CON LA RONDA YA CERRADA. Esa ventana es la razon por la
     *     que el ajuste arranca con un boton y no solo: si empezara al cerrar
     *     la ultima ronda, duraria cero (ver `ajuste.permisos.ts`).
     *
     * `abierto` TAMPOCO se libera aca, y es a proposito aunque retrase lo que
     * arreglo el bug de 2026-09-10: mientras el Auditor no cierre, este sigue
     * siendo el inventario abierto de la sucursal y `@@unique([sucursalId,
     * abierto])` tiene que seguir impidiendo que alguien abra el del mes que
     * viene encima. Liberarlo antes de tiempo permitiria dos inventarios
     * vivos en la misma tienda -- que es el problema que ese indice existe
     * para que no pase. La espera que el bug ataca (los dias que tarda la
     * firma del auditor) sigue cubierta: `cerrarAjuste` libera `abierto` en
     * el mismo momento en que pasa a `conteo_cerrado`, mucho antes del
     * lacrado.
     */
    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'inventario.ronda_cerrada',
      entidad: 'inventario',
      entidadId: inventarioId,
      detalle: { ronda, ...resumenRonda, rondaAbierta: null, motivo: siguiente.motivo },
    });

    // `rondaAbierta: null` ya no es ambiguo: con el cierre del conteo mudado
    // a `cerrarAjuste`, la UNICA cosa que significa es "le toca al Auditor".
    // El texto de `motivoSinSiguiente` lo dice con todas las letras -- sale
    // de `ciclo-conteos.ts`, que es donde vive esa decision.
    return {
      inventarioId,
      rondaCerrada: ronda,
      resumen: resumenRonda,
      rondaAbierta: null,
      motivoSinSiguiente: siguiente.motivo,
      hojas: [],
    };
  }

  const rondaNueva = ronda + 1;
  const hojas = await materializarRonda(inventarioId, inventario.tamanoHoja, rondaNueva, aRecontar);

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.ronda_cerrada',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { ronda, ...resumenRonda, rondaAbierta: rondaNueva, hojasNuevas: hojas.length },
  });

  return {
    inventarioId,
    rondaCerrada: ronda,
    resumen: resumenRonda,
    rondaAbierta: rondaNueva,
    motivoSinSiguiente: null,
    hojas,
  };
}

/**
 * CREA LAS HOJAS DE UNA RONDA con los items que vuelven a contarse.
 *
 * Extraido de `cerrar()` porque ahora hay DOS caminos que abren una ronda: el
 * cierre normal del ciclo y el boton del Auditor (`abrirRondaExtra`). Si cada
 * uno armara las hojas por su cuenta, el dia que una cambie -- el orden de
 * los productos, que empaques se copian, que la hoja nazca sin asignar -- la
 * ronda 4 saldria distinta de la 2 sin que nadie lo note. Son la misma
 * operacion y tienen que seguir siendolo.
 *
 * Los datos completos de los items (descripcion, empaques, categoria) salen
 * del CATALOGO, no de los `Producto` de la ronda anterior: el catalogo es la
 * fuente, y asi la hoja nueva nace igual de limpia que una de la ronda 1.
 */
async function materializarRonda(
  inventarioId: number,
  tamano: number,
  rondaNueva: number,
  aRecontar: readonly ItemDeRonda[],
): Promise<HojaDto[]> {
  const codigos = new Set(aRecontar.map((i) => i.codigo));
  const items = await prisma.catalogoItem.findMany({
    where: { inventarioId, codigo: { in: [...codigos] } },
    include: { empaques: { orderBy: { orden: 'asc' } } },
  });
  if (items.length === 0) {
    throw new SolicitudInvalida(
      `Ninguno de los ${aRecontar.length} ítems a recontar existe en el catálogo del inventario ${inventarioId}.`,
    );
  }

  const ordenados = ordenarParaContar(items);
  const tamanos = partirEnHojas(ordenados.length, tamano);

  await prisma.$transaction(async (tx) => {
    let cursor = 0;
    for (const [indice, cantidad] of tamanos.entries()) {
      const bloque = ordenados.slice(cursor, cursor + cantidad);
      cursor += cantidad;

      await tx.hojaConteo.create({
        data: {
          inventarioId,
          numeroConteo: rondaNueva,
          numero: numeroDeHoja(indice),
          zona: zonaDeHoja(bloque),
          gondola: numeroDeHoja(indice),
          tamano,
          // SIN asignar: el Coordinador reparte la ronda nueva con
          // POST /hojas/asignar, igual que la primera. Quién recuenta es una
          // decisión suya -- puede querer que lo mire otra persona.
          productos: {
            create: bloque.map((item) => ({
              codigo: item.codigo,
              codigoBarras: item.codigoBarras,
              descripcion: item.descripcion,
              categoria: item.categoria,
              // NI stockErp NI precioVenta, igual que en la ronda 1: es el
              // conteo ciego. Y sin `conteos`: la hoja nace vacía, así que
              // el contador no puede ver lo que cargó en la ronda anterior.
              empaques: {
                create: item.empaques.map((e) => ({
                  nombre: e.nombre,
                  factor: e.factor,
                  orden: e.orden,
                  ...(e.codigoBarras !== null ? { codigoBarras: e.codigoBarras } : {}),
                })),
              },
            })),
          },
        },
      });
    }
  });

  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: rondaNueva },
    include: INCLUIR_TODO,
    orderBy: { numero: 'asc' },
  });
  return hojas.map(aHojaDto);
}


// ---------------------------------------------------------------------------
// EL TRAMO DEL AUDITOR: rondas extra y ajuste final
//
// Los tres botones que el cliente pidio, y que solo existen porque cerrar la
// ultima ronda ya NO cierra el conteo (ver el bloque `!siguiente.puede` de
// `cerrar`). La ventana de cada uno -- quien y en que estado -- vive en
// `ajuste.permisos.ts`, puro y testeado sin base; aca esta lo que hace falta
// preguntarle a la base.
// ---------------------------------------------------------------------------

/** El inventario, sin chequear sucursal: eso lo decide `ajuste.permisos.ts`. */
async function inventarioDe(inventarioId: number) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    // `umbralMediaUnidadPaquete` va CONGELADO en el inventario y lo exige
    // `auditoria.calculos.ts#resumir` al cerrar el ajuste: de ese numero
    // depende cuanta plata sale del descuento al personal, asi que se lee del
    // inventario y nunca de la config de hoy.
    select: { id: true, sucursalId: true, estado: true, tamanoHoja: true, umbralMediaUnidadPaquete: true },
  });
  if (!inventario) throw new NoEncontrado('Ese inventario no existe.');
  return { ...inventario, estado: inventario.estado as EstadoConAjuste };
}

/**
 * La ronda mas alta con hojas: la que se esta contando, o la ultima que se
 * conto. 0 = todavia no hay ninguna hoja.
 */
async function ultimaRondaDe(inventarioId: number): Promise<number> {
  const { _max } = await prisma.hojaConteo.aggregate({
    where: { inventarioId },
    _max: { numeroConteo: true },
  });
  return _max.numeroConteo ?? 0;
}

/**
 * QUE LA ULTIMA RONDA ESTE TERMINADA. Las dos guardas de `cerrar()`, en el
 * mismo orden y por las mismas razones: primero lo que hay que ir a resolver
 * a mano (hojas sin finalizar), despues lo que se resuelve solo con la WiFi.
 *
 * Se reusan y no se copian porque son la misma pregunta: abrir otra pasada o
 * arrancar el ajuste sobre una ronda a medio contar congela un conteo
 * incompleto, igual que cerrarla.
 */
async function exigirUltimaRondaTerminada(inventarioId: number, ronda: number): Promise<void> {
  const pendientes = await hojasSinFinalizar(inventarioId, ronda);
  if (pendientes.length > 0) {
    const cuales = pendientes.slice(0, 5).map((h) => `${h.numero} (${h.estado})`).join(', ');
    const resto = pendientes.length > 5 ? ` y ${pendientes.length - 5} más` : '';
    throw new Conflicto(
      `La ronda ${ronda} todavía tiene ${pendientes.length} hoja(s) sin finalizar — ${cuales}${resto}. ` +
        'Una hoja sin finalizar es una hoja que alguien todavía está contando.',
    );
  }

  const sinSincronizar = await hojasSinSincronizar(inventarioId, ronda);
  if (sinSincronizar.length > 0) {
    throw new Conflicto(mensajeHojasSinSincronizar(sinSincronizar));
  }
}

export interface RondaExtraDto {
  inventarioId: number;
  /** La ronda que se abrió. */
  ronda: number;
  /** Ítems que vuelven a contarse en ella. */
  items: number;
  hojas: HojaDto[];
}

/**
 * EL AUDITOR ABRE OTRA PASADA: `POST /api/inventarios/:id/rondas/abrir`.
 *
 * Pedido del cliente: mas conteos de los 3 definidos, "un 4to, un 5to",
 * decididos inventario por inventario y no fijados por adelantado. Por eso no
 * hay un numero de ronda en el cuerpo: se abre LA SIGUIENTE a la ultima que
 * existe, y cuantas haya es consecuencia de cuantas veces se apreto esto.
 *
 * NO MIRA `RONDAS_DEL_CICLO`. Ese limite es el del tramo automatico -- el que
 * corta a `cerrar()` -- y este boton existe justamente para pasarlo
 * (`ciclo-conteos.ts#puedeAuditorAbrirOtraRonda`). Lo unico que lo frena es
 * que no quede nada por recontar: abrir una ronda sin items seria mandar a
 * once personas a contar una hoja vacia.
 */
export async function abrirRondaExtra(actor: ColaboradorAutenticado, inventarioId: number): Promise<RondaExtraDto> {
  const inventario = await inventarioDe(inventarioId);
  validarAbrirRondaExtra(actor, inventario);

  const ronda = await ultimaRondaDe(inventarioId);
  if (ronda === 0) {
    throw new NoEncontrado(
      'Este inventario todavía no tiene hojas: no hay ninguna ronda que continuar. ' +
        'El Coordinador tiene que crear las hojas primero (paso 2 del wizard).',
    );
  }
  await exigirUltimaRondaTerminada(inventarioId, ronda);

  const universo = await universoDeLaRonda(inventarioId, ronda);
  const aRecontar = itemsParaLaRondaSiguiente(universo);
  const puede = puedeAuditorAbrirOtraRonda(aRecontar.length);
  if (!puede.puede) {
    // El motivo sale del dominio: "todo cuadró" es el caso feliz y el mensaje
    // tiene que decir eso, no un "no se puede" a secas.
    throw new Conflicto(puede.motivo ?? 'No hay ítems para recontar.');
  }

  const rondaNueva = ronda + 1;
  const hojas = await materializarRonda(inventarioId, inventario.tamanoHoja, rondaNueva, aRecontar);

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.ronda_extra_abierta',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { ronda: rondaNueva, items: aRecontar.length, hojasNuevas: hojas.length },
  });

  return { inventarioId, ronda: rondaNueva, items: aRecontar.length, hojas };
}

export interface AjusteDto {
  inventarioId: number;
  estado: EstadoConAjuste;
  /** La ronda sobre la que escribe el ajuste: la última que se contó. */
  ronda: number;
}

/**
 * ARRANCA EL AJUSTE FINAL: `POST /api/inventarios/:id/ajuste/iniciar`.
 * `en_curso` pasa a `ajuste_auditor`.
 *
 * ES UN BOTON Y NO UN AUTOMATISMO, y esa es una decision del cliente con una
 * consecuencia concreta: entre que se cierra la ultima ronda y que el Auditor
 * aprieta esto, el Coordinador todavia puede corregir lo que cargaron los
 * contadores. Si el ajuste arrancara solo al cerrar la ronda, esa ventana no
 * existiria. Ver `ajuste.permisos.ts#validarCorreccion`.
 *
 * A partir de aca el Coordinador queda bloqueado: los dos escriben la misma
 * fila de `Conteo`, y una correccion durante el ajuste pisaria en silencio un
 * valor que el Auditor puso mirando el stock.
 */
export async function iniciarAjuste(actor: ColaboradorAutenticado, inventarioId: number): Promise<AjusteDto> {
  const inventario = await inventarioDe(inventarioId);
  validarIniciarAjuste(actor, inventario);

  const ronda = await ultimaRondaDe(inventarioId);
  if (ronda === 0) {
    throw new NoEncontrado('Este inventario todavía no tiene hojas: no hay nada que ajustar.');
  }
  // La misma exigencia que para abrir otra ronda: ajustar sobre una ronda a
  // medio contar seria decidir valores finales contra un conteo incompleto.
  await exigirUltimaRondaTerminada(inventarioId, ronda);

  await prisma.inventario.update({ where: { id: inventarioId }, data: { estado: 'ajuste_auditor' } });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.ajuste_iniciado',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { ronda },
  });

  return { inventarioId, estado: 'ajuste_auditor', ronda };
}

export interface CierreDelConteoDto {
  inventarioId: number;
  estado: EstadoConAjuste;
  /** Lo que quedó congelado en `ResultadoInventario`. */
  itemsTotales: number;
  itemsConDiferencia: number;
  unidadesFaltantes: number;
  unidadesSobrantes: number;
  montoFaltanteBruto: number;
  colaboradoresAlcanzados: number;
  diasDelInventario: number;
}

/**
 * CIERRA EL AJUSTE Y CON EL, EL CONTEO: `POST /api/inventarios/:id/ajuste/cerrar`.
 * `ajuste_auditor` pasa a `conteo_cerrado`, y de ahi sigue liquidacion.
 *
 * ESTE BLOQUE VIVIA DENTRO DE `cerrar()`, en la rama `!siguiente.puede`. Se
 * mudo entero -- misma transaccion, mismos calculos, mismo orden -- porque lo
 * que cambio no es QUE se hace al cerrar el conteo sino CUANDO: antes lo
 * disparaba cerrar la ultima ronda, ahora lo dispara el Auditor cuando
 * termina su ajuste. Todo lo que se decia de por que cada numero se congela
 * aca sigue valiendo palabra por palabra.
 *
 * `ResultadoInventario` se calcula ACA y no al lacrar ni a pedido: es la
 * verdad que hay que congelar en el instante del cierre, no recalcularla
 * despues con datos que ya cambiaron.
 */
export async function cerrarAjuste(actor: ColaboradorAutenticado, inventarioId: number): Promise<CierreDelConteoDto> {
  const inventario = await inventarioDe(inventarioId);
  validarAjusteEnCurso(actor, inventario, 'cerrar el ajuste final');

  // La matriz y el conteo de colaboradores son solo LECTURAS -- se arman
  // antes de la transaccion, no comparten atomicidad con la escritura.
  //
  // Reusa `armarMatriz` (auditoria.service.ts) en vez de recalcular: es el
  // mismo cruce catalogo x rondas que ya usa la pantalla del Auditor, y
  // `embudoDeConteos`/`resumir` (auditoria.calculos.ts) ya dan casi todos los
  // campos de `ResultadoInventario`. Y ahora incluye el ajuste que el Auditor
  // acaba de hacer: escribe sobre los `Conteo` de la ultima ronda, que es de
  // donde la matriz los lee.
  const matrizCompleta = await armarMatriz(inventarioId);
  const embudo = embudoDeConteos(matrizCompleta);
  // El umbral sale del INVENTARIO, congelado al abrirlo: recalcular el cierre
  // con la config de hoy cambiaria el descuento de un mes ya trabajado.
  const resumenAuditoria = resumirAuditoria(matrizCompleta, inventario.umbralMediaUnidadPaquete.toNumber());

  /**
   * LA ASISTENCIA, CONGELADA. La registra el Coordinador dia por dia en
   * `asistencia_inventario` (el porque esta en la cabecera de
   * `dominio/asistencia.ts`). Se congelan DOS numeros:
   *
   *   - `colaboradoresAsistieron`: cuantos cumplieron la asistencia COMPLETA
   *     -- los que no pagan multa y cobran bono. No es "cuantos vinieron
   *     alguna vez"; ver `FilaPlanilla.asistio` en liquidacion.cierre.ts.
   *
   *   - `diasDelInventario`: EL DENOMINADOR DE TODAS LAS MULTAS. Sin
   *     congelarlo, una marca cargada -- o borrada -- en noviembre cambiaria
   *     cuanto se le descontó a alguien en agosto, de un sueldo ya pagado.
   *
   * OJO CON EL MOMENTO, QUE SE CORRIO: antes esto pasaba al cerrar la ultima
   * ronda; ahora pasa al cerrar el ajuste, que puede ser dias despues. La
   * asistencia queda firme mas tarde, y eso es correcto -- el inventario
   * sigue en curso mientras el Auditor trabaja, asi que quien fue a la tienda
   * esos dias tiene que poder quedar marcado.
   */
  const marcas = (
    await prisma.asistenciaInventario.findMany({ where: { inventarioId }, select: SELECT_ASISTENCIA })
  ).map(aMarcaAsistencia);
  /**
   * LAS JUSTIFICACIONES TAMBIEN, aunque no muevan `diasDelInventario`.
   *
   * Los DIAS del inventario salen solo de las marcas: un dia que nadie
   * trabajo no se convierte en jornada porque a alguien le perdonen la falta.
   * Pero `colaboradoresAsistieron` cuenta A QUIENES COBRAN BONO, y ahi un dia
   * perdonado vale como asistido (decision del cliente, ver
   * `dominio/asistencia.ts`). Sin esta lectura, este numero congelado saldria
   * distinto del que arma la planilla y el sello firmaria dos cifras que se
   * contradicen.
   *
   * Puede seguir cambiando despues de aca: la ventana para justificar se
   * cierra AL LIQUIDAR, no al cerrar el conteo, asi que `liquidar()` vuelve a
   * escribir este mismo numero con el valor final. Ver liquidacion.cierre.ts.
   */
  const justificaciones = (
    await prisma.justificacionAsistencia.findMany({ where: { inventarioId }, select: SELECT_JUSTIFICACIONES })
  ).map(aJustificacionAsistencia);
  const dias = diasDelInventario(marcas);
  const asistieron = quienesCobranBono({ marcas, justificaciones, diasInventario: dias });

  // El DETALLE item por item de esos mismos agregados. Sale de la misma
  // matriz y entra en la misma transaccion a proposito: si el total y su
  // detalle se escribieran en dos momentos distintos podrian discrepar, y el
  // sello del lacrado los hashea JUNTOS (historial.lacrado.ts) -- una
  // discrepancia ahi no se detecta, se firma.
  const diferencias = diferenciasParaPersistir(matrizCompleta);

  // TODO el personal habilitado de la sucursal, no solo quien conto. `rol: {
  // in: ROLES_DE_TIENDA }` -- el auditor y el administrador NO pertenecen a
  // ninguna tienda. Mismo filtro que `liquidacion.cierre.ts#proyectarPlanilla`:
  // si estos dos no coinciden, la cuota por persona deja de cerrar contra el
  // faltante neto.
  const colaboradoresAlcanzados = await prisma.colaborador.count({
    where: { sucursalId: inventario.sucursalId, activo: true, rol: { in: ROLES_DE_TIENDA } },
  });

  await prisma.$transaction([
    prisma.inventario.update({
      where: { id: inventarioId },
      data: {
        estado: 'conteo_cerrado',
        // Libera la sucursal para el inventario del mes que viene EN ESTE
        // MOMENTO, no recien al lacrar -- bug real (2026-09-10): la firma del
        // auditor puede tardar dias, y hasta ese fix la sucursal quedaba
        // bloqueada todo ese tiempo. NULL, no false -- ver el comentario de
        // Inventario.abierto en el schema.
        //
        // Sigue saliendo del cierre del CONTEO, que es lo que el bug pedia;
        // lo que se corrio es cual operacion cierra el conteo. Mientras el
        // Auditor ajusta, el inventario TIENE que seguir ocupando la sucursal:
        // liberarlo antes dejaria abrir el del mes siguiente encima de uno que
        // todavia se esta decidiendo.
        abierto: null,
      },
    }),
    prisma.resultadoInventario.create({
      data: {
        inventarioId,
        itemsTotales: embudo.itemsTotales,
        itemsConDiferencia: embudo.itemsConDiferencia,
        itemsSegundoConteo: embudo.itemsSegundoConteo,
        itemsTercerConteo: embudo.itemsTercerConteo,
        unidadesFaltantes: resumenAuditoria.unidadesFaltantes,
        unidadesSobrantes: resumenAuditoria.unidadesSobrantes,
        montoFaltanteBruto: resumenAuditoria.valorFaltante,
        // El faltante que SI se descuenta a nomina (valorFaltanteDescontable)
        // resta de aca -- lo que queda es lo que absorbe la empresa.
        montoFaltanteEmpresa: redondear(resumenAuditoria.valorFaltante - resumenAuditoria.valorFaltanteDescontable),
        colaboradoresAlcanzados,
        // `montoNegativos` SIGUE EN NULL: los ajustes del mes no existen en
        // ningun lado (no hay endpoint, ni pantalla, ni tabla donde
        // cargarlos). Un 0 aca no significaria "no hubo ajustes" sino "no hay
        // donde ponerlos", y la cuenta es `neto = bruto - negativos -
        // empresa`: asumir 0 cuando hubo S/380 de mermas documentadas infla
        // el faltante neto y se lo descuenta de mas a gente que no lo debe.
        montoNegativos: null,
        colaboradoresAsistieron: asistieron.size,
        diasDelInventario: dias,
        // multaInasistencia: se deja el default de la columna (S/20). Desde la
        // asistencia por dia ese numero es la TARIFA POR DIA.
      },
    }),
    prisma.diferenciaItem.createMany({
      data: diferencias.map((d) => ({ inventarioId, ...d })),
      skipDuplicates: true,
    }),
  ]);

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.ajuste_cerrado',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: {
      itemsTotales: embudo.itemsTotales,
      itemsConDiferencia: embudo.itemsConDiferencia,
      itemsPorRonda: embudo.itemsPorRonda,
    },
  });

  return {
    inventarioId,
    estado: 'conteo_cerrado',
    itemsTotales: embudo.itemsTotales,
    itemsConDiferencia: embudo.itemsConDiferencia,
    unidadesFaltantes: resumenAuditoria.unidadesFaltantes,
    unidadesSobrantes: resumenAuditoria.unidadesSobrantes,
    montoFaltanteBruto: resumenAuditoria.valorFaltante,
    colaboradoresAlcanzados,
    diasDelInventario: dias,
  };
}


// ---------------------------------------------------------------------------
// SACAR UN ITEM DE LA RONDA SIGUIENTE cuando la correccion lo hace cuadrar
// ---------------------------------------------------------------------------

/** Lo que paso, para el que corrige y para el log. `null` = no se saco nada. */
export interface SalidaDeLaRonda {
  codigo: string;
  /** La ronda de la que salio. */
  ronda: number;
  hojaId: number;
  /** La hoja quedo sin productos y se borro. */
  hojaBorrada: boolean;
  /** Era la unica hoja: la ronda entera dejo de existir. */
  rondaBorrada: boolean;
}

/**
 * CORREGIR CON LA RONDA CERRADA SACA EL ITEM DE LA RONDA SIGUIENTE, si esa
 * ronda todavia no arranco.
 *
 * ---------------------------------------------------------------------------
 * PARA ESTO PIDIO EL CLIENTE LA CORRECCION
 * ---------------------------------------------------------------------------
 * Textual, reunion 2 (00:12:12): *"yo le he finalizado la hoja y he encontrado
 * una caja mas de aceite. Puedes corregirlo PARA QUE YA NO SALGA EN MI SEGUNDO
 * CONTEO"*. Esa segunda mitad -- que no salga -- es la que faltaba.
 *
 * Se cumplia sola mientras la correccion entrara ANTES de cerrar la ronda:
 * `cerrar()` evalua `itemsParaLaRondaSiguiente` y el item que cuadra no pasa.
 * Pero la ventana que abrimos despues -- corregir con la ronda YA cerrada,
 * que existe porque el ajuste del Auditor arranca con un boton -- cae del otro
 * lado: la ronda siguiente ya esta materializada con sus hojas y sus
 * `Producto`, y corregir escribia la fila `Conteo` y nada mas. El item seguia
 * ahi para que alguien lo recontara al pedo.
 *
 * ---------------------------------------------------------------------------
 * SOLO SI LA RONDA SIGUIENTE NO EMPEZO -- ver `ciclo-conteos.ts#rondaEmpezo`
 * ---------------------------------------------------------------------------
 * No se le cambia la hoja a alguien que ya la tiene en la mano. Y la
 * granularidad es POR RONDA, no por producto: si CUALQUIER hoja de la ronda
 * arranco, no se saca nada de ninguna (decision del usuario).
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO HACE, Y ES UNA PREGUNTA ABIERTA PARA EL CLIENTE
 * ---------------------------------------------------------------------------
 * EL CASO SIMETRICO NO ESTA: si una correccion hace que un item DEJE de
 * cuadrar, no se lo agrega a la ronda siguiente. Existe de verdad -- un item
 * que cuadro al cerrar la ronda N no entro a la N+1; si despues lo corrigen y
 * ahora difiere, nadie lo va a recontar.
 *
 * Se dejo afuera A PROPOSITO y no por olvido: sacar un renglon solo quita
 * trabajo, agregarlo se lo inventa a alguien -- posiblemente en una hoja que
 * ya esta finalizada, que es justo lo que ninguna operacion puede tocar. Ese
 * item llega igual al ajuste final del Auditor con su diferencia, y ese tramo
 * existe exactamente para eso. Si el cliente pide lo contrario, se agrega aca.
 *
 * ---------------------------------------------------------------------------
 * COMO DECIDE QUE "CUADRA"
 * ---------------------------------------------------------------------------
 * Con `ciclo-conteos.ts#cuadro`, la MISMA funcion que usa el cierre de ronda.
 * No se escribe una comparacion nueva: un segundo lugar que decida "cuadra" es
 * un segundo lugar donde puede discrepar, y entonces el item saldria de la
 * ronda aca y volveria a entrar al cerrar -- o al reves.
 *
 * Y se evalua sobre el HISTORICO COMPLETO de conteos, no solo sobre el valor
 * corregido, porque la regla del cliente es EL ULTIMO CONTEO MANDA: corregir la
 * ronda 1 cuando la 2 ya tiene un numero no cambia cual manda. Como esto corre
 * DENTRO de la transaccion y DESPUES del update, lo que lee de la base ya
 * incluye la correccion.
 *
 * Sin `stockErp` nunca saca nada: `cuadro()` devuelve false, que es lo
 * correcto -- no se puede afirmar que un item cuadra contra un numero que el
 * ERP no trajo (ver la cabecera de auditoria.calculos.ts).
 */
export async function sacarDeLaRondaSiguienteSiCuadro(
  tx: Prisma.TransactionClient,
  args: { inventarioId: number; codigo: string; rondaCorregida: number; actorId: number },
): Promise<SalidaDeLaRonda | null> {
  const { inventarioId, codigo, rondaCorregida, actorId } = args;

  /**
   * SOLO LA RONDA MAS ALTA, y solo si es posterior a la corregida.
   *
   * Si se corrige sobre la ronda 1 cuando existen la 2 y la 3, la unica
   * candidata es la 3: para que la 3 exista, la 2 tuvo que cerrarse, y para
   * cerrarse tuvo que contarse -- o sea que la 2 ya empezo y no se toca. Y si
   * la hoja corregida YA es la mas alta, no hay ronda siguiente que limpiar.
   */
  const { _max } = await tx.hojaConteo.aggregate({
    where: { inventarioId },
    _max: { numeroConteo: true },
  });
  const ronda = _max.numeroConteo;
  if (ronda === null || ronda <= rondaCorregida) return null;

  const hojas = await tx.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: ronda },
    select: { id: true, estado: true, _count: { select: { conteos: true } } },
  });
  if (rondaEmpezo(hojas.map((h) => ({ estado: h.estado, conteos: h._count.conteos })))) return null;

  if (!(await itemCuadra(tx, inventarioId, codigo, ronda))) return null;

  /**
   * El `Producto` se busca por CODIGO, no por id: el id es distinto en cada
   * ronda porque cada una materializa sus propias filas, y el codigo
   * (`ItemNumber` de Dynamics) es la identidad estable entre rondas -- lo
   * mismo que hace `armarMatriz` para cruzarlas.
   */
  const producto = await tx.producto.findFirst({
    where: { codigo, hoja: { inventarioId, numeroConteo: ronda } },
    select: { id: true, hojaId: true },
  });
  // Puede no estar: cuadro al cerrar y nunca entro a esta ronda. No es un
  // error -- es el caso normal del item que ya habia salido del ciclo.
  if (producto === null) return null;

  /**
   * ORDEN DE BORRADO, que lo imponen las FK reales de la base (verificadas):
   *
   *   empaques -> productos   CASCADE   se van solos con el producto
   *   conteos  -> productos   RESTRICT  frenarian el borrado...
   *   productos -> hojas      RESTRICT  ...y la hoja no sale con productos
   *
   * El RESTRICT de `conteos` es el cinturon del cinturon: la precondicion
   * `rondaEmpezo` ya garantiza que esta ronda no tiene ni un conteo, y si
   * alguna vez fallara, la base frena el borrado en vez de dejar un conteo
   * huerfano. Por eso no hace falta borrar `Empaque` a mano.
   */
  await tx.producto.delete({ where: { id: producto.id } });

  const quedan = await tx.producto.count({ where: { hojaId: producto.hojaId } });

  let hojaBorrada = false;
  if (quedan === 0) {
    /**
     * UNA HOJA VACIA ES UNA PERSONA MANDADA A MIRAR UNA LISTA SIN RENGLONES.
     * Mismo argumento que `ciclo-conteos.ts#siHayAlgoQueRecontar` usa para no
     * abrir una ronda sin items.
     */
    await tx.hojaConteo.delete({ where: { id: producto.hojaId } });
    hojaBorrada = true;
  } else {
    /**
     * `tamano` ES CUANTOS ITEMS TIENE ESTA HOJA, no el 20/30/50 que se eligio
     * al armar el lote (ver el comentario de HojaConteo.tamano en el schema).
     * Existe porque sin el la pantalla decia "36 / 50 Productos" con todo
     * contado y al cerrar "quedan 14 sin contar" cuando no quedaba ninguno.
     * Sacar un producto y dejar `tamano` quieto reintroduce ese bug exacto:
     * la persona veria 19/20 con la hoja entera hecha.
     */
    await tx.hojaConteo.update({ where: { id: producto.hojaId }, data: { tamano: quedan } });
  }

  /**
   * SI LA RONDA QUEDA SIN HOJAS, LA RONDA DESAPARECE, y el estado que queda es
   * exactamente el mismo que si la ronda anterior hubiera cerrado sin nada que
   * recontar: el inventario sigue `en_curso` esperando al Auditor y
   * `ultimaRondaDe` vuelve a devolver la ronda anterior. `abrirRondaExtra` e
   * `iniciarAjuste` arrancan los dos de `ultimaRondaDe`, asi que siguen
   * funcionando sobre la ronda que ahora es la ultima.
   */
  const rondaBorrada =
    hojaBorrada && (await tx.hojaConteo.count({ where: { inventarioId, numeroConteo: ronda } })) === 0;

  await registrarAuditoria(
    {
      actorId,
      // Hecho PROPIO, no un campo dentro de `conteo.corregido`: que un item
      // salga de una ronda no es el cambio de valor. Seis meses despues
      // alguien va a preguntar por que la hoja 003 de la ronda 2 tiene 19
      // renglones y no 20, y la respuesta tiene que estar buscable por si sola.
      accion: 'inventario.item_salio_de_ronda',
      entidad: 'inventario',
      entidadId: inventarioId,
      detalle: {
        codigo,
        ronda,
        hojaId: producto.hojaId,
        motivo: 'corrección hizo cuadrar el ítem',
        hojaBorrada,
        rondaBorrada,
      },
    },
    tx,
  );

  return { codigo, ronda, hojaId: producto.hojaId, hojaBorrada, rondaBorrada };
}

/**
 * Si el item cuadra contra el ERP mirando TODAS sus rondas hasta `hasta`.
 *
 * Acotado a UN codigo a proposito: `contadoHastaLaRonda` hace lo mismo para el
 * inventario entero (8.000 items) y se justifica al cerrar una ronda, donde se
 * necesitan todos. Corregir un conteo es una operacion puntual y no puede
 * costar una pasada por el catalogo completo.
 */
async function itemCuadra(
  tx: Prisma.TransactionClient,
  inventarioId: number,
  codigo: string,
  hasta: number,
): Promise<boolean> {
  const [item, productos] = await Promise.all([
    tx.catalogoItem.findFirst({ where: { inventarioId, codigo }, select: { stockErp: true } }),
    tx.producto.findMany({
      where: { codigo, hoja: { inventarioId, numeroConteo: { lte: hasta } } },
      select: {
        hoja: { select: { numeroConteo: true } },
        empaques: { select: { nombre: true, factor: true } },
        conteos: { select: { sueltas: true, empaques: { select: { empaqueNombre: true, cantidad: true } } } },
      },
    }),
  ]);

  const conteos = new Array<number | null>(hasta).fill(null);
  for (const producto of productos) {
    const conteo = producto.conteos[0];
    if (conteo === undefined) continue;
    // Indice 0 = ronda 1, igual que `contadoHastaLaRonda`. Y el total sale de
    // `totalUnidades`, la misma funcion que usa el modulo de hojas: ese numero
    // es el que se audita y no puede tener dos versiones.
    conteos[producto.hoja.numeroConteo - 1] = totalUnidades(
      { empaques: conteo.empaques, sueltas: conteo.sueltas },
      producto.empaques,
    );
  }

  return cuadro({ codigo, stockErp: item?.stockErp ?? null, conteos });
}

export { RONDAS_DEL_CICLO, destinoTrasRonda };
