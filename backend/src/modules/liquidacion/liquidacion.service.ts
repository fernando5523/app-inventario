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
  /** "Agosto 2026" -- legible, como lo muestra la pantalla. */
  periodo: string;
  faltanteBruto: number;
  negativosDelMes: number;
  faltanteEmpresa: number;
  faltanteNeto: number;
  cuotaBase: number;
  multaInasistencia: number;
  /**
   * El PISO del reparto del fondo de multas -- lo que muestra el encabezado.
   * Cuando el fondo no divide exacto, a algunos asistentes les toca un
   * centavo mas; el monto de cada uno esta en su fila de la planilla, y la
   * suma da el fondo al centavo (ver dominio/reparto-de-fondo.ts).
   */
  bonoAsistencia: number;
  totalFaltas: number;
  planilla: DetalleLiquidacionDto[];
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
  // el comentario largo de AdvertenciaLiquidacion) -- acá es donde el 0
  // entra como PLACEHOLDER para que el cálculo no se rompa, nunca antes.
  // La diferencia real vive en `asistenciaSinRegistrar`/`ajustesSinRegistrar`,
  // que sí llegan a la pantalla.
  const asistenciaSinRegistrar = r.colaboradoresAsistieron === null;
  const ajustesSinRegistrar = r.montoNegativos === null;

  const resumen = calcularResumenLiquidacion({
    montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
    montoNegativos: r.montoNegativos?.toNumber() ?? 0,
    montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    colaboradoresAlcanzados: r.colaboradoresAlcanzados,
    colaboradoresAsistieron: r.colaboradoresAsistieron ?? 0,
    multaInasistencia: r.multaInasistencia.toNumber(),
  });

  const itemsSinPrecio = await contarItemsSinPrecio(inventario.id);

  return {
    periodo: nombreDePeriodo(inventario.periodoAnio, inventario.periodoMes),
    faltanteBruto: r.montoFaltanteBruto.toNumber(),
    negativosDelMes: r.montoNegativos?.toNumber() ?? 0,
    faltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    faltanteNeto: resumen.montoFaltanteNeto,
    cuotaBase: resumen.cuotaBase,
    multaInasistencia: r.multaInasistencia.toNumber(),
    bonoAsistencia: resumen.bonoAsistencia,
    totalFaltas: resumen.faltantes,
    planilla: inventario.liquidaciones.map((l) => ({
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
    })),
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

  const sumaPlanilla = redondear(liquidacion.planilla.reduce((total, p) => total + p.monto, 0));

  // Lo que EFECTIVAMENTE se repartió en bonos: la suma de lo que recibió cada
  // asistente, no `bonoAsistencia × asistentes`. Esa multiplicación es
  // justamente la que no cerraba, porque a algunos les toca un centavo más.
  const repartido = redondear(
    liquidacion.planilla
      .filter((p) => p.asistio)
      .reduce((total, p) => total + (liquidacion.cuotaBase - p.monto), 0),
  );

  return {
    periodo: liquidacion.periodo,
    faltanteNeto: liquidacion.faltanteNeto,
    sumaPlanilla,
    /**
     * Los centavos que deja el redondeo de la cuota (1390 / 11 = 126.36 x 11
     * = 1389.96). Se expone en vez de esconderse: el dia que Contabilidad
     * pregunte por que el descuento total no da igual al faltante neto, la
     * respuesta esta en la respuesta del endpoint y no hay que auditar nada.
     * PENDIENTE DE DEFINIR CON EL CLIENTE: hoy queda a favor del personal.
     */
    diferenciaPorRedondeo: redondear(liquidacion.faltanteNeto - sumaPlanilla),
    colaboradores: liquidacion.planilla.length,
    asistieron: liquidacion.planilla.filter((p) => p.asistio).length,
    faltaron: liquidacion.totalFaltas,

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
      recaudado: redondear(liquidacion.totalFaltas * liquidacion.multaInasistencia),
      repartido: repartido,
      /** Tiene que ser 0. Positivo = la empresa pone; negativo = se queda. */
      diferencia: redondear(repartido - liquidacion.totalFaltas * liquidacion.multaInasistencia),
      cierra: redondear(repartido - liquidacion.totalFaltas * liquidacion.multaInasistencia) === 0,
    },

    /** Lo que hay que decirle a quien firma -- ver AdvertenciaLiquidacion. */
    advertencia: liquidacion.advertencia,
  };
}
