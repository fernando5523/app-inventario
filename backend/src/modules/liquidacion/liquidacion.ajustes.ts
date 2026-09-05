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
 * Esto es el eslabón que falta. Es MINIMO y reversible a propósito: dos
 * montos y una nota. Las reglas finas -- de dónde salen los ajustes, quién
 * los aprueba, si se cargan por ítem -- las define el cliente después, y
 * cuando lo haga esto se reemplaza sin tocar nada de lo que hay alrededor.
 *
 * ---------------------------------------------------------------------------
 * EL 0 EXPLICITO ES EL PUNTO
 * ---------------------------------------------------------------------------
 * Cargar `montoNegativos: 0` por acá NO es lo mismo que el NULL que deja el
 * cierre del conteo, y esa diferencia es toda la regla:
 *
 *   NULL → "nadie miró"           → no se puede liquidar
 *   0    → "alguien miró y no había" → se liquida normalmente
 *
 * El 0 vale porque lo escribió una persona identificada, en una fecha, con
 * una nota. Sin esas tres cosas sería el mismo cero cómodo que veníamos
 * evitando -- por eso los tres campos se escriben JUNTOS y la nota es
 * obligatoria.
 */

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarPuedeLiquidar } from './liquidacion.permisos';

export interface AjustesInput {
  /** Ajustes a favor del personal. `0` explícito es válido y significativo. */
  montoNegativos: number;
  /**
   * Faltante que absorbe la empresa. Opcional: si no viene, no se pisa el
   * calculado al cerrar el conteo.
   *
   * `| undefined` explícito, no solo `?`: el proyecto corre con
   * `exactOptionalPropertyTypes`, y el body validado por Zod llega con la
   * clave presente en `undefined`.
   */
  montoEmpresa?: number | undefined;
  nota: string;
}

export interface AjustesDto {
  inventarioId: number;
  montoNegativos: number;
  montoFaltanteEmpresa: number;
  nota: string;
  registradoPor: { id: number; nombre: string };
  registradoEn: string;
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

/** El inventario con lo necesario para decidir, validando sucursal y estado. */
async function inventarioParaAjustar(actor: ColaboradorAutenticado, inventarioId: number) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true, resultado: { select: { id: true } } },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

  // Mismo permiso que cerrar la planilla, y por la misma razón: quien carga
  // los ajustes está decidiendo cuánta plata NO se descuenta. El auditor
  // queda afuera -- es quien después firma el lacrado, y el sello incluye
  // esos montos (ver liquidacion.permisos.ts#validarPuedeLiquidar).
  validarPuedeLiquidar(actor, inventario.sucursalId);

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
        'Sin él no hay faltante sobre el que ajustar -- avisale a soporte.',
    );
  }

  const registradoEn = new Date();
  const actualizado = await prisma.resultadoInventario.update({
    where: { inventarioId },
    data: {
      montoNegativos: datos.montoNegativos,
      // Solo se pisa si vino: el calculado al cerrar el conteo sale de la
      // matriz real (categorías marcadas como `esEmpresa`), y sobrescribirlo
      // con un 0 por omisión borraría ese cálculo sin que nadie lo pida.
      ...(datos.montoEmpresa !== undefined ? { montoFaltanteEmpresa: datos.montoEmpresa } : {}),
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
    // El monto queda en el registro: es plata que se decidió no descontar, y
    // la pregunta "por qué agosto tuvo S/380 de ajustes" se contesta acá.
    detalle: {
      montoNegativos: datos.montoNegativos,
      ...(datos.montoEmpresa !== undefined ? { montoEmpresa: datos.montoEmpresa } : {}),
      nota: datos.nota,
    },
  });

  return {
    inventarioId,
    montoNegativos: actualizado.montoNegativos?.toNumber() ?? datos.montoNegativos,
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
