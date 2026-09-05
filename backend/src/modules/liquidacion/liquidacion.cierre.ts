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
 * DE DONDE SALE LA ASISTENCIA
 * ---------------------------------------------------------------------------
 * SE DEDUCE DE LAS HOJAS, sin carga manual: asistio quien tiene al menos una
 * hoja asignada con al menos un conteo, en cualquier ronda. La regla y su
 * costo aceptado -- quien vino y no llego a contar figura como ausente --
 * viven en `dominio/asistencia.ts`.
 *
 * Esta funcion usa LA MISMA consulta (`SELECT_ASISTENCIA`) que el cierre del
 * conteo, y de ahi sale la invariante: la cantidad de `asistio: true` en la
 * planilla es igual a `ResultadoInventario.colaboradoresAsistieron`. Salen de
 * la misma lectura, no pueden discrepar -- y ese numero lo firma alguien.
 *
 * ---------------------------------------------------------------------------
 * LO QUE TODAVIA FRENA ESTE ENDPOINT, A PROPOSITO
 * ---------------------------------------------------------------------------
 * Los AJUSTES DEL MES. No hay endpoint, ni pantalla, ni tabla donde
 * cargarlos, asi que `ResultadoInventario.montoNegativos` sigue en NULL y
 * `liquidar()` corta con 409.
 *
 * Y NO es lo mismo que era la asistencia. La cuenta es
 * `neto = bruto - negativos - empresa`: asumir 0 cuando hubo S/380 de mermas
 * documentadas infla el faltante neto en S/380 y se lo descuenta DE MAS a
 * gente que no lo debe. El error no es simetrico, y por eso no se toma el
 * default comodo. El dia que exista un lugar donde cargarlos, un 0 pasa a
 * significar "alguien miro y no habia" -- que es un cero real -- y ahi si
 * corresponde el default con `ajustesSinRegistrar`.
 */

import { prisma } from '../../config/database';
import { aHojaParaAsistencia, quienesAsistieron, SELECT_ASISTENCIA } from '../../dominio/asistencia';
import { bonoBase, repartirExacto } from '../../dominio/reparto-de-fondo';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import {
  calcularResumenLiquidacion,
  calcularTotalDescuento,
  redondear,
  type EntradaLiquidacion,
} from '../historial/historial.calculos';
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
// La proyeccion: UN SOLO calculo para la vista previa y para el cierre
// ---------------------------------------------------------------------------

export interface ProyeccionPlanilla {
  planilla: FilaPlanilla[];
  resumen: ReturnType<typeof calcularResumenLiquidacion>;
  /** Ids de quienes asistieron, deducidos de las hojas. */
  asistentes: number[];
}

/**
 * Las filas que la planilla VA A TENER, calculadas sin escribir nada.
 *
 * Existe porque la pantalla tenia un candado que pedia su propia llave: el
 * boton "Liquidar" se habilitaba con `planilla.length > 0`, y la planilla
 * solo se llena AL liquidar. Nunca se habilitaba.
 *
 * La salida es la misma para la vista previa y para el cierre porque es
 * literalmente la misma funcion -- `liquidar()` la llama y persiste lo que
 * devuelve. Si hubiera dos calculos, el dia que uno cambie la pantalla
 * mostraria una planilla y se firmaria otra, y nadie lo notaria hasta que
 * alguien compare su recibo con lo que vio en el telefono.
 */
export async function proyectarPlanilla(
  inventarioId: number,
  sucursalId: number,
  entrada: EntradaLiquidacion,
): Promise<ProyeccionPlanilla> {
  const colaboradores = await prisma.colaborador.findMany({
    // El MISMO universo que `colaboradoresAlcanzados` (rondas.service.ts):
    // si estas dos consultas no coinciden, la cuota por persona no cierra
    // contra el faltante neto y nadie entiende por que.
    where: { sucursalId, activo: true },
    select: { id: true, nombre: true, rol: true },
    orderBy: { id: 'asc' },
  });

  // QUIENES asistieron, con LA MISMA regla y LA MISMA consulta que uso el
  // cierre del conteo para contar cuantos (SELECT_ASISTENCIA en
  // dominio/asistencia.ts). De ahi sale la invariante que se testea: la
  // cantidad de `asistio: true` en la planilla es igual a
  // `ResultadoInventario.colaboradoresAsistieron`.
  const hojas = await prisma.hojaConteo.findMany({
    where: { inventarioId },
    select: SELECT_ASISTENCIA,
  });
  const asistentes = [...quienesAsistieron(hojas.map(aHojaParaAsistencia))];

  const resumen = calcularResumenLiquidacion(entrada);

  return {
    planilla: armarPlanilla({
      colaboradores: colaboradores.map((c) => ({ id: c.id, nombre: c.nombre, rol: c.rol as Rol })),
      idsQueAsistieron: asistentes,
      cuotaBase: resumen.cuotaBase,
      multaInasistencia: entrada.multaInasistencia,
      fondoMultas: resumen.fondoMultas,
    }),
    resumen,
    asistentes,
  };
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

  // LA GUARDA. NULL es "no se capturo", nunca "cero" (ver el comentario largo
  // de AdvertenciaLiquidacion). Se corta ACA en vez de escribir filas y
  // advertir despues, porque despues ya se descontó.
  //
  // La asistencia ya no cae por aca: se deduce de las hojas y el cierre del
  // conteo la congela (rondas.service.ts). El chequeo se deja igual porque
  // los inventarios cerrados ANTES de ese cambio tienen null en la columna,
  // y liquidar uno de esos repartiria un fondo de multas calculado sobre una
  // asistencia que nadie sabe.
  //
  // `montoNegativos` sigue siendo el que corta de verdad: no hay ningun lugar
  // donde cargar los ajustes del mes todavia. Ver el comentario del cierre en
  // rondas.service.ts para por que ese sigue en null y la asistencia no.
  const asistenciaSinRegistrar = r.colaboradoresAsistieron === null;
  const ajustesSinRegistrar = r.montoNegativos === null;
  if (asistenciaSinRegistrar || ajustesSinRegistrar) {
    const advertencia = armarAdvertencia({ itemsSinPrecio: 0, asistenciaSinRegistrar, ajustesSinRegistrar });
    throw new Conflicto(
      `No se puede cerrar la planilla todavia. ${advertencia.mensaje ?? ''} ` +
        'Cerrarla igual significaria descontarle a alguien un monto calculado sobre un dato que nadie cargo.',
    );
  }

  const { planilla, resumen, asistentes } = await proyectarPlanilla(inventarioId, inventario.sucursalId, {
    montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
    montoNegativos: r.montoNegativos!.toNumber(),
    montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    colaboradoresAlcanzados: r.colaboradoresAlcanzados,
    colaboradoresAsistieron: r.colaboradoresAsistieron!,
    multaInasistencia: r.multaInasistencia.toNumber(),
  });

  /**
   * NADIE CONTO: no hay asistencia deducible ni a quien repartir.
   *
   * Pasa cuando el inventario llega a `conteo_cerrado` con todas las hojas
   * finalizadas pero SIN un solo conteo cargado -- visto en la app el
   * 2026-09-05 en Luzuriaga, con las hojas finalizadas por script. La
   * asistencia se deduce de hojas con conteos (ver dominio/asistencia.ts),
   * asi que da 0 asistentes.
   *
   * Con 0 asistentes la cuenta deja de significar nada: el fondo de multas
   * no tiene entre quienes repartirse, TODO el personal figura ausente, y la
   * planilla sale con multa para todos por un inventario que en los hechos
   * nadie hizo. Se corta ACA, antes de escribir una sola fila.
   *
   * Va DESPUES de deducir la asistencia y no antes: el numero que decide es
   * el de las hojas, no el `colaboradoresAsistieron` congelado en el
   * resultado -- si alguno de los dos estuviera mal, el que manda es el que
   * se acaba de leer.
   */
  if (asistentes.length === 0) {
    throw new Conflicto(
      'Ningún colaborador registró conteos en este inventario: no hay asistencia deducible ni a quién repartir el faltante. ' +
        'Revisá que las hojas tengan conteos cargados antes de liquidar.',
    );
  }

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
