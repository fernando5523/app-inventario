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
import {
  calcularResumenLiquidacion,
  calcularTotalDescuento,
  redondear,
  type ResumenLiquidacion,
} from '../historial/historial.calculos';
import { bonoBase } from '../../dominio/reparto-de-fondo';
import { proyectarPlanilla } from './liquidacion.cierre';
import { validarAcceso } from './liquidacion.permisos';
import { resolverMontosDeClasificacion } from './liquidacion.reclasificacion';

/** Espeja tipos del puerto: mobile/lib/puertos/repositorios.ts#DetalleLiquidacion. */
export interface DetalleLiquidacionDto {
  colaboradorId: number;
  nombre: string;
  rol: Rol;
  /**
   * CUMPLIO LA ASISTENCIA COMPLETA (vino los `diasDelInventario` dias), no
   * "vino alguna vez". Es el que no paga multa y cobra bono. Quien quiera
   * mostrar "vino algun dia" usa `diasAsistidos > 0`.
   */
  asistio: boolean;
  /** Dias que asistio. La pantalla lo muestra como `diasAsistidos / diasDelInventario`. */
  diasAsistidos: number;
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
  /**
   * El mismo periodo en NUMEROS, para lo que no se lee sino que se ordena o se
   * nombra: el archivo del reporte a gerencia ("...-2026-08-inv45.xlsx").
   * Sacarlos de `periodo` seria parsear un texto escrito para personas.
   */
  periodoAnio: number;
  periodoMes: number;
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
  /**
   * CUANTAS PERSONAS no completaron el inventario. PERSONAS, no días -- va al
   * lado de `planilla.length` y de "cuántos asistieron", y esos tres números
   * tienen que sumar entre sí: `asistieron + faltaron === colaboradores`. Fue
   * una invariante rota de verdad una vez ("-2 colaboradores que sí
   * asistieron", 2026-09-05) y por eso no se mezclan unidades en este trío.
   *
   * NO sirve para reconstruir el fondo: `totalFaltas x tarifa` cuenta personas
   * y cada una faltó una cantidad distinta de días. Para eso están
   * `diasFaltadosEnTotal` (el multiplicando correcto) y `fondoMultas`, que ya
   * viene calculado y no hace falta multiplicar.
   */
  totalFaltas: number | null;
  /**
   * LA SUMA DE DIAS FALTADOS DE TODO EL PERSONAL -- lo que multiplicado por la
   * tarifa da el fondo de multas: `diasFaltadosEnTotal x multaInasistencia ===
   * fondoMultas`.
   *
   * Existe para que una pantalla pueda mostrar la composición del fondo
   * ("6 días × S/20 = S/120") sin tener que sumar la planilla a mano ni --
   * peor -- multiplicar `totalFaltas`, que da otro número.
   *
   * 0 en los inventarios cerrados con la regla VIEJA (`diasDelInventario` en
   * 0): esos no tienen asistencia por día, y su fondo sale de las multas fijas
   * que quedaron congeladas en la planilla. Un 0 acá con un fondo distinto de
   * 0 significa exactamente eso, no un error de cuenta.
   */
  diasFaltadosEnTotal: number | null;
  /**
   * Cuantos dias duro el inventario: el denominador de `diasAsistidos` en cada
   * fila y de todas las multas.
   *
   * 0 significa "este inventario se cerro cuando la asistencia todavia se
   * deducia de las hojas", NO "duro cero dias" (ver
   * schema.prisma#ResultadoInventario.diasDelInventario). Una pantalla que
   * muestre "X / Y dias" tiene que chequearlo: con 0, ese inventario no tiene
   * asistencia por dia que mostrar y sus montos son los de la regla vieja.
   */
  diasDelInventario: number;
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
 * EL BONO "DE CARTEL": el piso del reparto del fondo de multas, derivado de
 * LAS FILAS de la planilla -- las firmadas o las proyectadas, da igual, porque
 * las dos llevan lo mismo.
 *
 * Un solo camino para los dos casos a proposito. La proyeccion ya trae su
 * `bonoAsistencia` calculado (`proyectarPlanilla`), pero usar ese para una y
 * este para la otra serian dos formulas del mismo numero, y dos formulas del
 * mismo numero terminan discrepando -- es la regla con la que este modulo
 * pelea desde el primer dia.
 *
 * DE DONDE SALE EL FONDO sin que la fila guarde su multa: el total de cada
 * persona es `cuota + multa - bono`, y nunca hay multa Y bono en la misma fila
 * (`asistio` es exactamente "no paga multa"). Entonces, para quien no
 * completo, `monto - cuota` ES su multa. Mismo despeje que ya usaba
 * `repartido` mas abajo para los bonos, en el otro sentido.
 *
 * Es el PISO y no el promedio: cuando el fondo no divide exacto a algunos les
 * toca un centavo mas, y decir un promedio con decimales que nadie recibe
 * seria peor que decir el minimo que todos cobran. El monto exacto de cada uno
 * esta en su fila.
 */
function bonoDeCartel(
  resumen: ResumenLiquidacion | null,
  planilla: readonly DetalleLiquidacionDto[],
): number | null {
  // Mismo criterio que `faltanteNeto`: sin los datos que nadie capturo, no se
  // deriva un numero con apariencia de dato.
  if (resumen === null) return null;

  const fondo = planilla
    .filter((p) => !p.asistio)
    .reduce((total, p) => total + Math.round((p.monto - resumen.cuotaBase) * 100), 0);

  return bonoBase(fondo / 100, planilla.filter((p) => p.asistio).length);
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
  validarAcceso(actor);

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

  /**
   * LA UNICA FUENTE de empresa/sobrante (liquidacion.reclasificacion.ts):
   * NUNCA se lee `r.montoFaltanteEmpresa` directo para armar un
   * `EntradaLiquidacion` -- ver el comentario de esa funcion sobre el bug
   * real que costó (encabezado y planilla mostrando dos netos distintos).
   * Se resuelve UNA vez y se usa para el resumen (`calcularResumenLiquidacion`
   * de abajo) Y para la proyección de la planilla (`proyectarPlanilla`, mas
   * abajo): si vinieran de dos cálculos podrían volver a discrepar.
   */
  const montos = await resolverMontosDeClasificacion(inventario.id, inventario.estado, {
    montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    montoSobranteEmpleado: r.montoSobranteEmpleado === null ? null : r.montoSobranteEmpleado.toNumber(),
  });

  const resumen = datosCompletos
    ? calcularResumenLiquidacion({
        montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
        montoNegativos: r.montoNegativos!.toNumber(),
        montoFaltanteEmpresa: montos.montoFaltanteEmpresa,
        montoSobranteEmpleado: montos.montoSobranteEmpleado,
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
      : await proyectarPlanilla(
        inventario.id,
        inventario.sucursalId,
        {
          montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
          montoNegativos: r.montoNegativos!.toNumber(),
          montoFaltanteEmpresa: montos.montoFaltanteEmpresa,
          montoSobranteEmpleado: montos.montoSobranteEmpleado,
          colaboradoresAlcanzados: r.colaboradoresAlcanzados,
          colaboradoresAsistieron: r.colaboradoresAsistieron!,
          multaInasistencia: r.multaInasistencia.toNumber(),
        },
        // El denominador CONGELADO al cerrar el conteo, no las marcas de hoy.
        r.diasDelInventario,
      );

  const planilla: DetalleLiquidacionDto[] = persistida
    ? inventario.liquidaciones.map((l) => ({
        colaboradorId: l.colaboradorId,
        // El nombre CONGELADO al liquidar, no el actual: es lo que decia el
        // recibo de sueldo de ese mes.
        nombre: l.nombreAlLiquidar,
        rol: l.rolAlLiquidar as Rol,
        asistio: l.asistio,
        // CONGELADO al liquidar, igual que el nombre: es el "1 de 3" que
        // justifica la multa de esa fila. No se recalcula desde las marcas --
        // ver el comentario de la columna en schema.prisma.
        diasAsistidos: l.diasAsistidos,
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
        diasAsistidos: f.diasAsistidos,
        monto: calcularTotalDescuento(f),
      }));

  return {
    inventarioId: inventario.id,
    periodo: nombreDePeriodo(inventario.periodoAnio, inventario.periodoMes),
    periodoAnio: inventario.periodoAnio,
    periodoMes: inventario.periodoMes,
    faltanteBruto: r.montoFaltanteBruto.toNumber(),
    negativosDelMes: r.montoNegativos?.toNumber() ?? null,
    // La clasificacion VIGENTE (o la congelada, si ya se liquido) -- nunca
    // el valor crudo de `ResultadoInventario`, para que este numero sume
    // contra `faltanteNeto` de abajo (misma fuente para los dos).
    faltanteEmpresa: montos.montoFaltanteEmpresa,
    faltanteNeto: resumen?.montoFaltanteNeto ?? null,
    cuotaBase: resumen?.cuotaBase ?? null,
    multaInasistencia: r.multaInasistencia.toNumber(),
    /**
     * EL PISO DEL REPARTO DEL FONDO REAL, no `resumen.bonoAsistencia`.
     *
     * `calcularResumenLiquidacion` (historial.calculos.ts) lo saca de
     * `faltantes x multaInasistencia`, y con la multa POR DIA esa
     * multiplicacion ya no reconstruye el fondo: tres personas que faltaron 1,
     * 2 y 3 dias aportan 6 tarifas, no 3. El encabezado mostraria un bono mas
     * chico que el que cada uno cobra en su fila, y quien compare las dos
     * cosas deja de creerle a la pantalla.
     *
     * Para una planilla ya firmada sale de sus propias filas (el bono de un
     * asistente es `cuota - monto`, porque no paga multa); para una proyectada,
     * de `proyectarPlanilla`, que lo deriva de las filas que va a escribir.
     */
    bonoAsistencia: bonoDeCartel(resumen, planilla),
    /**
     * CUANTOS NO COMPLETARON la asistencia -- los que pagan multa. Sale de la
     * planilla y no de `resumen.faltantes` por la misma razon: con la multa por
     * dia, "faltantes" dejo de ser un numero que se pueda derivar del par
     * (alcanzados, asistieron) sin mirar quien falto cuanto.
     */
    totalFaltas: resumen === null ? null : planilla.filter((p) => !p.asistio).length,
    diasFaltadosEnTotal:
      resumen === null
        ? null
        : planilla.reduce((total, p) => total + Math.max(0, r.diasDelInventario - p.diasAsistidos), 0),
    diasDelInventario: r.diasDelInventario,
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

  /**
   * Lo que EFECTIVAMENTE se recaudó en multas, despejado de las filas igual
   * que `repartido` -- y por el mismo motivo, que ahora pesa el doble.
   *
   * ANTES era `totalFaltas × multaInasistencia`, y con la multa por día esa
   * multiplicación dejó de reconstruir el fondo: `totalFaltas` cuenta PERSONAS
   * y cada una faltó una cantidad distinta de días. Tres personas que faltaron
   * 1, 2 y 3 días aportan 6 tarifas, no 3 -- la conciliación habría reportado
   * "no cierra, la empresa pone S/60" sobre una planilla perfectamente
   * cuadrada, que es la peor forma de fallar: manda a auditar lo que está bien.
   *
   * Para quien no completó la asistencia, `monto - cuota` ES su multa (nunca
   * hay multa Y bono en la misma fila).
   */
  const recaudado = redondear(
    liquidacion.planilla.filter((p) => !p.asistio).reduce((total, p) => total + (p.monto - cuotaBase), 0),
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
    // Los tres en PERSONAS, y tienen que sumar entre si -- ver el comentario de
    // `totalFaltas`. Los dias faltados viajan aparte, en `fondoDeMultas`.
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
      recaudado,
      repartido,
      /**
       * DE DONDE SALE lo recaudado: `dias x tarifa`. Se expone al lado del
       * monto para que la conciliacion se pueda leer sin recalcular nada --
       * y para que quede a la vista que el multiplicando son DIAS, no las
       * personas de `faltaron`.
       */
      diasFaltados: liquidacion.diasFaltadosEnTotal,
      tarifaPorDia: liquidacion.multaInasistencia,
      /** Tiene que ser 0. Positivo = la empresa pone; negativo = se queda. */
      diferencia: redondear(repartido - recaudado),
      cierra: redondear(repartido - recaudado) === 0,
    },

    /** Lo que hay que decirle a quien firma -- ver AdvertenciaLiquidacion. */
    advertencia: liquidacion.advertencia,
  };
}
