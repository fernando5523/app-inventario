/**
 * Adaptador en memoria de RepositorioLiquidacion.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts). Los montos en
 * soles son los mismos, ya validados, de mobile/design/liquidacion.html —
 * el propio mockup los marca como ilustrativos, así que se mantienen
 * literales acá (no hay ERP de nómina real detrás todavía). Lo que SÍ se
 * calcula, nunca se hardcodea, es el monto de cada colaborador: sale de
 * `cuotaBase`, `bonoAsistencia` y `multaInasistencia` según si asistió,
 * igual que hace `calcTotal()` con empaque/factor en el resto de la app.
 */

import { simularLatencia } from './_compartido';
import { sesionMemoria } from './sesion-memoria';
import type {
  AjustesDelMes,
  CierreLiquidacion,
  Conciliacion,
  DetalleLiquidacion,
  Liquidacion,
  ReporteGerencia,
  RepositorioLiquidacion,
} from '../puertos/repositorios';

/** Ver `reporteGerencia` abajo: sin servidor no hay diferencias reales de las que armarlo. */
const SIN_SERVIDOR_REPORTE =
  'El reporte a gerencia sale de las diferencias reales del inventario: se necesita conexión con el servidor para verlo.';

/** Espeja historial.calculos.ts#redondear (2 decimales) -- no existe una lib compartida entre backend y mobile. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Inventarios ya liquidados en esta corrida: liquidar dos veces tiene que fallar. */
const liquidados = new Set<number>();

function sinRegistrar(inventarioId: number): AjustesDelMes {
  return {
    inventarioId,
    registrado: false,
    montoNegativos: null,
    montoFaltanteEmpresa: null,
    nota: null,
    registradoPor: null,
    registradoEn: null,
  };
}

/** Solo para tests: deja el adaptador como recién arrancado. */
export function limpiarAjustesMemoria(): void {
  liquidados.clear();
}

const SUCURSAL_LUZURIAGA_ID = 1;

/** id de colaborador (ver sesion-memoria.ts) -> si asistió el mes cerrado. Solo Luzuriaga tiene datos de liquidación cargados. */
const ASISTENCIA_LUZURIAGA: Record<number, boolean> = {
  101: true, // José Tarazona
  102: true, // María Rojas
  103: true, // Gilmer Quispe
  104: true, // Elena Príncipe
  105: true, // Walter Norabuena
  106: true, // Rosa Melgarejo
  107: false, // Luis Shuan
  108: true, // Carla Depaz
  109: false, // Manuel Chávez
  110: false, // Yeni Sotelo
  111: true, // Hugo Vergaray
};

/** El inventario de esa liquidación — sobre el que se cargan los ajustes. */
const INVENTARIO_LUZURIAGA_ID = 1;

const DATOS_LUZURIAGA = {
  periodo: 'Agosto 2026',
  periodoAnio: 2026,
  periodoMes: 8,
  faltanteBruto: 2200.0,
  negativosDelMes: 380.0,
  faltanteEmpresa: 170.0,
  multaInasistencia: 20.0,
};

export const liquidacionMemoria: RepositorioLiquidacion = {
  async deSucursal(sucursalId) {
    await simularLatencia();

    if (sucursalId !== SUCURSAL_LUZURIAGA_ID) return null;

    const colaboradores = await sesionMemoria.colaboradores(sucursalId);
    const { periodo, periodoAnio, periodoMes, faltanteBruto, negativosDelMes, faltanteEmpresa, multaInasistencia } = DATOS_LUZURIAGA;

    const faltanteNeto = faltanteBruto - negativosDelMes - faltanteEmpresa;
    const cuotaBase = faltanteNeto / colaboradores.length;

    const faltaron = colaboradores.filter((c) => !ASISTENCIA_LUZURIAGA[c.id]);
    const asistieron = colaboradores.length - faltaron.length;
    // El fondo de multas de quienes faltaron se redistribuye entre quienes
    // sí asistieron, como bono (baja su cuota) -- no queda sin repartir.
    const bonoAsistencia = (faltaron.length * multaInasistencia) / asistieron;

    const planilla: DetalleLiquidacion[] = colaboradores.map((c) => {
      const asistio = ASISTENCIA_LUZURIAGA[c.id] ?? true;
      const monto = asistio ? cuotaBase - bonoAsistencia : cuotaBase + multaInasistencia;
      return { colaboradorId: c.id, nombre: c.nombre, rol: c.rol, asistio, monto };
    });

    const liquidacion: Liquidacion = {
      inventarioId: INVENTARIO_LUZURIAGA_ID,
      // Espeja al backend: proyectada hasta que se liquide.
      proyectada: !liquidados.has(INVENTARIO_LUZURIAGA_ID),
      periodo,
      periodoAnio,
      periodoMes,
      faltanteBruto,
      negativosDelMes,
      faltanteEmpresa,
      faltanteNeto,
      cuotaBase,
      multaInasistencia,
      bonoAsistencia,
      totalFaltas: faltaron.length,
      planilla,
      // Los datos en memoria salen de la maqueta, donde todos los ítems
      // tienen precio Y la asistencia de ASISTENCIA_LUZURIAGA ya está
      // completa (arriba): no hay nada que advertir. Se manda igual con
      // los tres flags en su valor "todo bien" en vez de omitirlos, así
      // la pantalla no tiene que preguntarse si el campo existe según de
      // dónde vengan los datos.
      advertencia: { itemsSinPrecio: 0, asistenciaSinRegistrar: false, ajustesSinRegistrar: false, mensaje: null },
    };
    return liquidacion;
  },

  /**
   * Mismo patrón que el backend (liquidacion.service.ts#conciliacion): parte
   * de `deSucursal` y desglosa de dónde sale el número, en vez de recalcular
   * la planilla desde cero con otra fórmula.
   */
  async conciliacion(sucursalId): Promise<Conciliacion | null> {
    const liquidacion = await liquidacionMemoria.deSucursal(sucursalId);
    if (liquidacion === null) return null;

    if (liquidacion.faltanteNeto === null || liquidacion.cuotaBase === null || liquidacion.totalFaltas === null) {
      return { calculable: false, periodo: liquidacion.periodo, advertencia: liquidacion.advertencia };
    }
    const { faltanteNeto, cuotaBase, totalFaltas, multaInasistencia, planilla } = liquidacion;

    const sumaPlanilla = redondear(planilla.reduce((total, p) => total + p.monto, 0));
    // Lo que EFECTIVAMENTE recibió cada asistente (cuotaBase - su monto),
    // no bonoAsistencia × asistentes: esa multiplicación es la que no
    // cerraba cuando el reparto no daba parejo.
    const repartido = redondear(planilla.filter((p) => p.asistio).reduce((total, p) => total + (cuotaBase - p.monto), 0));
    const recaudado = redondear(totalFaltas * multaInasistencia);

    return {
      calculable: true,
      periodo: liquidacion.periodo,
      faltanteNeto,
      sumaPlanilla,
      diferenciaPorRedondeo: redondear(faltanteNeto - sumaPlanilla),
      colaboradores: planilla.length,
      asistieron: planilla.length - totalFaltas,
      faltaron: totalFaltas,
      fondoDeMultas: {
        recaudado,
        repartido,
        diferencia: redondear(repartido - recaudado),
        cierra: redondear(repartido - recaudado) === 0,
      },
      advertencia: liquidacion.advertencia,
    };
  },

  /**
   * SIEMPRE sin importar: los ajustes entran por el Excel de Dynamics
   * (ajustes-negativos-api.ts), que no tiene variante en memoria, y PUT
   * /ajustes se borró del backend (2026-09-14). Inventar un monto importado
   * sería fabricar el dato que destraba la liquidación.
   */
  async ajustes(inventarioId): Promise<AjustesDelMes> {
    return sinRegistrar(inventarioId);
  },

  /**
   * Reproduce las guardas REALES del backend, no solo el camino feliz: sin el
   * Excel de ajustes importado rechaza igual que `liquidacion.cierre.ts`. Un
   * adaptador en memoria que siempre dice que sí hace que la pantalla se
   * pruebe contra un backend que no existe.
   */
  async liquidar(inventarioId): Promise<CierreLiquidacion> {
    await simularLatencia();

    if (liquidados.has(inventarioId)) {
      throw new Error(
        'La planilla de este inventario ya se cerró. Una liquidación no se recalcula: lo que se descontó ya se descontó.',
      );
    }
    const ajustes = await liquidacionMemoria.ajustes(inventarioId);
    if (ajustes.montoNegativos === null) {
      throw new Error(
        'No se puede cerrar la planilla todavía. Los ajustes del mes todavía no se cargaron: el faltante neto de esta planilla no los descuenta.',
      );
    }

    liquidados.add(inventarioId);
    const liquidacion = await liquidacionMemoria.deSucursal(SUCURSAL_LUZURIAGA_ID);
    const planilla = liquidacion?.planilla ?? [];

    return {
      inventarioId,
      estado: 'liquidado',
      colaboradores: planilla.length,
      cuotaBase: liquidacion?.cuotaBase ?? 0,
      bonoAsistencia: liquidacion?.bonoAsistencia ?? 0,
      faltantes: liquidacion?.totalFaltas ?? 0,
      totalDescontado: redondear(planilla.reduce((total, p) => total + p.monto, 0)),
    };
  },

  /**
   * SIN DATOS INVENTADOS: el reporte a gerencia sale de las diferencias reales
   * del inventario, y acá no hay ninguna. Una lista de cervezas de maqueta se
   * leería como un faltante de verdad. Se reproduce la guarda del backend
   * (sin liquidar no hay reporte) y, pasada esa, se dice que hace falta el
   * servidor -- mismo criterio que RepositorioHistorial, que no tiene memoria.
   */
  async reporteGerencia(inventarioId): Promise<ReporteGerencia> {
    await simularLatencia();
    if (!liquidados.has(inventarioId)) {
      throw new Error(
        'Este inventario todavía no se liquidó: la clasificación empresa/empleado recién queda fija al liquidar.',
      );
    }
    throw new Error(SIN_SERVIDOR_REPORTE);
  },

  async exportarReporteGerencia(): Promise<ArrayBuffer> {
    await simularLatencia();
    throw new Error(SIN_SERVIDOR_REPORTE);
  },
};
