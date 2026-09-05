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
  Conciliacion,
  DatosAjustes,
  DetalleLiquidacion,
  Liquidacion,
  RepositorioLiquidacion,
} from '../puertos/repositorios';

/** Espeja historial.calculos.ts#redondear (2 decimales) -- no existe una lib compartida entre backend y mobile. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ajustes cargados en esta corrida. Arranca VACÍO a propósito: sin backend,
 * el estado inicial tiene que ser el real —"nadie los cargó"— para poder ver
 * la pantalla bloqueada y después destrabarla cargándolos.
 */
const ajustesCargados = new Map<number, AjustesDelMes>();

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
  ajustesCargados.clear();
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
    const { periodo, faltanteBruto, negativosDelMes, faltanteEmpresa, multaInasistencia } = DATOS_LUZURIAGA;

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
      periodo,
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
   * Los ajustes viven en un Map del módulo, no en el dataset fijo: son lo
   * único de este adaptador que CAMBIA en tiempo de ejecución, y ese cambio
   * es justo lo que hay que poder ver sin backend — cargar un monto y que la
   * pantalla pase de "sin registrar" a mostrar la planilla.
   */
  async ajustes(inventarioId): Promise<AjustesDelMes> {
    return ajustesCargados.get(inventarioId) ?? sinRegistrar(inventarioId);
  },

  async registrarAjustes(inventarioId, datos: DatosAjustes): Promise<AjustesDelMes> {
    await simularLatencia();

    const previo = ajustesCargados.get(inventarioId);
    const registrado: AjustesDelMes = {
      inventarioId,
      registrado: true,
      montoNegativos: datos.montoNegativos,
      // Omitirlo CONSERVA lo que había, igual que el backend: sale de las
      // categorías de empresa del catálogo y pisarlo con 0 por omisión
      // borraría ese cálculo.
      montoFaltanteEmpresa: datos.montoEmpresa ?? previo?.montoFaltanteEmpresa ?? 170,
      nota: datos.nota,
      registradoPor: { id: 101, nombre: 'Nancy Quispe' },
      registradoEn: new Date().toISOString(),
    };

    ajustesCargados.set(inventarioId, registrado);
    return registrado;
  },
};
