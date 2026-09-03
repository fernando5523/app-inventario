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
  bonoAsistencia: number;
  totalFaltas: number;
  planilla: DetalleLiquidacionDto[];
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
  const resumen = calcularResumenLiquidacion({
    montoFaltanteBruto: r.montoFaltanteBruto.toNumber(),
    montoNegativos: r.montoNegativos.toNumber(),
    montoFaltanteEmpresa: r.montoFaltanteEmpresa.toNumber(),
    colaboradoresAlcanzados: r.colaboradoresAlcanzados,
    colaboradoresAsistieron: r.colaboradoresAsistieron,
    multaInasistencia: r.multaInasistencia.toNumber(),
  });

  return {
    periodo: nombreDePeriodo(inventario.periodoAnio, inventario.periodoMes),
    faltanteBruto: r.montoFaltanteBruto.toNumber(),
    negativosDelMes: r.montoNegativos.toNumber(),
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
  };
}
