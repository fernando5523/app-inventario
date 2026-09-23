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
import { esDeTienda, sesionMemoria } from './sesion-memoria';
import { diasFaltados, multaPorInasistencia } from '../dominio/asistencia';
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

/**
 * CUÁNTOS DÍAS asistió cada uno, no si asistió.
 *
 * Era un `Record<number, boolean>` -- la asistencia se deducía de las hojas y
 * solo podía ser sí o no. Ahora el Coordinador la registra día por día, y la
 * multa es `días faltados x tarifa`: los tres que no vinieron completos deben
 * montos distintos, que es justo lo que el booleano no podía expresar.
 *
 * Solo Luzuriaga tiene datos de liquidación cargados (ver la cabecera).
 */
const DIAS_DEL_INVENTARIO_LUZURIAGA = 3;

/** id de colaborador (ver sesion-memoria.ts) -> días asistidos de los 3. */
const ASISTENCIA_LUZURIAGA: Record<number, number> = {
  101: 3, // José Tarazona
  102: 3, // María Rojas
  103: 3, // Gilmer Quispe
  104: 3, // Elena Príncipe
  105: 3, // Walter Norabuena
  106: 3, // Rosa Melgarejo
  107: 1, // Luis Shuan -- faltó 2 días
  108: 3, // Carla Depaz
  109: 2, // Manuel Chávez -- faltó 1 día
  110: 0, // Yeni Sotelo -- no vino ningún día
  111: 3, // Hugo Vergaray
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

    // SOLO personal de tienda: el auditor no entra a la nomina. Ver
    // `sesion-memoria.ts#seEligeEnLaTienda` -- se elige en la tienda, no
    // pertenece a ella.
    const colaboradores = (await sesionMemoria.colaboradores(sucursalId)).filter(esDeTienda);
    const { periodo, periodoAnio, periodoMes, faltanteBruto, negativosDelMes, faltanteEmpresa, multaInasistencia } = DATOS_LUZURIAGA;

    const faltanteNeto = faltanteBruto - negativosDelMes - faltanteEmpresa;
    const cuotaBase = faltanteNeto / colaboradores.length;

    const diasDelInventario = DIAS_DEL_INVENTARIO_LUZURIAGA;
    const diasDeCadaUno = colaboradores.map((c) => ({
      colaborador: c,
      // Sin dato en el padrón de demo se asume completo, igual que antes:
      // este mock no es el lugar donde inventar una falta.
      diasAsistidos: ASISTENCIA_LUZURIAGA[c.id] ?? diasDelInventario,
    }));

    // DOS CIFRAS DISTINTAS, con dos nombres distintos, y espejan al backend:
    //
    //  - `totalFaltas`: PERSONAS que no completaron el inventario. Es la que
    //    sostiene `asistieron + faltaron === colaboradores`. NO sirve para
    //    reconstruir el fondo.
    //  - `diasFaltadosEnTotal`: la suma de los días faltados de todos. ESTE es
    //    el multiplicando del fondo.
    //
    // Confundirlas es un bug real de integración: con una sola persona
    // faltando 2 de 3 días, `totalFaltas` es 1 y el fondo es S/40, no S/20.
    const diasFaltadosEnTotal = diasDeCadaUno.reduce(
      (total, d) => total + diasFaltados(diasDelInventario, d.diasAsistidos),
      0,
    );
    const totalFaltas = diasDeCadaUno.filter((d) => diasFaltados(diasDelInventario, d.diasAsistidos) > 0).length;
    // El bono lo cobra quien vino TODOS los días: es el premio por la jornada
    // completa, no por haber pasado un rato.
    const conJornadaCompleta = diasDeCadaUno.length - totalFaltas;
    // El fondo de multas se redistribuye entre ellos, como bono (baja su
    // cuota) -- no queda sin repartir.
    const fondoMultas = diasFaltadosEnTotal * multaInasistencia;
    const bonoAsistencia = fondoMultas / conJornadaCompleta;

    const planilla: DetalleLiquidacion[] = diasDeCadaUno.map(({ colaborador, diasAsistidos }) => {
      // La MISMA función que va a usar la pantalla para desglosar la fila: si
      // el mock calculara la multa por su cuenta, la demo mostraría un monto
      // que su propio desglose no explica.
      const multa = multaPorInasistencia(diasDelInventario, diasAsistidos, multaInasistencia);
      const asistio = multa === 0;
      return {
        colaboradorId: colaborador.id,
        nombre: colaborador.nombre,
        rol: colaborador.rol,
        asistio,
        diasAsistidos,
        monto: cuotaBase + multa - (asistio ? bonoAsistencia : 0),
      };
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
      diasDelInventario,
      totalFaltas,
      diasFaltadosEnTotal,
      fondoMultas,
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
    const { faltanteNeto, cuotaBase, totalFaltas, planilla } = liquidacion;

    const sumaPlanilla = redondear(planilla.reduce((total, p) => total + p.monto, 0));
    // Lo que EFECTIVAMENTE recibió cada asistente (cuotaBase - su monto),
    // no bonoAsistencia × asistentes: esa multiplicación es la que no
    // cerraba cuando el reparto no daba parejo.
    const repartido = redondear(planilla.filter((p) => p.asistio).reduce((total, p) => total + (cuotaBase - p.monto), 0));
    // El fondo YA VIENE CALCULADO: no se rearma con una multiplicación.
    // Multiplicar `totalFaltas` (personas) por la tarifa POR DÍA daba de menos
    // en cuanto alguien faltara más de un día, y es el bug que se arregló acá.
    const recaudado = redondear(liquidacion.fondoMultas ?? 0);

    return {
      calculable: true,
      periodo: liquidacion.periodo,
      faltanteNeto,
      sumaPlanilla,
      diferenciaPorRedondeo: redondear(faltanteNeto - sumaPlanilla),
      colaboradores: planilla.length,
      // Se cuentan sobre la planilla y no restando `totalFaltas`: es la
      // misma unidad, pero contar es lo que garantiza que los dos sumen el
      // padrón entero (el "-2" del 2026-09-05 salió justo de esa resta).
      asistieron: planilla.filter((p) => p.asistio).length,
      faltaron: planilla.filter((p) => !p.asistio).length,
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
      // Espeja `totalFaltas`: PERSONAS que no completaron el inventario.
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
