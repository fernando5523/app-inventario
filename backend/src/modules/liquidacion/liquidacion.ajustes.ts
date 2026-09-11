/**
 * LOS AJUSTES DEL MES: su ESTADO (lectura) y las fronteras de estado que usa
 * la importación del Excel.
 *
 * `ResultadoInventario.montoNegativos` existía desde el primer día y nadie
 * podía escribirlo: no había endpoint, ni pantalla, ni tabla. Como NULL
 * significa "no se capturó" (nunca "no hubo"), `liquidacion.cierre.ts`
 * rechazaba con 409 SIEMPRE y la cadena del negocio se cortaba ahí:
 *
 *   contar → cerrar rondas → conteo_cerrado ✅ → liquidar ❌ → lacrar ❌
 *
 * ---------------------------------------------------------------------------
 * YA NO SE ESCRIBE NADA ACÁ (2026-09-14)
 * ---------------------------------------------------------------------------
 * PUT /ajustes (`registrarAjustes`) se borró. Llegó a cargar tres cosas, y las
 * tres tienen hoy otra fuente o ninguna:
 *  - `montoNegativos`: lo escribe la importación del Excel de Dynamics
 *    (liquidacion.ajustes-negativos.ts), que reemplazó al monto tipeado;
 *  - `montoFaltanteEmpresa`: lo recalcula `liquidar()` desde la clasificación
 *    de productos (liquidacion.reclasificacion.ts);
 *  - la nota, con quién y cuándo (`ajustesNota`/`ajustesPorId`/`ajustesEn`):
 *    documentaba esos montos escritos a mano, y sin ellos no documentaba
 *    nada. No la lee el historial ni el sello, y la guarda de `liquidar()`
 *    solo mira `montoNegativos` (liquidacion.cierre.ts): sacarla no bloquea
 *    ninguna liquidación.
 *
 * Las columnas NO se borraron: los inventarios viejos tienen notas firmadas, y
 * `estadoDeAjustes` las sigue devolviendo tal cual se guardaron.
 *
 * ---------------------------------------------------------------------------
 * EL 0 EXPLICITO SIGUE SIENDO EL PUNTO -- ahora en el Excel
 * ---------------------------------------------------------------------------
 *   NULL → "nadie importó"         → no se puede liquidar
 *   0    → "se importó y no había" → se liquida normalmente
 */

import { prisma } from '../../config/database';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarAcceso } from './liquidacion.permisos';

/**
 * Las tres fronteras de estado para tocar los ajustes del mes. Las usa
 * `liquidacion.ajustes-negativos.ts` para la importación del Excel.
 *
 *  · antes del cierre, el faltante todavía puede cambiar en el 2do o 3er
 *    conteo, así que un ajuste cargado ahí se calcularía contra un número
 *    que no es el definitivo;
 *  · después de liquidar, la planilla ya está firmada y el recibo de sueldo
 *    salió -- cambiar los ajustes movería un descuento que ya se hizo.
 */
export function validarEstadoParaAjustar(inventario: {
  estado: string;
  resultado: { id: number } | null;
}): void {
  if (inventario.estado === 'liquidado' || inventario.estado === 'lacrado') {
    throw new Conflicto(
      'La planilla de este inventario ya se cerró: los ajustes no se pueden cambiar. ' +
        'Lo que se descontó ya se descontó, y cualquier corrección entra en el periodo siguiente.',
    );
  }
  if (inventario.estado !== 'conteo_cerrado') {
    throw new Conflicto(
      'Todavía no se pueden cargar los ajustes: el conteo sigue abierto. ' +
        'El faltante puede cambiar en el 2do o 3er conteo, así que primero hay que cerrar la última ronda.',
    );
  }
  if (inventario.resultado === null) {
    throw new Conflicto(
      'El inventario está cerrado pero no tiene resultado calculado. ' +
        'Sin él no hay faltante sobre el que ajustar: avísale a soporte.',
    );
  }
}

/**
 * Estado de los ajustes de un inventario, para que la pantalla sepa qué
 * mostrar antes de que alguien intente liquidar.
 *
 * `nota`/`registradoPor`/`registradoEn` solo existen en inventarios de antes
 * del 2026-09-14 (los escribía el PUT borrado): se devuelven tal cual se
 * guardaron, y `null` en todos los demás.
 */
export interface EstadoAjustesDto {
  inventarioId: number;
  registrado: boolean;
  montoNegativos: number | null;
  montoFaltanteEmpresa: number | null;
  nota: string | null;
  registradoPor: { id: number; nombre: string } | null;
  registradoEn: string | null;
}

/** El inventario, validando el permiso ANTES de tocar la base. */
async function inventarioParaAjustar(actor: ColaboradorAutenticado, inventarioId: number) {
  // Mismo permiso que el resto de la liquidación: los ajustes deciden cuánta
  // plata NO se descuenta, y eso es del auditor (liquidacion.permisos.ts). A
  // quien no tiene acceso no se le dice ni si el inventario existe.
  validarAcceso(actor);

  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, estado: true, resultado: { select: { id: true } } },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

  return inventario;
}

/** Qué ajustes tiene ese inventario. */
export async function estadoDeAjustes(
  actor: ColaboradorAutenticado,
  inventarioId: number,
): Promise<EstadoAjustesDto> {
  await inventarioParaAjustar(actor, inventarioId);

  const resultado = await prisma.resultadoInventario.findUnique({
    where: { inventarioId },
    include: { ajustesPor: { select: { id: true, nombre: true } } },
  });

  if (resultado === null) {
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

  return {
    inventarioId,
    // `montoNegativos !== null` y no `ajustesEn !== null`: lo que destraba la
    // liquidación es el monto, que hoy escribe el Excel. La nota con su firma
    // es historia de los inventarios viejos.
    registrado: resultado.montoNegativos !== null,
    montoNegativos: resultado.montoNegativos?.toNumber() ?? null,
    montoFaltanteEmpresa: resultado.montoFaltanteEmpresa.toNumber(),
    nota: resultado.ajustesNota,
    registradoPor: resultado.ajustesPor,
    registradoEn: resultado.ajustesEn?.toISOString() ?? null,
  };
}
