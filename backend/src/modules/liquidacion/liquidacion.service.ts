/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura).
 *
 * Este modulo NO reimplementa la aritmetica de la liquidacion: la toma de
 * historial.calculos.ts, que ya la tiene testeada contra los numeros del
 * mockup. Lo que agrega es la ENTRADA POR SUCURSAL que pide la pantalla 6
 * (`RepositorioLiquidacion.deSucursal`) y la forma `Liquidacion` del puerto
 * del front, que no es la misma que devuelve el historico.
 *
 * Por que existe aparte de GET /api/historial/inventarios/:id/liquidacion:
 * ese endpoint pide un inventarioId y sirve para mirar un mes cerrado del
 * archivo. La pantalla 6 no sabe ningun inventarioId -- sabe en que tienda
 * esta parada y pregunta "como quedo el ultimo cierre de aca". Son dos
 * preguntas distintas sobre los mismos datos.
 */

import { prisma } from '../../config/database';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import { calcularResumenLiquidacion, calcularTotalDescuento, redondear } from '../historial/historial.calculos';
import { proyectarPlanilla } from './liquidacion.cierre';
import { validarAcceso } from './liquidacion.permisos';

/** Espeja tipos del puerto: mobile/lib/puertos/repositorios.ts#DetalleLiquidacion. */
export interface DetalleLiquidacionDto {
  colaboradorId: number;
  nombre: string;
  rol: Rol;
  asistio: boolean;
  /** Cuota base ± bono/multa, ya calculado. Nunca se guarda un total suelto sin sus partes. */
  monto: number;
}

/**
 * Lo que la pantalla tiene que ADVERTIR sobre este monto.
 *
 * Un item con diferencia pero SIN precio de venta suma 0 al faltante (ver
 * auditoria.calculos.ts): no rompe el calculo y no inventa un precio, pero
 * deja el monto SUBESTIMADO. La auditoria ya contaba esos items; lo que
 * faltaba era traerlos hasta aca.
 *
 * `asistenciaSinRegistrar`/`ajustesSinRegistrar` son la MISMA idea aplicada
 * a `ResultadoInventario.colaboradoresAsistieron`/`montoNegativos`: esos dos
 * campos son NULLABLE en el schema, y NULL ahi no significa "cero" -- significa
 * "todavia no se capturo" (mismo criterio que `CatalogoItem.stockErp`). Sin
 * mecanismo de captura de asistencia todavia (decision pendiente del
 * cliente), el cierre del conteo persiste NULL en vez de inventar un 0 que
 * afirmaria "vino todo el mundo" sin que nadie lo haya verificado. Esta
 * pantalla calcula igual (con 0 como placeholder, para no dejar la planilla
 * en blanco) pero tiene que decirlo ANTES de que alguien firme, no despues.
 *
 * Quien firma un descuento a la nomina de otra persona tiene derecho a saber
 * que el numero esta incompleto. El problema nunca fue el calculo: es que
 * hoy nadie se entera.
 */
export interface AdvertenciaLiquidacion {
  /** Items con diferencia real que no se pudieron valorizar. */
  itemsSinPrecio: number;
  /** true = la multa y el bono de esta planilla NO reflejan asistencia real. */
  asistenciaSinRegistrar: boolean;
  /** true = el faltante neto de esta planilla no descuenta los ajustes del mes. */
  ajustesSinRegistrar: boolean;
  /** Texto listo para mostrar, combinando todas las razones. `null` cuando no hay nada que advertir. */
  mensaje: string | null;
}

export interface DatosAdvertencia {
  itemsSinPrecio: number;
  asistenciaSinRegistrar: boolean;
  ajustesSinRegistrar: boolean;
}

/** Espeja mobile/lib/puertos/repositorios.ts#Liquidacion. */
export interface LiquidacionDto {
  /**
   * SOBRE QUE INVENTARIO es esta liquidacion.
   *
   * La pantalla pregunta por sucursal ("como quedo el ultimo cierre de aca")
   * pero para cargar los ajustes o cerrar la planilla necesita el id del
   * inventario. Sacarlo de `GET /sucursales/:id/inventarios/activo` no
   * sirve: ese busca `estado: 'en_curso'` y este ya esta `conteo_cerrado`
   * -- justamente el estado en el que se liquida.
   */
  inventarioId: number;
  /** "Agosto 2026" -- legible, como lo muestra la pantalla. */
  periodo: string;
  faltanteBruto: number;
  /** null = todavía no se cargaron los ajustes del mes -- NUNCA 0 con ese significado (ver AdvertenciaLiquidacion). */
  negativosDelMes: number | null;
  faltanteEmpresa: number;
  /**
   * null cuando `advertencia.asistenciaSinRegistrar` o
   * `ajustesSinRegistrar` son true: un número que depende de un dato que
   * no existe todavía NO se deriva con un placeholder -- se deja sin
   * calcular, y la advertencia dice por qué.
   */
  faltanteNeto: number | null;
  cuotaBase: number | null;
  multaInasistencia: number;
  /**
   * El PISO del reparto del fondo de multas -- lo que muestra el encabezado.
   * Cuando el fondo no divide exacto, a algunos asistentes les toca un
   * centavo mas; el monto de cada uno esta en su fila de la planilla, y la
   * suma da el fondo al centavo (ver dominio/reparto-de-fondo.ts). null,
   * mismo criterio que `faltanteNeto`.
   */
  bonoAsistencia: number | null;
  /** null, mismo criterio que `faltanteNeto`: sin asistencia registrada no hay "cuántos faltaron" que valga. */
  totalFaltas: number | null;
  planilla: DetalleLiquidacionDto[];
  /**
   * `true` = la planilla todavia NO se firmo: son las filas que
   * `liquidar()` va a persistir, calculadas con la misma funcion y sin
   * escribir nada. `false` = ya se liquido y estas son las filas reales.
   *
   * Que viaje explicito y no se deduzca de `planilla.length` es el punto:
   * una planilla vacia y una proyectada se veian igual desde el front, y de
   * ahi salio el boton que nunca se habilitaba.
   */
  proyectada: boolean;
  /**
   * Campo NUEVO respecto del puerto del front (`Liquidacion`): hay que
   * sumarlo alla y mostrarlo en la pantalla. Ver AdvertenciaLiquidacion.
   */
  advertencia: AdvertenciaLiquidacion;
}

/**
 * Items del inventario con diferencia REAL que no se pudieron valorizar.
 * `montoDiferencia` queda en null cuando el item no traia precio de venta en
 * el snapshot.
 *
 * Se filtra por `diferencia: { not: 0 }` porque un item que cuadro no aporta
 * plata aunque no tenga precio: no falta nada de el, asi que no subestima
 * ningun monto y no hay nada que advertir.
 */
async function contarItemsSinPrecio(inventarioId: number): Promise<number> {
  return prisma.diferenciaItem.count({
    where: { inventarioId, montoDiferencia: null, diferencia: { not: 0 } },
  });
}

/** El texto que ve quien firma. `null` si no hay nada que advertir. */
export function armarAdvertencia(datos: DatosAdvertencia): AdvertenciaLiquidacion {
  const itemsSinPrecio = Math.max(0, datos.itemsSinPrecio);
  const frases: string[] = [];

  if (itemsSinPrecio > 0) {
    const plural = itemsSinPrecio === 1 ? 'ítem' : 'ítems';
    const tienen = itemsSinPrecio === 1 ? 'tiene' : 'tienen';
    frases.push(
      `${itemsSinPrecio} ${plural} con diferencia no ${tienen} precio de venta en Dynamics: el monto puede estar subestimado.`,
    );
  }

  // Mismo criterio que arriba, aplicado a lo que todavía NO se puede
  // capturar: la frase dice explícitamente que el 0 es un placeholder, no
  // un dato verificado — es la diferencia que existe en los datos
  // (ResultadoInventario.colaboradoresAsistieron/montoNegativos NULL) y
  // que acá se vuelve texto para quien firma.
  if (datos.asistenciaSinRegistrar) {
    frases.push(
      'La asistencia todavía no se registra en el sistema: la multa y el bono de esta planilla se calcularon asumiendo 0 faltas, no porque se haya verificado quién vino.',
    );
  }

  if (datos.ajustesSinRegistrar) {
    frases.push('Los ajustes del mes todavía no se cargaron: el faltante neto de esta planilla no los descuenta.');
  }

  return {
    itemsSinPrecio,
    asistenciaSinRegistrar: datos.asistenciaSinRegistrar,
    ajustesSinRegistrar: datos.ajustesSinRegistrar,
    mensaje: frases.length > 0 ? frases.join(' ') : null,
  };
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function nombreDePeriodo(anio: number, mes: number): string {
  return `${MESES[mes - 1] ?? String(mes)} ${anio}`;
}

/**
 * La liquidacion del ULTIMO ciclo cerrado de la sucursal.
 *
 * Devuelve `null` -- no un objeto en cero -- cuando esa tienda todavia no
 * tiene ningun inventario con el conteo cerrado. Es lo que pide el puerto
 * del front, y es lo correcto: una planilla de ceros se lee como "no se
 * descuenta nada", que es una afirmacion muy distinta de "todavia no hay
 * nada que liquidar".
 */
export async function deSucursal(actor: ColaboradorAutenticado, sucursalId: number): Promise<LiquidacionDto | null> {
  validarAcceso(actor, sucursalId);

  const inventario = await prisma.inventario.findFirst({
    where: {
      sucursalId,
      // Un inventario en curso no se liquida: las cantidades todavia pueden
      // cambiar en el 2do o 3er conteo. Y uno anulado nunca produjo resultado.
      estado: { in: ['conteo_cerrado', 'liquidado', 'lacrado'] },
      resultado: { isNot: null },
    },
    include: {
      resultado: true,
      liquidaciones: {
        include: { colaborador: { select: { id: true, nombre: true, rol: true } } },
        orderBy: { colaboradorId: 'asc' },
      },
    },
    // El mas reciente: la pantalla pregunta por el ultimo cierre, no por
    // toda la historia (para eso esta /api/historial).
    orderBy: [{ periodoAnio: 'desc' }, { periodoMes: 'desc' }],
  });

  if (inventario === null || inventario.resultado === null) return null;

  const r = inventario.resultado;
  // NULL en estos dos campos es "todavía no se capturó", NUNCA "cero" (ver
  // el comentario largo de AdvertenciaLiquidacion). Mientras falte
  // cualquiera de los dos, NO se deriva el neto/cuota/bono/faltas: un
  // número que depende de un dato que no existe no es un número, es una
  // adivinanza con apariencia de dato -- se deja sin calcular, y
  // `advertencia` dice por qué.
  const asistenciaSinRegistrar = r.colaboradoresAsistieron === null;
  const ajustesSinRegistrar = r.montoNegativos === null;
  const datosCompletos = !asistenciaSinRegistrar && !ajustesSinRegistrar;

  const resumen = datosCompletos
    ? calcularResumenLiquidacion({
        montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
        montoNegativos: r.montoNegativos!.toNumber(),
        montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
        colaboradoresAlcanzados: r.colaboradoresAlcanzados,
        colaboradoresAsistieron: r.colaboradoresAsistieron!,
        multaInasistencia: r.multaInasistencia.toNumber(),
      })
    : null;

  const itemsSinPrecio = await contarItemsSinPrecio(inventario.id);

  /**
   * LA PLANILLA ANTES DE LIQUIDAR: proyectada, no vacia.
   *
   * `LiquidacionColaborador` se llena AL liquidar, asi que antes de eso
   * `inventario.liquidaciones` esta vacio. Devolver esa lista vacia era un
   * candado que pedia su propia llave: la pantalla habilitaba "Liquidar" con
   * `planilla.length > 0` y nunca se habilitaba. Y el mismo vacio producia
   * el "-2 colaboradores que si asistieron" (0 filas - 2 faltas).
   *
   * La proyeccion sale de `proyectarPlanilla`, LA MISMA funcion que usa
   * `liquidar()` para persistir. No hay dos calculos: si los hubiera, el dia
   * que uno cambie la pantalla mostraria una planilla y se firmaria otra, y
   * nadie lo notaria hasta que alguien compare su recibo con lo que vio.
   *
   * Solo se proyecta si el resumen es calculable -- sin ajustes cargados no
   * hay cuota base con la que armar ninguna fila.
   */
  const persistida = inventario.liquidaciones.length > 0;
  const proyeccion =
    persistida || resumen === null
      ? null
      : await proyectarPlanilla(inventario.id, inventario.sucursalId, {
          montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
          montoNegativos: r.montoNegativos!.toNumber(),
          montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
          colaboradoresAlcanzados: r.colaboradoresAlcanzados,
          colaboradoresAsistieron: r.colaboradoresAsistieron!,
          multaInasistencia: r.multaInasistencia.toNumber(),
        });

  const planilla: DetalleLiquidacionDto[] = persistida
    ? inventario.liquidaciones.map((l) => ({
        colaboradorId: l.colaboradorId,
        // El nombre CONGELADO al liquidar, no el actual: es lo que decia el
        // recibo de sueldo de ese mes.
        nombre: l.nombreAlLiquidar,
        rol: l.rolAlLiquidar as Rol,
        asistio: l.asistio,
        // Derivado de sus tres partes, nunca una columna -- misma regla que
        // deja a Conteo sin columna `total`.
        monto: calcularTotalDescuento({
          cuotaBase: l.cuotaBase.toNumber(),
          multaInasistencia: l.multaInasistencia.toNumber(),
          bonoAsistencia: l.bonoAsistencia.toNumber(),
        }),
      }))
    : (proyeccion?.planilla ?? []).map((f) => ({
        colaboradorId: f.colaboradorId,
        nombre: f.nombreAlLiquidar,
        rol: f.rolAlLiquidar,
        asistio: f.asistio,
        monto: calcularTotalDescuento(f),
      }));

  return {
    inventarioId: inventario.id,
    periodo: nombreDePeriodo(inventario.periodoAnio, inventario.periodoMes),
    faltanteBruto: r.montoFaltanteBruto.toNumber(),
    negativosDelMes: r.montoNegativos?.toNumber() ?? null,
    faltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    faltanteNeto: resumen?.montoFaltanteNeto ?? null,
    cuotaBase: resumen?.cuotaBase ?? null,
    multaInasistencia: r.multaInasistencia.toNumber(),
    bonoAsistencia: resumen?.bonoAsistencia ?? null,
    totalFaltas: resumen?.faltantes ?? null,
    planilla,
    /**
     * `true` = todavia no se firmo, estas filas son lo que VA A PASAR.
     * La pantalla titula distinto ("Planilla proyectada" vs "Planilla") y no
     * ofrece editarla despues.
     */
    proyectada: !persistida,
    advertencia: armarAdvertencia({ itemsSinPrecio, asistenciaSinRegistrar, ajustesSinRegistrar }),
  };
}

/**
 * El detalle "de donde sale este numero" del encabezado. Va aparte porque
 * `Liquidacion` es una forma cerrada que espeja el puerto del front y no se
 * le pueden agregar campos sin romperlo -- pero el residuo de centavos y la
 * suma real de la planilla son justo lo que alguien de Contabilidad va a
 * querer ver cuando pregunte por que el total no da exacto.
 */
export async function conciliacion(
  actor: ColaboradorAutenticado,
  sucursalId: number,
): Promise<Record<string, unknown> | null> {
  const liquidacion = await deSucursal(actor, sucursalId);
  if (liquidacion === null) return null;

  // `faltanteNeto`/`cuotaBase`/`totalFaltas` son null cuando falta
  // asistencia/ajustes (ver LiquidacionDto) -- ninguna de las cuentas de
  // acá abajo se puede hacer con eso en null, así que se corta ANTES en
  // vez de calcular con un valor inventado. La advertencia ya explica por
  // qué; acá no hay que repetirla con números falsos al lado.
  if (liquidacion.faltanteNeto === null || liquidacion.cuotaBase === null || liquidacion.totalFaltas === null) {
    return {
      periodo: liquidacion.periodo,
      calculable: false,
      advertencia: liquidacion.advertencia,
    };
  }
  const faltanteNeto = liquidacion.faltanteNeto;
  const cuotaBase = liquidacion.cuotaBase;
  const totalFaltas = liquidacion.totalFaltas;

  const sumaPlanilla = redondear(liquidacion.planilla.reduce((total, p) => total + p.monto, 0));

  // Lo que EFECTIVAMENTE se repartió en bonos: la suma de lo que recibió cada
  // asistente, no `bonoAsistencia × asistentes`. Esa multiplicación es
  // justamente la que no cerraba, porque a algunos les toca un centavo más.
  const repartido = redondear(
    liquidacion.planilla.filter((p) => p.asistio).reduce((total, p) => total + (cuotaBase - p.monto), 0),
  );

  return {
    periodo: liquidacion.periodo,
    calculable: true,
    faltanteNeto,
    sumaPlanilla,
    /**
     * Los centavos que deja el redondeo de la cuota (1390 / 11 = 126.36 x 11
     * = 1389.96). Se expone en vez de esconderse: el dia que Contabilidad
     * pregunte por que el descuento total no da igual al faltante neto, la
     * respuesta esta en la respuesta del endpoint y no hay que auditar nada.
     * PENDIENTE DE DEFINIR CON EL CLIENTE: hoy queda a favor del personal.
     */
    diferenciaPorRedondeo: redondear(faltanteNeto - sumaPlanilla),
    colaboradores: liquidacion.planilla.length,
    asistieron: liquidacion.planilla.filter((p) => p.asistio).length,
    faltaron: totalFaltas,

    /**
     * EL FONDO DE MULTAS TIENE QUE CERRAR: lo que se recauda de quienes
     * faltaron es exactamente lo que se reparte entre quienes asistieron. Es
     * la regla textual del cliente -- el fondo SE REDISTRIBUYE -- y hasta el
     * arreglo del reparto no se cumplia: con S/80 entre 7 asistentes se
     * repartian S/80.01 y la empresa ponia un centavo.
     *
     * Se expone y no se asume: si algun dia vuelve a no cerrar, se ve acá en
     * vez de aparecer como un descuadre en la nomina tres meses despues.
     */
    fondoDeMultas: {
      recaudado: redondear(totalFaltas * liquidacion.multaInasistencia),
      repartido: repartido,
      /** Tiene que ser 0. Positivo = la empresa pone; negativo = se queda. */
      diferencia: redondear(repartido - totalFaltas * liquidacion.multaInasistencia),
      cierra: redondear(repartido - totalFaltas * liquidacion.multaInasistencia) === 0,
    },

    /** Lo que hay que decirle a quien firma -- ver AdvertenciaLiquidacion. */
    advertencia: liquidacion.advertencia,
  };
}
