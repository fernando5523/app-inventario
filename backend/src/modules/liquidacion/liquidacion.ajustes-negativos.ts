/**
 * CABLEA el lector de `liquidacion.ajustes-dynamics.ts` a la base: reemplaza
 * el monto de negativos que se tipeaba a mano (liquidacion.ajustes.ts) por la
 * importación del Excel que el área de negativos ya carga en Dynamics.
 *
 * TRES PASOS, tres endpoints:
 *   1. `previsualizarAjustesNegativos` -- corre el lector y devuelve la vista
 *      previa (válidas, rechazadas, advertencias). NUNCA escribe nada: es la
 *      oportunidad del Auditor de ver el archivo antes de comprometerse.
 *   2. `confirmarAjustesNegativos` -- vuelve a leer el MISMO archivo y esta
 *      vez persiste: una `ImportacionAjustesDynamics` nueva (vigente), sus
 *      `LineaAjusteDynamics` (solo las VÁLIDAS -- una rechazada nunca tuvo
 *      datos utilizables para guardar, ver liquidacion.ajustes-dynamics.ts) y
 *      `ResultadoInventario.montoNegativos` = suma de esas líneas.
 *   3. `excluirLineaAjusteNegativo` / `incluirLineaAjusteNegativo` -- el
 *      Auditor saca o repone una línea puntual ("el área de negativos se
 *      equivoca en poner el motivo", Gilmer), con motivo obligatorio y quién,
 *      recalculando el monto.
 *
 * Sin estado intermedio entre preview y confirmar a propósito: confirmar
 * vuelve a leer el archivo que el cliente ya tiene en la mano (lo manda de
 * nuevo), en vez de guardar una vista previa "pendiente" en algún lado. Un
 * archivo de este tamaño se relee en milisegundos, y así no hay que inventar
 * un mecanismo de expiración para una vista previa que nadie confirmó.
 */

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { leerAjustesDynamics, type ResultadoLecturaAjustes } from './liquidacion.ajustes-dynamics';
import { validarEstadoParaAjustar } from './liquidacion.ajustes';
import { validarAcceso } from './liquidacion.permisos';

interface InventarioParaImportar {
  id: number;
  estado: string;
  periodoAnio: number;
  periodoMes: number;
  resultado: { id: number } | null;
  sucursal: { almacenId: string | null };
}

/** Mismo permiso y mismas fronteras de estado que el resto de los ajustes del mes (liquidacion.ajustes.ts#validarEstadoParaAjustar), más el dato que este flujo necesita del inventario: almacén y período, para que el lector sepa qué línea es "de otra tienda" o "fuera de período". */
async function inventarioParaImportar(
  actor: ColaboradorAutenticado,
  inventarioId: number,
): Promise<InventarioParaImportar & { sucursal: { almacenId: string } }> {
  validarAcceso(actor);

  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: {
      id: true,
      estado: true,
      periodoAnio: true,
      periodoMes: true,
      resultado: { select: { id: true } },
      sucursal: { select: { almacenId: true } },
    },
  });
  if (inventario === null) throw new NoEncontrado('Ese inventario no existe.');

  validarEstadoParaAjustar(inventario);

  if (inventario.sucursal.almacenId === null) {
    throw new Conflicto(
      'Esta sucursal no tiene un almacén de Dynamics configurado: no se puede saber qué líneas del Excel son de otra tienda.',
    );
  }

  return inventario as InventarioParaImportar & { sucursal: { almacenId: string } };
}

/** Paso 1: la vista previa. Nunca toca la base. */
export async function previsualizarAjustesNegativos(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  archivo: Buffer,
): Promise<ResultadoLecturaAjustes> {
  const inventario = await inventarioParaImportar(actor, inventarioId);

  return leerAjustesDynamics(archivo, {
    almacenEsperado: inventario.sucursal.almacenId,
    periodoAnio: inventario.periodoAnio,
    periodoMes: inventario.periodoMes,
  });
}

export interface ConfirmarAjustesNegativosDto {
  importacionId: number;
  inventarioId: number;
  nombreArchivo: string;
  importadoEn: string;
  cantidadValidas: number;
  cantidadRechazadas: number;
  /** SUMA de las líneas válidas -- 0 explícito si el archivo no tenía ninguna útil. */
  montoNegativos: number;
}

/** Paso 2: confirmar. Relee el archivo y, si es válido, persiste todo en una sola transacción. */
export async function confirmarAjustesNegativos(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  archivo: Buffer,
  nombreArchivo: string,
): Promise<ConfirmarAjustesNegativosDto> {
  const inventario = await inventarioParaImportar(actor, inventarioId);

  const resultado = await leerAjustesDynamics(archivo, {
    almacenEsperado: inventario.sucursal.almacenId,
    periodoAnio: inventario.periodoAnio,
    periodoMes: inventario.periodoMes,
  });

  if (!resultado.ok) {
    // El archivo entero, no una línea -- nunca se persiste nada de un archivo
    // que ni siquiera se pudo leer como corresponde (mismo criterio que
    // liquidacion.ajustes-dynamics.ts).
    throw new SolicitudInvalida(resultado.detalle);
  }

  const importadoEn = new Date();

  const importacion = await prisma.$transaction(async (tx) => {
    // La anterior deja de ser vigente ANTES de crear la nueva: el
    // `@@unique([inventarioId, vigente])` no tolera dos `true` a la vez, y
    // NUNCA se borra -- sus exclusiones firmadas siguen a la vista.
    await tx.importacionAjustesDynamics.updateMany({
      where: { inventarioId, vigente: true },
      data: { vigente: null },
    });

    const nueva = await tx.importacionAjustesDynamics.create({
      data: { inventarioId, nombreArchivo, importadoPorId: actor.colaboradorId, importadoEn, vigente: true },
    });

    // Solo las VÁLIDAS: una rechazada nunca tuvo datos utilizables para una
    // fila cuyo `importe` es NOT NULL en el esquema.
    if (resultado.validas.length > 0) {
      await tx.lineaAjusteDynamics.createMany({
        data: resultado.validas.map((linea) => ({
          importacionId: nueva.id,
          fila: linea.fila,
          diario: linea.diario,
          descripcion: linea.descripcion,
          almacen: linea.almacen,
          codigo: linea.codigo,
          nombre2: linea.nombre2,
          cantidad: linea.cantidad,
          precio: linea.precio,
          importe: linea.importe,
          motivoAjuste: linea.motivoAjuste,
          registradoEn: linea.registradoEn,
          responsable: linea.responsable,
        })),
      });
    }

    // `totalImporte` ya es la suma de las válidas -- ninguna está excluida
    // recién importada, así que coincide con "la suma de las NO excluidas".
    await tx.resultadoInventario.update({
      where: { inventarioId },
      data: { montoNegativos: resultado.totalImporte },
    });

    return nueva;
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.ajustes_negativos_importados',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: {
      nombreArchivo,
      lineasValidas: resultado.validas.length,
      lineasRechazadas: resultado.rechazadas.length,
      montoNegativos: resultado.totalImporte,
    },
  });

  return {
    importacionId: importacion.id,
    inventarioId,
    nombreArchivo,
    importadoEn: importadoEn.toISOString(),
    cantidadValidas: resultado.validas.length,
    cantidadRechazadas: resultado.rechazadas.length,
    montoNegativos: resultado.totalImporte,
  };
}

export interface LineaAjusteNegativoDto {
  id: number;
  fila: number;
  codigo: string;
  descripcion: string;
  importe: number;
  excluida: boolean;
  motivoExclusion: string | null;
  excluidaPor: { id: number; nombre: string } | null;
  excluidaEn: string | null;
}

interface LineaDb {
  id: number;
  fila: number;
  codigo: string;
  descripcion: string | null;
  importe: { toNumber(): number };
  excluida: boolean;
  motivoExclusion: string | null;
  excluidaEn: Date | null;
  excluidaPor: { id: number; nombre: string } | null;
}

function mapLinea(l: LineaDb): LineaAjusteNegativoDto {
  return {
    id: l.id,
    fila: l.fila,
    codigo: l.codigo,
    descripcion: l.descripcion ?? '',
    importe: l.importe.toNumber(),
    excluida: l.excluida,
    motivoExclusion: l.motivoExclusion,
    excluidaPor: l.excluidaPor,
    excluidaEn: l.excluidaEn?.toISOString() ?? null,
  };
}

/** La línea, validando que pertenezca a ESTE inventario y a su importación VIGENTE -- una de una importación reemplazada ya no es la que cuenta. */
async function lineaParaAlternar(actor: ColaboradorAutenticado, inventarioId: number, lineaId: number) {
  await inventarioParaImportar(actor, inventarioId);

  const linea = await prisma.lineaAjusteDynamics.findUnique({
    where: { id: lineaId },
    include: {
      importacion: { select: { id: true, inventarioId: true, vigente: true } },
      excluidaPor: { select: { id: true, nombre: true } },
    },
  });

  if (linea === null || linea.importacion.inventarioId !== inventarioId) {
    throw new NoEncontrado('Esa línea de ajuste no existe en este inventario.');
  }
  if (linea.importacion.vigente !== true) {
    throw new Conflicto('Esta línea pertenece a una importación que ya fue reemplazada: no se puede modificar.');
  }

  return linea;
}

async function recalcularMontoNegativos(importacionId: number, inventarioId: number): Promise<number> {
  const agregado = await prisma.lineaAjusteDynamics.aggregate({
    where: { importacionId, excluida: false },
    _sum: { importe: true },
  });
  // 0 EXPLÍCITO si no queda ninguna línea sin excluir -- mismo criterio que
  // el resto del flujo: "no hay líneas" nunca es indistinguible de "nadie miró".
  const montoNegativos = agregado._sum.importe?.toNumber() ?? 0;

  await prisma.resultadoInventario.update({ where: { inventarioId }, data: { montoNegativos } });

  return montoNegativos;
}

interface ResultadoAlternar {
  montoNegativos: number;
  linea: LineaAjusteNegativoDto;
}

/** Paso 3: excluir. Los cuatro campos de la exclusión se escriben JUNTOS -- ver LineaAjusteDynamics en el esquema. */
export async function excluirLineaAjusteNegativo(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  lineaId: number,
  motivo: string,
): Promise<ResultadoAlternar> {
  const linea = await lineaParaAlternar(actor, inventarioId, lineaId);

  const actualizada = await prisma.lineaAjusteDynamics.update({
    where: { id: lineaId },
    data: { excluida: true, excluidaPorId: actor.colaboradorId, excluidaEn: new Date(), motivoExclusion: motivo },
    include: { excluidaPor: { select: { id: true, nombre: true } } },
  });
  const montoNegativos = await recalcularMontoNegativos(linea.importacionId, inventarioId);

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.linea_ajuste_excluida',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { lineaId, motivo, montoNegativos },
  });

  return { montoNegativos, linea: mapLinea(actualizada) };
}

/**
 * Paso 3, la vuelta: reincluir una línea que se había excluido por error. Los
 * campos de la exclusión se LIMPIAN (no describen nada del estado actual: la
 * línea ya no está excluida) -- quién y por qué se reincluyó queda en el
 * registro de auditoría, igual que cada corrección de `liquidacion.ajustes.ts`.
 */
export async function incluirLineaAjusteNegativo(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  lineaId: number,
  motivo: string,
): Promise<ResultadoAlternar> {
  const linea = await lineaParaAlternar(actor, inventarioId, lineaId);

  const actualizada = await prisma.lineaAjusteDynamics.update({
    where: { id: lineaId },
    data: { excluida: false, excluidaPorId: null, excluidaEn: null, motivoExclusion: null },
    include: { excluidaPor: { select: { id: true, nombre: true } } },
  });
  const montoNegativos = await recalcularMontoNegativos(linea.importacionId, inventarioId);

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.linea_ajuste_incluida',
    entidad: 'inventario',
    entidadId: inventarioId,
    detalle: { lineaId, motivo, montoNegativos },
  });

  return { montoNegativos, linea: mapLinea(actualizada) };
}
