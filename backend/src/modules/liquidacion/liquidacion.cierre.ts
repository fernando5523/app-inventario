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
 * DE DONDE SALE LA ASISTENCIA (CAMBIO: YA NO SE DEDUCE DE LAS HOJAS)
 * ---------------------------------------------------------------------------
 * LA REGISTRA EL COORDINADOR, dia por dia, en `asistencia_inventario`. Hasta
 * este cambio se deducia de las hojas (una hoja con conteos = asistio) y la
 * multa era un monto fijo por persona ausente. Ahora la multa es POR DIA
 * FALTADO y las hojas ya no dicen nada sobre quien vino. El porque de la
 * vuelta atras -- y el costo que el cliente habia aceptado y ahora no --
 * estan en la cabecera de `dominio/asistencia.ts`.
 *
 * Esta funcion usa LA MISMA consulta (`SELECT_ASISTENCIA`) que el cierre del
 * conteo, y de ahi sale la invariante: la cantidad de `asistio: true` en la
 * planilla es igual a `ResultadoInventario.colaboradoresAsistieron`. Salen de
 * la misma lectura, no pueden discrepar -- y ese numero lo firma alguien.
 *
 * OJO con el significado de `asistio`: es CUMPLIO LA ASISTENCIA COMPLETA (los
 * dias del inventario), no "vino alguna vez". Ver el comentario del campo en
 * `FilaPlanilla`, que explica por que no puede ser lo otro sin descuadrar el
 * reparto del fondo.
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
import {
  aJustificacionAsistencia,
  aMarcaAsistencia,
  diasAsistidosPorColaborador,
  diasFaltadosCobrables,
  diasJustificadosPorColaborador,
  multaPorInasistencia,
  SELECT_ASISTENCIA,
  SELECT_JUSTIFICACIONES,
} from '../../dominio/asistencia';
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
import { validarAcceso } from './liquidacion.permisos';
import { armarAdvertencia } from './liquidacion.service';
import {
  operacionesDeEscrituraClasificacion,
  resolverMontosDeClasificacion,
} from './liquidacion.reclasificacion';
import { ROLES_DE_TIENDA } from '../sesion/sesion.service';

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
  /**
   * Cuantos dias duro el inventario: EL DENOMINADOR DE TODAS LAS MULTAS.
   *
   * Llega congelado desde `ResultadoInventario.diasDelInventario` y no se
   * deduce de las marcas acá: si se dedujera, borrar la ultima marca de un
   * dia le bajaria la multa a todo el mundo y le regalaria el bono a quien
   * falto justo ese dia. El numero que manda es el que quedo firmado al
   * cerrar el conteo.
   */
  diasDelInventario: number;
  /**
   * `colaboradorId -> dias distintos que asistio`
   * (`dominio/asistencia.ts#diasAsistidosPorColaborador`).
   *
   * Quien no esta en el Map asistio CERO dias -- no es un dato faltante: la
   * asistencia la registra el coordinador, y no haber sido marcado nunca es
   * exactamente la ausencia total. El universo de personal lo pone
   * `colaboradores`, no este Map.
   */
  diasAsistidos: ReadonlyMap<number, number>;
  /**
   * `colaboradorId -> dias distintos que el AUDITOR le perdono`
   * (`dominio/asistencia.ts#diasJustificadosPorColaborador`).
   *
   * Va SEPARADO de `diasAsistidos` y no sumado adentro, aunque para la plata
   * se sumen: `FilaPlanilla.diasAsistidos` termina en el sello del lacrado, y
   * un sello que afirma que alguien estuvo un dia que no estuvo deja de
   * servir justo cuando hace falta (ver JustificacionAsistencia en el
   * schema). Se suman en `diasFaltadosCobrables`, donde se ve.
   *
   * Quien no esta en el Map no tiene ninguna falta perdonada.
   */
  diasJustificados: ReadonlyMap<number, number>;
  cuotaBase: number;
  /**
   * La multa POR DIA faltado, no por persona ausente.
   * `ResultadoInventario.multaInasistencia` cambio de significado con este
   * mismo cambio: era el monto fijo de quien no venia, ahora es la tarifa
   * diaria. El nombre del campo en la base quedo igual; el de acá no, para
   * que nadie le pase el monto viejo sin darse cuenta.
   */
  tarifaMultaPorDia: number;
}

/** Una fila de `LiquidacionColaborador`, sin `inventarioId`: lo pone quien escribe. */
export interface FilaPlanilla {
  colaboradorId: number;
  nombreAlLiquidar: string;
  rolAlLiquidar: Rol;
  /**
   * CUBRIO EL INVENTARIO COMPLETO: entre lo que vino y lo que le perdonaron,
   * llego a los `diasDelInventario` dias. NO es "vino alguna vez" -- Delia,
   * que hizo 1 de 3 sin justificaciones, tiene `asistio: false` y
   * `diasAsistidos: 1`.
   *
   * UN DIA JUSTIFICADO CUENTA ACA, y es la decision textual del cliente: "si
   * cobra el bono de distribucion, es como si hubiera asistido". Por eso el
   * nombre del campo se queda corto a proposito -- lo que afirma es que esta
   * persona COBRA, no que estuvo. Quien necesite "estuvo" tiene
   * `diasAsistidos`, que nunca se infla.
   *
   * Se eligio asi y no por "vino al menos un dia" porque este booleano es el
   * que usan la pantalla y el historico para contar entre cuantos se reparte
   * el fondo (`bonoBase(fondo, asistieron)`, la conciliacion de
   * liquidacion.service.ts). Con la multa prorrateada, "vino alguna vez" dejo
   * de ser una categoria util -- casi todos vinieron alguna vez -- y usarlo
   * para repartir daria un bono por persona mas chico que el que cada uno
   * cobra de verdad: el encabezado diria un numero y la planilla otro.
   *
   * La equivalencia que sostiene todo: `asistio === (multaInasistencia === 0)
   * === (bonoAsistencia > 0 cuando hay fondo)`. Quien quiera mostrar "vino
   * algun dia" tiene `diasAsistidos > 0`, que es el dato honesto y esta acá
   * al lado.
   */
  asistio: boolean;
  /**
   * Dias que asistio, CONGELADOS junto al resto de la fila. Es lo que la
   * pantalla muestra como "1 / 3" y lo unico que hace auditable la multa
   * meses despues: sin este numero, `multaInasistencia: 40` con una tarifa de
   * 20 obliga a recontar marcas que para entonces pueden haber cambiado.
   *
   * Misma razon por la que `nombreAlLiquidar` y `rolAlLiquidar` se congelan.
   */
  diasAsistidos: number;
  /**
   * Dias que FALTO y el auditor le perdono, congelados igual que
   * `diasAsistidos` y por separado de ellos. Es la otra mitad de lo que hace
   * auditable la multa: con `diasAsistidos: 1`, `diasJustificados: 2` y
   * `diasDelInventario: 3`, la multa 0 se explica sola. Sin esta columna, esa
   * misma fila es un cero que nadie puede justificar.
   */
  diasJustificados: number;
  cuotaBase: number;
  /** `(dias - asistidos - justificados) x tarifa` (puede ser 0, 20, 40...). */
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
 * ---------------------------------------------------------------------------
 * EL FONDO SE CALCULA ACA, NO LLEGA POR PARAMETRO. ES LO QUE SOSTIENE LA SUMA
 * ---------------------------------------------------------------------------
 * Antes el fondo entraba como dato (`fondoMultas`, calculado afuera como
 * `faltantes x multa`), porque con una multa fija por persona ausente esa
 * multiplicacion no podia discrepar de la suma de las multas de la planilla.
 * Con la multa POR DIA ya no: el fondo es la suma de multas prorrateadas, una
 * por persona, con denominadores distintos. Cualquier formula de afuera que
 * intente reconstruirlo -- `gente que falto x tarifa` -- da otro numero.
 *
 * Por eso se deriva de las MISMAS filas que se estan armando. No es que sea
 * mas comodo: es que asi la invariante no depende de que dos calculos
 * coincidan, sino de que hay uno solo.
 *
 *     suma(multa) === fondo === suma(bono)
 *     suma(fila) === cuotaBase x alcanzados
 *
 * Y de ahi sale lo unico que le importa a quien firma: LA PLANILLA SUMA EL
 * FALTANTE NETO (menos el residuo del redondeo de la cuota, que es anterior a
 * este cambio y se expone en `ResumenLiquidacion.residuoCentavos`).
 *
 * El bono sale de `repartirExacto`, NO de `bonoBase x asistentes`: esa
 * multiplicacion es la que no cerraba (S/80 entre 7 daba S/80.01, el ejemplo
 * real de la reunion). Cada fila lleva SU centavo, y la suma de la columna da
 * el fondo exacto. Ver dominio/reparto-de-fondo.ts.
 *
 * COBRAN BONO LOS DE ASISTENCIA COMPLETA, que son exactamente los de multa 0.
 * Si el fondo se repartiera entre quienes vinieron algun dia, alguien podria
 * cobrar bono Y pagar multa: aportaria al fondo y cobraria de el, y la
 * planilla dejaria de sumar el neto.
 */
export function armarPlanilla(e: EntradaPlanilla): FilaPlanilla[] {
  // La multa de cada uno, ANTES de repartir nada: el fondo es su suma, asi
  // que no se puede repartir sin haberlas calculado todas.
  const diasDe = (colaboradorId: number) => ({
    diasInventario: e.diasDelInventario,
    diasAsistidos: e.diasAsistidos.get(colaboradorId) ?? 0,
    diasJustificados: e.diasJustificados.get(colaboradorId) ?? 0,
  });

  const multaPorColaborador = new Map(
    e.colaboradores.map((c) => [c.id, multaPorInasistencia(diasDe(c.id), e.tarifaMultaPorDia)]),
  );

  // En CENTAVOS para sumar: `reparto-de-fondo.ts` existe justamente porque
  // sumar soles de a uno acumula el error que despues no deja cerrar.
  const fondoMultas =
    [...multaPorColaborador.values()].reduce((total, multa) => total + Math.round(multa * 100), 0) / 100;

  const idsConBono = e.colaboradores.filter((c) => multaPorColaborador.get(c.id) === 0).map((c) => c.id);
  const bonoPorPersona = repartirExacto(fondoMultas, idsConBono);

  return e.colaboradores.map((c) => {
    const dias = diasDe(c.id);
    const multaInasistencia = multaPorColaborador.get(c.id) ?? 0;
    /**
     * Quien cubrio el inventario completo no paga multa; a quien le quedo un
     * dia sin cubrir no cobra bono. Nunca los dos -- ver `asistio`.
     *
     * Sale de `diasFaltadosCobrables` y NO de `multaInasistencia === 0`,
     * aunque hoy den lo mismo: con una tarifa en 0 -- que la config permite
     * -- todas las multas serian 0 y TODOS cobrarian bono, incluido quien no
     * fue un solo dia. El fondo seria 0 y el bono tambien, asi que la plata
     * cerraria igual, pero `asistio` es lo que la pantalla y el historico
     * muestran como "cumplio": diria que cumplio quien falto a todo.
     */
    const asistio = diasFaltadosCobrables(dias) === 0;
    return {
      colaboradorId: c.id,
      // Nombre y rol CONGELADOS: es lo que decia el recibo de sueldo de ese
      // mes. Si alguien cambia de rol en noviembre, la planilla de agosto no
      // se reescribe (ver el comentario del modelo en schema.prisma).
      nombreAlLiquidar: c.nombre,
      rolAlLiquidar: c.rol,
      asistio,
      diasAsistidos: dias.diasAsistidos,
      diasJustificados: dias.diasJustificados,
      cuotaBase: e.cuotaBase,
      multaInasistencia,
      bonoAsistencia: asistio ? (bonoPorPersona.get(c.id) ?? 0) : 0,
    };
  });
}

/**
 * El fondo de multas que ESTA planilla recauda y reparte: la suma de la
 * columna de multas.
 *
 * Se deriva de las filas en vez de recalcularse con una formula porque es el
 * mismo motivo de siempre -- dos calculos del mismo numero terminan
 * discrepando. Lo necesitan el encabezado de la pantalla (el bono "de
 * cartel") y la guarda de `liquidar()` que corta cuando no hay a quien
 * repartirlo.
 */
export function fondoDeLaPlanilla(filas: readonly FilaPlanilla[]): number {
  return filas.reduce((total, f) => total + Math.round(f.multaInasistencia * 100), 0) / 100;
}

// ---------------------------------------------------------------------------
// La proyeccion: UN SOLO calculo para la vista previa y para el cierre
// ---------------------------------------------------------------------------

export interface ProyeccionPlanilla {
  planilla: FilaPlanilla[];
  /**
   * OJO: `resumen.fondoMultas` y `resumen.bonoAsistencia` son los de la
   * formula VIEJA (`gente que falto x tarifa`), que con la multa por dia ya
   * no reconstruye nada -- tres personas que faltaron 1, 2 y 3 dias aportan
   * 6 tarifas, no 3. `calcularResumenLiquidacion` vive en
   * historial.calculos.ts y sigue calculandolos asi para no romper a los
   * inventarios viejos que lo llaman sin planilla.
   *
   * LOS BUENOS SON LOS DE ACA ABAJO (`fondoMultas`, `bonoAsistencia`), que
   * salen de las filas. Quien arme una pantalla o un reporte usa esos.
   */
  resumen: ReturnType<typeof calcularResumenLiquidacion>;
  /** Quienes cumplieron la asistencia COMPLETA -- los que cobran bono. */
  asistentes: number[];
  /** El denominador congelado de todas las multas de este inventario. */
  diasDelInventario: number;
  /** El fondo REAL: la suma de las multas de estas filas (`fondoDeLaPlanilla`). */
  fondoMultas: number;
  /** El piso del reparto, sobre el fondo real. Es el bono "de cartel". */
  bonoAsistencia: number;
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
  /**
   * `ResultadoInventario.diasDelInventario`, congelado al cerrar el conteo.
   * Entra por parametro y NO se deduce de las marcas de hoy: es el
   * denominador de todas las multas, y deducirlo haria que borrar la ultima
   * marca de un dia le bajara la multa a todo el mundo.
   *
   * Va aparte de `entrada` porque `EntradaLiquidacion` es el tipo de
   * historial.calculos.ts y lo comparten llamadores que no arman planilla.
   */
  diasDelInventario: number,
): Promise<ProyeccionPlanilla> {
  const colaboradores = await prisma.colaborador.findMany({
    // El MISMO universo que `colaboradoresAlcanzados` (rondas.service.ts):
    // si estas dos consultas no coinciden, la cuota por persona no cierra
    // contra el faltante neto y nadie entiende por que.
    //
    // `rol: { in: ROLES_DE_TIENDA }` -- decision del cliente: el auditor y
    // el administrador NO pertenecen a ninguna tienda, ni con un
    // `sucursalId` viejo en su ficha (ver el comentario de la constante en
    // sesion.service.ts, el caso real es Gilmer). Sin este filtro entraban a
    // la planilla, se les repartia faltante y se les cobraba multa por no
    // haber contado -- cosa que un auditor nunca hace.
    where: { sucursalId, activo: true, rol: { in: ROLES_DE_TIENDA } },
    select: { id: true, nombre: true, rol: true },
    orderBy: { id: 'asc' },
  });

  // CUANTOS DIAS HIZO CADA UNO, con LA MISMA consulta que uso el cierre del
  // conteo para congelar el denominador (SELECT_ASISTENCIA en
  // dominio/asistencia.ts). De ahi sale la invariante que se testea: la
  // cantidad de `asistio: true` en la planilla es igual a
  // `ResultadoInventario.colaboradoresAsistieron`.
  const marcas = (
    await prisma.asistenciaInventario.findMany({ where: { inventarioId }, select: SELECT_ASISTENCIA })
  ).map(aMarcaAsistencia);
  // LAS FALTAS PERDONADAS por el auditor, que se leen ACA y no en el cierre
  // del conteo: la ventana para justificar sigue abierta hasta que se
  // liquida, asi que el numero bueno es el de este momento. Ver
  // `JustificacionAsistencia` en el schema.
  const diasJustificados = diasJustificadosPorColaborador(
    (
      await prisma.justificacionAsistencia.findMany({ where: { inventarioId }, select: SELECT_JUSTIFICACIONES })
    ).map(aJustificacionAsistencia),
  );
  const diasAsistidos = diasAsistidosPorColaborador(marcas);

  const resumen = calcularResumenLiquidacion(entrada);

  const planilla = armarPlanilla({
    colaboradores: colaboradores.map((c) => ({ id: c.id, nombre: c.nombre, rol: c.rol as Rol })),
    diasDelInventario,
    diasAsistidos,
    diasJustificados,
    cuotaBase: resumen.cuotaBase,
    // `multaInasistencia` del resultado congelado ES la tarifa por dia desde
    // este cambio -- el campo de la base no se renombro, el de acá si, para
    // que nadie le pase el monto viejo del ausente sin darse cuenta.
    tarifaMultaPorDia: entrada.multaInasistencia,
  });

  // El fondo sale de LAS FILAS, nunca de `resumen.fondoMultas`: ver el
  // comentario de `ProyeccionPlanilla`. Es lo que hace que la suma cierre sin
  // depender de que dos calculos coincidan.
  const fondoMultas = fondoDeLaPlanilla(planilla);
  const asistentes = planilla.filter((f) => f.asistio).map((f) => f.colaboradorId);

  return {
    planilla,
    resumen,
    asistentes,
    diasDelInventario,
    fondoMultas,
    bonoAsistencia: bonoBase(fondoMultas, asistentes.length),
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
  // Del auditor (liquidacion.permisos.ts), y ANTES de tocar la base: a quien no
  // tiene acceso no se le dice ni si el inventario existe.
  validarAcceso(actor);

  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true, resultado: true },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

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
        'Sin él no hay faltante que repartir: avísale a soporte antes de firmar nada.',
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

  /**
   * RECLASIFICACION AL LIQUIDAR (liquidacion v2, decision del cliente): la
   * clasificacion empresa/empleado de cada item se evalua AHORA, con la
   * excepcion VIGENTE del Auditor (`ClasificacionProducto`), no con la que
   * tenia Dynamics cuando se cerro el conteo. `montoFaltanteEmpresa` de acá
   * REEMPLAZA al que quedo congelado en `ResultadoInventario` al cerrar
   * (ese usaba solo Dynamics); `montoSobranteEmpleado` es nuevo. Ver
   * `liquidacion.reclasificacion.ts#resolverMontosDeClasificacion` -- LA
   * UNICA FUENTE de estos dos montos en todo el backend (historial, la
   * vista previa de esta misma pantalla, y aca) -- para el detalle y por que
   * `montoFaltanteBruto` NO se toca (ya incluye el faltante de empresa;
   * restarlo aca de nuevo lo descontaria dos veces).
   *
   * `inventario.estado` en este punto es SIEMPRE `conteo_cerrado` (las
   * guardas de arriba ya lo garantizan), asi que esto siempre cae en el
   * regimen VIGENTE y `esEmpresaPorCodigo` siempre viene con el mapa.
   *
   * Se lee y calcula ANTES de la transaccion (son lecturas), pero se ESCRIBE
   * dentro de ella, mas abajo -- junto con la planilla y el estado, para que
   * no pueda quedar la clasificacion congelada sin la liquidacion hecha, ni
   * al reves.
   */
  const montos = await resolverMontosDeClasificacion(inventarioId, inventario.estado, {
    montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    montoSobranteEmpleado: r.montoSobranteEmpleado === null ? null : r.montoSobranteEmpleado.toNumber(),
  });

  const { planilla, resumen, asistentes, fondoMultas, bonoAsistencia } = await proyectarPlanilla(
    inventarioId,
    inventario.sucursalId,
    {
      montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
      // Lo escribe el Excel de ajustes (liquidacion.ajustes.ts) antes de
      // liquidar -- se sigue leyendo tal cual quedo en el resultado, sin tocar.
      montoNegativos: r.montoNegativos!.toNumber(),
      montoFaltanteEmpresa: montos.montoFaltanteEmpresa,
          montoFaltantePaquete: montos.montoFaltantePaquete,
      montoSobranteEmpleado: montos.montoSobranteEmpleado,
      colaboradoresAlcanzados: r.colaboradoresAlcanzados,
      colaboradoresAsistieron: r.colaboradoresAsistieron!,
      multaInasistencia: r.multaInasistencia.toNumber(),
    },
    // El denominador CONGELADO al cerrar el conteo, no las marcas de hoy.
    r.diasDelInventario,
  );

  /**
   * NADIE MARCO ASISTENCIA: el inventario no tiene un solo dia.
   *
   * Con `diasDelInventario` en 0 la formula nueva da multa 0 para todos, y la
   * planilla saldria sin una sola multa ni bono -- solo la cuota. Para una
   * planilla YA FIRMADA con la regla vieja eso es exactamente lo correcto
   * (sus montos viven congelados en `liquidaciones_colaborador` y no se
   * recalculan), pero para una que se esta por firmar AHORA significa otra
   * cosa: que nadie cargo la asistencia. Perdonarle la multa a todo el mundo
   * en silencio no es conservador, es firmar un numero que nadie reviso.
   *
   * Alcanza a los inventarios cerrados ANTES de este cambio, que quedaron con
   * 0 y sin marcas. Para esos existe `prisma/rellenar-asistencia.ts`: se
   * completa la asistencia y recien ahi se liquida.
   */
  if (r.diasDelInventario === 0) {
    throw new Conflicto(
      'Este inventario no tiene ningún día de asistencia registrado: sin días no hay multa que calcular ni fondo que repartir. ' +
        'El coordinador tiene que registrar la asistencia antes de cerrar la planilla.',
    );
  }

  /**
   * NADIE VINO TODOS LOS DIAS: el fondo no tiene a quien repartirse.
   *
   * Si a todos les falta aunque sea un dia, todos pagan multa y nadie cobra
   * bono: la empresa recauda el fondo y no lo redistribuye. Eso es
   * EXACTAMENTE lo que el bono existe para impedir -- la planilla sumaria
   * `neto + fondo` y se le descontaria de mas a todo el personal.
   *
   * Es degenerado (que absolutamente nadie complete el inventario es raro),
   * pero el error no es simetrico: la alternativa silenciosa le cobra de mas
   * a gente que trabajo. Se corta ACA, antes de escribir una sola fila.
   *
   * Va DESPUES de armar la planilla y no antes: el numero que decide sale de
   * las filas que se estan por escribir, no del `colaboradoresAsistieron`
   * congelado en el resultado -- si alguno de los dos estuviera mal, manda el
   * que se acaba de calcular.
   */
  if (asistentes.length === 0) {
    throw new Conflicto(
      `Ningún colaborador cumplió los ${r.diasDelInventario} días del inventario: el fondo de multas (S/${fondoMultas.toFixed(2)}) ` +
        'no tiene entre quiénes repartirse, y cerrar la planilla así le descontaría ese monto de más a todo el personal. ' +
        'Revisá la asistencia registrada antes de liquidar.',
    );
  }

  // Planilla, estado Y la clasificacion recalculada -- las TRES o ninguna.
  // Si el estado quedara en `liquidado` sin las filas, el lacrado -- que
  // ahora exige ese estado -- sellaria la planilla vacia que este cambio
  // existe para impedir. Y si la clasificacion quedara a medio escribir (o
  // no se escribiera pero el estado si cambiara a `liquidado`), el reporte a
  // gerencia y el sello leerian un `DiferenciaItem.esEmpresa` que no es el
  // que de verdad se uso para calcular la planilla que se esta por firmar.
  await prisma.$transaction([
    prisma.liquidacionColaborador.createMany({
      // COLUMNA POR COLUMNA, no `{ inventarioId, ...f }`. El spread compila
      // aunque `FilaPlanilla` tenga un campo que la tabla no tiene -- TypeScript
      // no hace control de propiedades de mas sobre un spread -- y Prisma
      // recien lo rechaza EN RUNTIME, adentro de la transaccion del cierre.
      // Enumerarlas convierte ese reventon en un error de compilacion.
      data: planilla.map((f) => ({
        inventarioId,
        colaboradorId: f.colaboradorId,
        nombreAlLiquidar: f.nombreAlLiquidar,
        rolAlLiquidar: f.rolAlLiquidar,
        asistio: f.asistio,
        diasAsistidos: f.diasAsistidos,
        diasJustificados: f.diasJustificados,
        cuotaBase: f.cuotaBase,
        multaInasistencia: f.multaInasistencia,
        bonoAsistencia: f.bonoAsistencia,
      })),
      // @@unique([inventarioId, colaboradorId]): el estado hace que esto
      // corra una sola vez, pero un reintento no tiene que reventar con un
      // error de constraint que no le dice nada a quien lo lee.
      skipDuplicates: true,
    }),
    prisma.inventario.update({ where: { id: inventarioId }, data: { estado: 'liquidado' } }),
    prisma.resultadoInventario.update({
      where: { inventarioId },
      data: {
        montoFaltanteEmpresa: montos.montoFaltanteEmpresa,
        // `montoFaltantePaquete` NO se escribe: no hay columna, a proposito.
        // Se DERIVA de lo que si queda congelado -- `DiferenciaItem.clase` mas
        // el `empaqueCompra` del snapshot y el umbral del inventario (ver
        // `liquidacion.reclasificacion.ts#montoPaqueteCongelado`). Guardar el
        // total al lado de sus partes es lo que este repo evita en todos lados.
        montoSobranteEmpleado: montos.montoSobranteEmpleado,
        /**
         * `colaboradoresAsistieron` SE REESCRIBE ACA, y no es que se rompa el
         * congelado: se termina de congelar.
         *
         * Lo dejo escrito el cierre del conteo (rondas.service.ts) contando
         * quienes cobraban bono con lo que se sabia ENTONCES. Pero la ventana
         * para justificar una falta sigue abierta hasta este mismo momento
         * -- es mas: justificar DESPUES del cierre del conteo es el caso
         * normal, porque el reclamo aparece cuando el auditor mira la
         * planilla. Cada justificacion puede sumar a alguien al grupo que
         * cobra bono.
         *
         * Sin esta linea, el numero congelado diria 5 y la planilla que se
         * esta escribiendo al lado tendria 6 filas con `asistio: true`. Los
         * dos van al sello del lacrado (historial.lacrado.ts): el documento
         * firmado se contradiria a si mismo, y `liquidacion.service.ts`
         * repartiria el bono "de cartel" entre un numero de gente distinto
         * del real.
         *
         * Va en la MISMA transaccion que las filas de donde sale, que es lo
         * unico que garantiza que no puedan discrepar. Despues de esto nadie
         * mas lo toca: liquidar es el fin de la ventana.
         */
        colaboradoresAsistieron: asistentes.length,
      },
    }),
    // `esEmpresaPorCodigo` nunca es null aca: ver el comentario de arriba.
    ...operacionesDeEscrituraClasificacion(inventarioId, montos.esEmpresaPorCodigo!),
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
    // como minimo, y el que muestra el encabezado de la Pantalla 6. Sale del
    // fondo REAL de la planilla, no de `resumen.fondoMultas` -- ver el
    // comentario de `ProyeccionPlanilla`.
    bonoAsistencia,
    faltantes: resumen.faltantes,
    // `redondear` sobre la suma: sumar decimales de a uno acumula el error de
    // punto flotante que reparto-de-fondo.ts existe para no tener.
    totalDescontado: redondear(planilla.reduce((total, f) => total + calcularTotalDescuento(f), 0)),
  };
}
