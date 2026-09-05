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
import type { DetalleLiquidacion, Liquidacion, RepositorioLiquidacion } from '../puertos/repositorios';

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
};
