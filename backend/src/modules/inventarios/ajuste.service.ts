/**
 * EL AJUSTE FINAL DEL AUDITOR, item por item:
 * `PATCH /api/inventarios/:id/ajuste/:productoId`.
 *
 * Pedido del cliente: "el auditor tiene un conteo final de ajuste, puede
 * cambiar los valores contados del ultimo conteo, VIENDO EL STOCK".
 *
 * ---------------------------------------------------------------------------
 * ESTE ES EL UNICO LUGAR DEL SISTEMA DONDE SE ESCRIBE MIRANDO EL ERP
 * ---------------------------------------------------------------------------
 * Todo lo demas -- crear hojas, contar, recontar, corregir -- deja el stock
 * afuera a proposito: es el conteo ciego, y es la razon por la que existen
 * varias pasadas cruzadas. Aca se levanta, y se puede levantar porque ya no
 * queda nadie contando: el inventario esta en `ajuste_auditor`, las hojas
 * estan finalizadas y el Coordinador quedo bloqueado (`ajuste.permisos.ts`).
 *
 * Por eso el ajuste es un ESTADO y no "la correccion, pero del auditor": la
 * diferencia entre las dos operaciones no es quien las hace, es que una ve el
 * numero del ERP y la otra no. Si fueran el mismo endpoint con otro permiso,
 * un dia alguien le abriria la respuesta al Coordinador sin darse cuenta de
 * lo que estaria abriendo.
 *
 * Vive aparte de `rondas.service.ts` porque escribe otra cosa: aquel mueve el
 * estado del inventario y crea hojas, este escribe una fila de `Conteo`.
 */

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { totalUnidades, validarFactores } from '../hojas/hojas.calculos';
import type { ConteoDto } from '../hojas/hojas.service';
import { validarAjusteEnCurso, type EstadoConAjuste } from './ajuste.permisos';
import type { AjustarConteoInput } from './inventarios.schema';

export interface AjusteDeConteoDto {
  conteo: ConteoDto;
  /** Unidades que quedan tras el ajuste. */
  total: number;
  /** Las que habia antes: lo que el Auditor acaba de pisar. */
  totalAnterior: number;
  /**
   * EL STOCK DEL ERP. Va en esta respuesta y en ninguna otra del flujo de
   * conteo -- ver la cabecera. `null` = el snapshot no lo trajo, y entonces
   * este item no se puede auditar (nunca 0: "no se" no es "cero").
   */
  stockErp: number | null;
  /** `total - stockErp`. Negativo = faltante. `null` si no hay con que comparar. */
  diferencia: number | null;
}

/**
 * Ajusta el conteo de un producto de la ULTIMA ronda.
 *
 * "Ultima ronda" y no "cualquiera" porque es lo que pidio el cliente: el
 * ajuste corrige el ultimo conteo. Tiene una consecuencia que conviene tener
 * escrita: un item que cuadro en la ronda 1 no esta en las hojas de la
 * ultima, asi que no se puede ajustar. Es coherente -- cuadro contra el ERP,
 * no hay nada que ajustarle -- pero si alguna vez el cliente pide tocar
 * cualquier item, el cambio es acá y no es chico.
 */
export async function ajustarConteo(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  productoId: number,
  input: AjustarConteoInput,
): Promise<AjusteDeConteoDto> {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true },
  });
  if (!inventario) throw new NoEncontrado('Ese inventario no existe.');

  validarAjusteEnCurso(
    actor,
    { sucursalId: inventario.sucursalId, estado: inventario.estado as EstadoConAjuste },
    'ajustar un conteo',
  );

  const { _max } = await prisma.hojaConteo.aggregate({
    where: { inventarioId },
    _max: { numeroConteo: true },
  });
  const ultimaRonda = _max.numeroConteo;
  if (ultimaRonda === null) {
    throw new NoEncontrado('Este inventario todavía no tiene hojas: no hay nada que ajustar.');
  }

  /**
   * El producto tiene que ser de ESTE inventario y de la ULTIMA ronda. Las
   * dos condiciones en el `where` y no chequeadas despues: sin `inventarioId`
   * se ajustaria el inventario de otra tienda con un id de la URL, y sin
   * `numeroConteo` se escribiria sobre la hoja de una ronda vieja -- que la
   * matriz igual leeria (lee todas), pero cuyo valor quedaria tapado por el
   * de la ronda mas nueva. El Auditor veria "guardado" y el numero no
   * cambiaria en ningun lado.
   */
  const producto = await prisma.producto.findFirst({
    where: { id: productoId, hoja: { inventarioId, numeroConteo: ultimaRonda } },
    select: { id: true, codigo: true, hojaId: true, empaques: { select: { nombre: true, factor: true } } },
  });
  if (!producto) {
    throw new NoEncontrado(
      `Ese producto no pertenece a la última ronda (${ultimaRonda}) de este inventario. ` +
        'El ajuste final corrige los valores del último conteo.',
    );
  }

  // Las hojas de la ultima ronda estan finalizadas -- `iniciarAjuste` lo
  // exige -- y `finalizar` no deja cerrar una hoja con renglones sin contar,
  // asi que esto siempre existe. Se chequea igual: si alguna vez no existe,
  // mejor enterarse que escribir un conteo que nadie cargo.
  const anterior = await prisma.conteo.findUnique({
    where: { hojaId_productoId: { hojaId: producto.hojaId, productoId } },
    include: { empaques: true },
  });
  if (!anterior) {
    throw new Conflicto('Ese producto no tiene ningún conteo en la última ronda: no hay valor que ajustar.');
  }

  validarFactores(producto.empaques);
  const totalAnterior = totalUnidades(anterior, producto.empaques);
  // Antes de escribir: si una linea nombra un empaque que el producto no
  // tiene, `totalUnidades` tira y no se persiste nada a medias.
  const total = totalUnidades(input, producto.empaques);

  const conteo = await prisma.conteo.update({
    where: { hojaId_productoId: { hojaId: producto.hojaId, productoId } },
    data: {
      sueltas: input.sueltas,
      // El Auditor teclea el numero que decidio mirando el ERP: no escaneo
      // nada. Mismo criterio que la correccion del Coordinador.
      confirmadoPorEscaner: false,
      // `contadoEn` intacto: es cuando se conto en la gondola. El instante
      // del ajuste queda en el registro de auditoria.
      empaques: { deleteMany: {}, create: input.empaques.map((l) => ({ empaqueNombre: l.empaqueNombre, cantidad: l.cantidad })) },
    },
    include: { empaques: true },
  });

  // El stock sale de `CatalogoItem` -- el snapshot del arranque --, nunca de
  // Dynamics en vivo: el inventario se compara contra la foto del arranque.
  const item = await prisma.catalogoItem.findFirst({
    where: { inventarioId, codigo: producto.codigo },
    select: { stockErp: true },
  });
  const stockErp = item?.stockErp ?? null;

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'conteo.ajustado',
    entidad: 'conteo',
    entidadId: conteo.id,
    detalle: {
      productoId,
      codigo: producto.codigo,
      ronda: ultimaRonda,
      valorAnterior: totalAnterior,
      valorNuevo: total,
      motivo: input.motivo,
    },
  });

  return {
    conteo: {
      productoId: conteo.productoId,
      empaques: conteo.empaques.map((l) => ({ empaqueNombre: l.empaqueNombre, cantidad: l.cantidad })),
      sueltas: conteo.sueltas,
      confirmadoPorEscaner: conteo.confirmadoPorEscaner,
      contadoEn: conteo.contadoEn.toISOString(),
    },
    total,
    totalAnterior,
    stockErp,
    // null y NO 0 cuando falta el stock: un 0 dice "conte exactamente lo que
    // decia el ERP", que es una afirmacion fuerte, y no puede ser tambien el
    // valor de "no tengo idea" (ver auditoria.calculos.ts).
    diferencia: stockErp === null ? null : total - stockErp,
  };
}
