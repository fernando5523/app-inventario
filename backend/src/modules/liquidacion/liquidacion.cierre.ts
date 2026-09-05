/**
 * CERRAR LA PLANILLA: calcular el descuento de cada persona, guardarlo, y
 * dejar el inventario en `liquidado`.
 *
 * Los dos hechos van JUNTOS, en una transaccion, por la misma razon por la
 * que `rondas.service.ts#cerrar` cierra la ultima ronda y el conteo a la vez:
 * son un solo hecho de negocio. Separarlos deja un segundo paso que alguien
 * se olvida -- y el estado `liquidado` es justo lo que habilita el lacrado,
 * asi que olvidarlo bloquea el cierre del mes sin decir por que.
 *
 * ---------------------------------------------------------------------------
 * EL AGUJERO QUE ESTO CIERRA
 * ---------------------------------------------------------------------------
 * `LiquidacionColaborador` se leia en el historico y en el armado del sello
 * (historial.service.ts#armarDatosLacrado), y solo la escribia el seed. En un
 * inventario real la tabla quedaba vacia: el lacrado hasheaba
 * `liquidaciones: []` y la verificacion respondia "intacto" para siempre.
 * Un sello sobre un documento vacio es peor que no tener sello -- da falsa
 * confianza sobre la parte que mas le importa al colaborador, que es cuanto
 * le descuentan del sueldo.
 *
 * Con `ESTADOS_APROBABLES = ['liquidado']` (historial.permisos.ts) eso deja
 * de ser posible POR CONSTRUCCION: no hay como firmar un inventario cuya
 * planilla no se cerro.
 *
 * ---------------------------------------------------------------------------
 * LO QUE HOY FRENA ESTE ENDPOINT, A PROPOSITO
 * ---------------------------------------------------------------------------
 * No existe mecanismo para registrar la asistencia ni para cargar los ajustes
 * del mes -- decision pendiente del cliente, ver
 * `rondas.service.ts#cerrar`, que persiste NULL en
 * `ResultadoInventario.colaboradoresAsistieron` y `montoNegativos` en vez de
 * inventar un 0. Sin esos dos datos no hay `cuotaBase` ni `bonoAsistencia`
 * que valgan, asi que `liquidar()` corta con 409 y NO escribe una planilla
 * con la asistencia asumida.
 *
 * Es decir: hoy este endpoint responde 409 SIEMPRE. Esta bien que asi sea.
 * La alternativa -- escribir filas con `asistio: true` para todos porque es
 * el default comodo -- es firmarle a alguien un descuento calculado sobre un
 * dato que nadie verifico.
 *
 * OJO PARA QUIEN IMPLEMENTE LA CAPTURA DE ASISTENCIA: un contador no alcanza.
 * `ResultadoInventario.colaboradoresAsistieron` es CUANTOS, y la planilla
 * necesita QUIENES (`LiquidacionColaborador.asistio` es por persona). El
 * mecanismo que se defina tiene que registrar personas, no un numero -- si
 * solo guarda el total, esta funcion sigue sin poder armar la planilla.
 */

import { prisma } from '../../config/database';
import { bonoBase, repartirExacto } from '../../dominio/reparto-de-fondo';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import { calcularResumenLiquidacion, calcularTotalDescuento, redondear } from '../historial/historial.calculos';
import { validarPuedeLiquidar } from './liquidacion.permisos';
import { armarAdvertencia } from './liquidacion.service';

// ---------------------------------------------------------------------------
// El calculo, puro
// ---------------------------------------------------------------------------

export interface ColaboradorParaLiquidar {
  id: number;
  nombre: string;
  rol: Rol;
}

export interface EntradaPlanilla {
  /** Todo el personal alcanzado: el mismo universo que `colaboradoresAlcanzados`. */
  colaboradores: ColaboradorParaLiquidar[];
  /** QUIENES asistieron, no cuantos -- ver el comentario de cabecera. */
  idsQueAsistieron: readonly number[];
  cuotaBase: number;
  multaInasistencia: number;
  /** `faltantes x multaInasistencia`, lo que se redistribuye entre los que vinieron. */
  fondoMultas: number;
}

/** Una fila de `LiquidacionColaborador`, sin `inventarioId`: lo pone quien escribe. */
export interface FilaPlanilla {
  colaboradorId: number;
  nombreAlLiquidar: string;
  rolAlLiquidar: Rol;
  asistio: boolean;
  cuotaBase: number;
  multaInasistencia: number;
  bonoAsistencia: number;
}

/**
 * La planilla completa: una fila por persona alcanzada.
 *
 * NO DEVUELVE EL TOTAL de cada fila -- solo las tres partes (cuota, multa,
 * bono). Es la regla del proyecto que deja a `Conteo` sin columna `total` y a
 * `LiquidacionColaborador` sin `monto`: un total guardado al lado de sus
 * partes es un dato que puede quedar desincronizado de ellas, y entonces hay
 * dos verdades. El total se calcula con
 * `historial.calculos.ts#calcularTotalDescuento` cada vez que se muestra.
 *
 * El bono sale de `repartirExacto`, NO de `bonoBase x asistentes`: esa
 * multiplicacion es la que no cerraba (S/80 entre 7 daba S/80.01, el ejemplo
 * real de la reunion). Cada fila lleva SU centavo, y la suma de la columna da
 * el fondo exacto. Ver dominio/reparto-de-fondo.ts.
 */
export function armarPlanilla(e: EntradaPlanilla): FilaPlanilla[] {
  const asistieron = new Set(e.idsQueAsistieron);
  const idsAsistentes = e.colaboradores.filter((c) => asistieron.has(c.id)).map((c) => c.id);
  const bonoPorPersona = repartirExacto(e.fondoMultas, idsAsistentes);

  return e.colaboradores.map((c) => {
    const asistio = asistieron.has(c.id);
    return {
      colaboradorId: c.id,
      // Nombre y rol CONGELADOS: es lo que decia el recibo de sueldo de ese
      // mes. Si alguien cambia de rol en noviembre, la planilla de agosto no
      // se reescribe (ver el comentario del modelo en schema.prisma).
      nombreAlLiquidar: c.nombre,
      rolAlLiquidar: c.rol,
      asistio,
      cuotaBase: e.cuotaBase,
      // Quien vino no paga multa; quien falto no cobra bono. Nunca los dos.
      multaInasistencia: asistio ? 0 : e.multaInasistencia,
      bonoAsistencia: asistio ? (bonoPorPersona.get(c.id) ?? 0) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// El cierre, contra la base
// ---------------------------------------------------------------------------

export interface CierreLiquidacionDto {
  inventarioId: number;
  estado: 'liquidado';
  /** Cuantas filas se escribieron: el personal alcanzado. */
  colaboradores: number;
  cuotaBase: number;
  /** El bono "de cartel" -- el piso, no el promedio (ver `bonoBase`). */
  bonoAsistencia: number;
  faltantes: number;
  /** La suma real de la planilla, para que cuadre contra el faltante neto. */
  totalDescontado: number;
}

/**
 * Cierra la planilla del inventario y lo deja en `liquidado`.
 *
 * El orden de las guardas es el mensaje: primero lo que la persona puede ir a
 * resolver a mano (el conteo sigue abierto -> hay que cerrar la ultima
 * ronda), despues lo que depende de un dato que hoy no se puede cargar.
 * Mismo criterio que `rondas.service.ts#cerrar`, que chequea "sin finalizar"
 * antes que "sin sincronizar".
 */
export async function liquidar(
  actor: ColaboradorAutenticado,
  inventarioId: number,
): Promise<CierreLiquidacionDto> {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true, resultado: true },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

  validarPuedeLiquidar(actor, inventario.sucursalId);

  if (inventario.estado === 'liquidado' || inventario.estado === 'lacrado') {
    // No se reliquida: el recibo de sueldo de ese mes ya salio. Un segundo
    // calculo con el padron de hoy daria otro numero para un pago que ya se
    // hizo (ver el comentario del modelo LiquidacionColaborador).
    throw new Conflicto(
      'La planilla de este inventario ya se cerro. Una liquidacion no se recalcula: ' +
        'lo que se descontó ya se descontó, y cualquier ajuste entra en el periodo siguiente.',
    );
  }
  if (inventario.estado !== 'conteo_cerrado') {
    throw new Conflicto(
      'Todavia no se puede liquidar: el conteo sigue abierto. ' +
        'El coordinador tiene que cerrar la ultima ronda antes de calcular la planilla.',
    );
  }

  const r = inventario.resultado;
  if (r === null) {
    throw new Conflicto(
      'El inventario esta cerrado pero no tiene resultado calculado. ' +
        'Sin el no hay faltante que repartir -- avisale a soporte antes de firmar nada.',
    );
  }

  // LA GUARDA QUE HOY CORTA SIEMPRE. NULL es "no se capturo", nunca "cero"
  // (ver el comentario largo de AdvertenciaLiquidacion). Sin asistencia no
  // hay multa ni bono que valgan, y sin los ajustes del mes el faltante neto
  // esta inflado: la planilla saldria firmada con numeros que nadie verifico.
  // Se corta ACA en vez de escribir filas y advertir despues, porque despues
  // ya se descontó.
  const asistenciaSinRegistrar = r.colaboradoresAsistieron === null;
  const ajustesSinRegistrar = r.montoNegativos === null;
  if (asistenciaSinRegistrar || ajustesSinRegistrar) {
    const advertencia = armarAdvertencia({ itemsSinPrecio: 0, asistenciaSinRegistrar, ajustesSinRegistrar });
    throw new Conflicto(
      `No se puede cerrar la planilla todavia. ${advertencia.mensaje ?? ''} ` +
        'Cerrarla igual significaria descontarle a alguien un monto calculado sobre un dato que nadie cargo.',
    );
  }

  const colaboradores = await prisma.colaborador.findMany({
    // El MISMO universo que `colaboradoresAlcanzados` (rondas.service.ts):
    // si estas dos consultas no coinciden, la cuota por persona no cierra
    // contra el faltante neto y nadie entiende por que.
    where: { sucursalId: inventario.sucursalId, activo: true },
    select: { id: true, nombre: true, rol: true },
    orderBy: { id: 'asc' },
  });

  const resumen = calcularResumenLiquidacion({
    montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
    montoNegativos: r.montoNegativos!.toNumber(),
    montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    colaboradoresAlcanzados: r.colaboradoresAlcanzados,
    colaboradoresAsistieron: r.colaboradoresAsistieron!,
    multaInasistencia: r.multaInasistencia.toNumber(),
  });

  // De donde salen QUIENES asistieron: hoy, de ningun lado -- la guarda de
  // arriba ya corto. Cuando exista el mecanismo, ESTA es la linea que lo
  // consume, y necesita ids, no un total.
  const idsQueAsistieron: number[] = [];

  const planilla = armarPlanilla({
    colaboradores: colaboradores.map((c) => ({ id: c.id, nombre: c.nombre, rol: c.rol as Rol })),
    idsQueAsistieron,
    cuotaBase: resumen.cuotaBase,
    multaInasistencia: r.multaInasistencia.toNumber(),
    fondoMultas: resumen.fondoMultas,
  });

  // Planilla y estado, o ninguno de los dos. Si el estado quedara en
  // `liquidado` sin las filas, el lacrado -- que ahora exige ese estado --
  // sellaria la planilla vacia que este cambio existe para impedir.
  await prisma.$transaction([
    prisma.liquidacionColaborador.createMany({
      data: planilla.map((f) => ({ inventarioId, ...f })),
      // @@unique([inventarioId, colaboradorId]): el estado hace que esto
      // corra una sola vez, pero un reintento no tiene que reventar con un
      // error de constraint que no le dice nada a quien lo lee.
      skipDuplicates: true,
    }),
    prisma.inventario.update({ where: { id: inventarioId }, data: { estado: 'liquidado' } }),
  ]);

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.liquidado',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: {
      colaboradores: planilla.length,
      cuotaBase: resumen.cuotaBase,
      faltantes: resumen.faltantes,
      montoFaltanteNeto: resumen.montoFaltanteNeto,
    },
  });

  return {
    inventarioId,
    estado: 'liquidado',
    colaboradores: planilla.length,
    cuotaBase: resumen.cuotaBase,
    // El piso del reparto, no el promedio: es el numero que TODOS reciben
    // como minimo, y el que muestra el encabezado de la Pantalla 6.
    bonoAsistencia: bonoBase(resumen.fondoMultas, planilla.filter((f) => f.asistio).length),
    faltantes: resumen.faltantes,
    // `redondear` sobre la suma: sumar decimales de a uno acumula el error de
    // punto flotante que reparto-de-fondo.ts existe para no tener.
    totalDescontado: redondear(planilla.reduce((total, f) => total + calcularTotalDescuento(f), 0)),
  };
}
