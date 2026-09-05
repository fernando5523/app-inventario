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
 *    de la ronda 1 quedan intactos. La auditoría compara las tres pasadas
 *    (`auditoria.service.ts` arma la matriz con conteo1/conteo2/conteo3), así
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

import { prisma } from '../../config/database';
import {
  destinoTrasRonda,
  itemsParaLaRondaSiguiente,
  puedeAbrirRondaSiguiente,
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
import { totalUnidades } from '../hojas/hojas.calculos';
import { INCLUIR_TODO, aHojaDto, type HojaDto } from '../hojas/hojas.service';

/** El inventario, validando que el actor pueda tocarlo. */
async function inventarioDelActor(actor: ColaboradorAutenticado, inventarioId: number) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true, tamanoHoja: true },
  });
  if (!inventario) throw new NoEncontrado('Ese inventario no existe.');

  if (actor.rol !== 'administrador' && actor.sucursalId !== inventario.sucursalId) {
    throw new Prohibido('Ese inventario es de otra sucursal.');
  }
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
    `ítems reales, y ese faltante se liquida igual. Conectá a la red y esperá a que sincronice: ${detalle}${resto}.`
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
  await inventarioDelActor(actor, inventarioId);

  const hojas = await prisma.hojaConteo.count({ where: { inventarioId, numeroConteo: ronda } });
  if (hojas === 0) {
    throw new NoEncontrado(
      `El inventario todavía no tiene hojas de la ronda ${ronda}. ` +
        'Creá las hojas y repartilas (paso 2 del wizard) antes de cerrar la ronda.',
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
 * después con datos que ya cambiaron. `montoNegativos` y
 * `colaboradoresAsistieron` se persisten en NULL a propósito -- ver el
 * comentario largo en schema.prisma#ResultadoInventario y en el bloque de
 * abajo: hoy no existe ningún mecanismo para capturarlos.
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
 * Ojo con lo que ESTO NO exige, porque es una decisión pendiente del cliente:
 * `hojas.service.ts#finalizar` permite finalizar una hoja con renglones sin
 * contar. Este cierre NO los da por cero: los manda a recontar (ver
 * `dominio/ciclo-conteos.ts#destinoTrasRonda`). Es lo conservador -- en la
 * duda se recuenta, que cuesta un ítem más en la ronda siguiente -- pero si
 * el cliente prefiere bloquear el cierre hasta que estén todos contados, el
 * cambio es una validación más acá.
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
        'Creá las hojas y repartilas (paso 2 del wizard) antes de cerrar la ronda.',
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
    // EL CIERRE DEL CONTEO. Ronda, estado del inventario Y resultado
    // cambian JUNTOS o no pasa nada. La matriz y el conteo de
    // colaboradores son solo LECTURAS -- se arman antes de la transacción,
    // no comparten atomicidad con la escritura.
    //
    // Reusa `armarMatriz` (auditoria.service.ts) en vez de recalcular: es
    // el mismo cruce catálogo × 3 rondas que ya usa la pantalla del
    // Auditor, y `embudoDeConteos`/`resumir` (auditoria.calculos.ts) ya
    // dan casi todos los campos de `ResultadoInventario` -- ver el
    // comentario de `embudoDeConteos` que deja el gancho anotado.
    const matrizCompleta = await armarMatriz(inventarioId);
    const embudo = embudoDeConteos(matrizCompleta);
    const resumenAuditoria = resumirAuditoria(matrizCompleta);
    // El DETALLE ítem por ítem de esos mismos agregados. Sale de la misma
    // matriz y entra en la misma transacción a propósito: si el total y su
    // detalle se escribieran en dos momentos distintos podrían discrepar, y
    // el sello del lacrado los hashea JUNTOS (historial.lacrado.ts) -- una
    // discrepancia ahí no se detecta, se firma.
    const diferencias = diferenciasParaPersistir(matrizCompleta);
    // TODO el personal habilitado de la sucursal, no solo quien contó --
    // mismo criterio que documenta ResultadoInventario.colaboradoresAlcanzados.
    const colaboradoresAlcanzados = await prisma.colaborador.count({
      where: { sucursalId: inventario.sucursalId, activo: true },
    });

    await prisma.$transaction([
      prisma.inventario.update({ where: { id: inventarioId }, data: { estado: 'conteo_cerrado' } }),
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
          // El faltante que SÍ se descuenta a nómina (valorFaltanteDescontable)
          // resta de acá -- lo que queda es lo que absorbe la empresa.
          montoFaltanteEmpresa: redondear(resumenAuditoria.valorFaltante - resumenAuditoria.valorFaltanteDescontable),
          colaboradoresAlcanzados,
          // NULL, NUNCA 0 -- ver el comentario largo de ambos campos en
          // schema.prisma#ResultadoInventario. No existe TODAVÍA ningún
          // mecanismo para cargar los ajustes del mes ni para registrar
          // quién asistió (decisión pendiente del cliente): un 0 acá
          // afirmaría "no hubo ajustes"/"vino todo el mundo" sin que nadie
          // lo haya verificado, y la planilla de liquidación saldría
          // firmada con multas y bonos inventados. NO SE INVENTA el
          // mecanismo de captura en esta tarea -- este es el lugar
          // preparado para cuando el cliente lo defina: liquidacion.service.ts
          // ya sabe leer estos dos campos en null y avisarlo antes de
          // firmar (ver AdvertenciaLiquidacion.asistenciaSinRegistrar/
          // ajustesSinRegistrar).
          montoNegativos: null,
          colaboradoresAsistieron: null,
          // multaInasistencia: se deja el default de la columna (S/20) --
          // no hay config editable para esto todavía (ver
          // backend/prisma/configuraciones.ts).
        },
      }),
      // El detalle que se va a ajustar en el ERP y que el sello hashea.
      // `skipDuplicates` por el @@unique([inventarioId, codigo]): el cierre
      // corre una sola vez -- el estado pasa a `conteo_cerrado` en esta
      // misma transacción y `cerrar()` lo valida -- pero si alguna vez se
      // reintentara, mejor que no pase nada a que reviente con un error de
      // constraint que no le dice nada a quien lo lee.
      prisma.diferenciaItem.createMany({
        data: diferencias.map((d) => ({ inventarioId, ...d })),
        skipDuplicates: true,
      }),
    ]);

    // No se abre ronda nueva, pero el cierre igual se audita: es el hecho de
    // negocio que dice "la ronda N terminó y este fue el resultado".
    await registrarAuditoria({
      actorId: actor.colaboradorId,
      accion: 'inventario.ronda_cerrada',
      entidad: 'inventario',
      entidadId: inventarioId,
      detalle: { ronda, ...resumenRonda, rondaAbierta: null, motivo: siguiente.motivo },
    });
    return {
      inventarioId,
      rondaCerrada: ronda,
      resumen: resumenRonda,
      rondaAbierta: null,
      motivoSinSiguiente: siguiente.motivo,
      hojas: [],
    };
  }

  // Los datos completos de los ítems que vuelven (descripción, empaques,
  // categoría) salen del CATÁLOGO, no de los Producto de la ronda anterior:
  // el catálogo es la fuente, y así la hoja nueva nace igual de limpia que
  // una de la ronda 1.
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
  const tamano = inventario.tamanoHoja;
  const tamanos = partirEnHojas(ordenados.length, tamano);
  const rondaNueva = ronda + 1;

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

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.ronda_cerrada',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { ronda, ...resumenRonda, rondaAbierta: rondaNueva, hojasNuevas: tamanos.length },
  });

  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId, numeroConteo: rondaNueva },
    include: INCLUIR_TODO,
    orderBy: { numero: 'asc' },
  });

  return {
    inventarioId,
    rondaCerrada: ronda,
    resumen: resumenRonda,
    rondaAbierta: rondaNueva,
    motivoSinSiguiente: null,
    hojas: hojas.map(aHojaDto),
  };
}

export { RONDAS_DEL_CICLO, destinoTrasRonda };
