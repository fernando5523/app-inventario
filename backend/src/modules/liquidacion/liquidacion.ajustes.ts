/**
 * LOS AJUSTES DEL MES: lo único que faltaba para poder cerrar el mes.
 *
 * `ResultadoInventario.montoNegativos` existía desde el primer día y nadie
 * podía escribirlo: no había endpoint, ni pantalla, ni tabla. Como NULL
 * significa "no se capturó" (nunca "no hubo"), `liquidacion.cierre.ts`
 * rechazaba con 409 SIEMPRE y la cadena del negocio se cortaba ahí:
 *
 *   contar → cerrar rondas → conteo_cerrado ✅ → liquidar ❌ → lacrar ❌
 *
 * ---------------------------------------------------------------------------
 * MONTONEGATIVOS YA NO SE CARGA ACÁ (2026-09-11)
 * ---------------------------------------------------------------------------
 * Nació como un monto tipeado a mano porque no había otra fuente. Ahora la
 * fuente real es el Excel de Dynamics que sube el Auditor -- ver
 * `liquidacion.ajustes-negativos.ts`, que reemplaza por completo esta forma
 * de cargarlo. Un número tipeado a mano por acá encima de líneas importadas y
 * auditadles sería el mismo cero cómodo que este archivo existía para evitar.
 * Los inventarios YA liquidados con un monto tipeado a mano en su momento
 * siguen leyéndose igual (`estadoDeAjustes` no cambia): no se reprocesan.
 *
 * ---------------------------------------------------------------------------
 * MONTOEMPRESA TAMPOCO SE CARGA ACÁ (2026-09-14)
 * ---------------------------------------------------------------------------
 * Nació como el mismo tipo de monto agregado que `montoNegativos`: un número
 * que el Coordinador (después el Auditor) tipeaba a mano encima del calculado
 * al cerrar el conteo. Dejó de tener sentido el mismo día que
 * `liquidacion.cierre.ts#liquidar` empezó a RECALCULAR `montoFaltanteEmpresa`
 * a partir de la clasificación vigente (`ClasificacionProducto`, ver
 * liquidacion.reclasificacion.ts) -- decisión del cliente: el Auditor
 * clasifica PRODUCTOS, no corrige un total. Con las dos fuentes activas a la
 * vez, `liquidar()` pisaba en silencio cualquier monto tipeado acá: un dato
 * que se acepta y después se ignora es peor que un dato que no se acepta.
 *
 * Los inventarios YA LIQUIDADOS con un `montoFaltanteEmpresa` tipeado a mano
 * en su momento (antes de este cambio) NO se reprocesan: `liquidar()` nunca
 * vuelve a tocar un inventario que ya está `liquidado`/`lacrado` (ver la
 * guarda al principio de esa función), así que ese valor histórico queda
 * exactamente como se firmó.
 *
 * Este archivo se queda con lo único que sigue siendo manual: la nota y el
 * registro de quién/cuándo tocó los ajustes del mes.
 *
 * ---------------------------------------------------------------------------
 * EL 0 EXPLICITO SIGUE SIENDO EL PUNTO -- ahora en el Excel, no acá
 * ---------------------------------------------------------------------------
 *   NULL → "nadie miró"              → no se puede liquidar
 *   0    → "alguien miró y no había" → se liquida normalmente
 *
 * `liquidacion.ajustes-negativos.ts` sostiene esa misma diferencia con la
 * importación del Excel en vez de con un monto tipeado.
 */

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';

import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarAcceso } from './liquidacion.permisos';

export interface AjustesInput {
  nota: string;
}

export interface AjustesDto {
  inventarioId: number;
  /** Lo que haya en `ResultadoInventario` hoy -- lo escribe la importación del Excel, no este endpoint. `null` si todavía no se importó nada. */
  montoNegativos: number | null;
  montoFaltanteEmpresa: number;
  nota: string;
  registradoPor: { id: number; nombre: string };
  registradoEn: string;
}

/**
 * Las tres fronteras de estado para tocar los ajustes del mes, compartidas
 * con `liquidacion.ajustes-negativos.ts` (la importación del Excel entra por
 * la misma puerta que el monto de empresa: ambas son "ajustes del mes").
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
 * `null` en `registradoEn` = nadie los cargó todavía. Se devuelve el estado
 * completo y no un booleano porque quien va a firmar la planilla necesita
 * ver QUIÉN los cargó y CUÁNDO, no solo que están.
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

/** El inventario con lo necesario para decidir, validando permiso y estado. */
async function inventarioParaAjustar(actor: ColaboradorAutenticado, inventarioId: number) {
  // Mismo permiso que el resto de la liquidación: quien carga los ajustes
  // está decidiendo cuánta plata NO se descuenta, y eso es del auditor (ver
  // liquidacion.permisos.ts). ANTES de tocar la base: a quien no tiene acceso
  // no se le dice ni si el inventario existe.
  validarAcceso(actor);

  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, estado: true, resultado: { select: { id: true } } },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

  return inventario;
}

/**
 * Carga (o corrige) los ajustes del mes.
 *
 * SOLO EN `conteo_cerrado`, o sea DESPUÉS de que las cantidades quedaron
 * fijas y ANTES de liquidar. Las dos fronteras importan:
 *
 *  · antes del cierre, el faltante todavía puede cambiar en el 2do o 3er
 *    conteo, así que un ajuste cargado ahí se calcularía contra un número
 *    que no es el definitivo;
 *  · después de liquidar, la planilla ya está firmada y el recibo de sueldo
 *    salió -- cambiar los ajustes movería un descuento que ya se hizo.
 *
 * Se puede volver a cargar mientras siga en `conteo_cerrado`: corregir un
 * monto mal tipeado antes de liquidar tiene que ser posible, y cada
 * corrección pisa la firma anterior y queda en el registro de auditoría.
 */
export async function registrarAjustes(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  datos: AjustesInput,
): Promise<AjustesDto> {
  const inventario = await inventarioParaAjustar(actor, inventarioId);
  validarEstadoParaAjustar(inventario);

  const registradoEn = new Date();
  const actualizado = await prisma.resultadoInventario.update({
    where: { inventarioId },
    data: {
      // `montoFaltanteEmpresa` NO se toca desde acá -- lo recalcula
      // `liquidar()` a partir de la clasificación vigente al momento de
      // liquidar (ver el comentario de cabecera de este archivo).
      ajustesPorId: actor.colaboradorId,
      ajustesEn: registradoEn,
      ajustesNota: datos.nota,
    },
    include: { ajustesPor: { select: { id: true, nombre: true } } },
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.ajustes_registrados',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { nota: datos.nota },
  });

  return {
    inventarioId,
    montoNegativos: actualizado.montoNegativos?.toNumber() ?? null,
    montoFaltanteEmpresa: actualizado.montoFaltanteEmpresa.toNumber(),
    nota: actualizado.ajustesNota ?? datos.nota,
    registradoPor: actualizado.ajustesPor ?? { id: actor.colaboradorId, nombre: '' },
    registradoEn: (actualizado.ajustesEn ?? registradoEn).toISOString(),
  };
}

/** Qué ajustes tiene cargados ese inventario. */
export async function estadoDeAjustes(
  actor: ColaboradorAutenticado,
  inventarioId: number,
): Promise<EstadoAjustesDto> {
  const inventario = await inventarioParaAjustar(actor, inventarioId);

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
    // liquidación es el monto. Si algún día hay una fila con monto y sin
    // firma (una carga por script, una migración), la pantalla tiene que
    // decir la verdad sobre lo que hay.
    registrado: resultado.montoNegativos !== null,
    montoNegativos: resultado.montoNegativos?.toNumber() ?? null,
    montoFaltanteEmpresa: resultado.montoFaltanteEmpresa.toNumber(),
    nota: resultado.ajustesNota,
    registradoPor: resultado.ajustesPor,
    registradoEn: resultado.ajustesEn?.toISOString() ?? null,
  };
}
