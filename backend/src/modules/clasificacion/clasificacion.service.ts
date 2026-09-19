/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * usuarios.service.ts). La regla de "quien puede" vive en
 * clasificacion.permisos.ts -- pura, sin Prisma.
 *
 * ---------------------------------------------------------------------------
 * DE DONDE SALEN LOS PRODUCTOS BUSCABLES
 * ---------------------------------------------------------------------------
 * Del CATALOGO que ya esta en la base: los `codigo` distintos de
 * `CatalogoItem` (los snapshots de Dynamics ya tomados), tomando de cada uno
 * su fila MAS reciente (mayor `inventarioId`) para mostrar la descripcion,
 * categoria y responsable frescos. Tres razones:
 *   - `codigo` (ItemNumber) es la identidad estable entre periodos, y es
 *     justo por lo que se clasifica (ClasificacionProducto.codigo @unique);
 *   - son los productos que REALMENTE se inventariaron -- exactamente el
 *     conjunto que el Auditor necesita clasificar;
 *   - no hay llamada viva a Dynamics: la clasificacion es un flujo de base,
 *     se evalua al liquidar contra el catalogo, no contra el ERP de hoy.
 *
 * DOS DATOS QUE NO SE PISAN (pedido explicito): por producto se muestra lo que
 * dice Dynamics (`responsableDynamics`, del snapshot) Y lo que decidio el
 * Auditor (`clasificacion`, la fila viva de ClasificacionProducto), separados.
 */

import { Prisma, type ClaseItem, type ResponsableItem } from '@prisma/client';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarPermisoDeClasificacion } from './clasificacion.permisos';
import type { BuscarQuery, ClasificarInput } from './clasificacion.schema';

/** La decision del Auditor sobre un codigo (la fila viva de ClasificacionProducto). */
export interface ClasificacionDto {
  codigo: string;
  /**
   * true = lo asume la empresa (excepcion a Dynamics); false = del empleado.
   *
   * SE DERIVA de `clase` desde que la excepcion es de tres vias, y sigue
   * existiendo porque la leen la auditoria, la liquidacion y el SELLO del
   * lacrado. Mientras las dos viajen NO PUEDEN DISCREPAR.
   */
  esEmpresa: boolean;
  /**
   * LA EXCEPCION A TRES VIAS. `null` = excepcion VIEJA, cargada antes de este
   * cambio: la sigue mandando `esEmpresa` y NO se reinterpreta sola -- meterle
   * un valor aca seria inventar una decision que el Auditor nunca tomo.
   */
  clase: ClaseItem | null;
  /**
   * El empaque de compra que el Auditor corrigio a mano. `null` = sin
   * corregir: manda `ProductoClasificableDto.empaqueCompra`, el del snapshot.
   *
   * Los DOS numeros viajan juntos y separados a proposito: es lo que permite
   * responder "el ERP dijo 1 y el Auditor lo corrigio a 12 el 19/09" en vez de
   * un numero sin historia.
   */
  empaqueCompraCorregido: number | null;
  nota: string | null;
  clasificadoPorId: number;
  clasificadoEn: string;
}

/** Un producto del catalogo, con lo de Dynamics y lo del Auditor por separado. */
export interface ProductoClasificableDto {
  codigo: string;
  descripcion: string;
  categoria: string | null;
  /** Lo que dice DYNAMICS (snapshot). El Auditor NO lo pisa. `null` = D365 dijo 'None'. */
  responsableDynamics: ResponsableItem | null;
  /**
   * La clase DERIVADA POR EL SNAPSHOT (CatalogoItem.clase): que haria el
   * sistema si el Auditor no pusiera excepcion. Va al lado de
   * `responsableDynamics` y por el mismo motivo -- lo del ERP y lo del Auditor
   * separados, ninguno pisa al otro. Sin esto, la pantalla ofreceria tres vias
   * sin decir cual es la que ya estaba.
   */
  claseDynamics: ClaseItem;
  /**
   * EL EMPAQUE DE COMPRA, que es el denominador del umbral por paquete.
   *
   * Viaja aca porque elegir "paquete" sin verlo es elegir a ciegas: el Auditor
   * tiene que poder ver contra que se va a medir ANTES de decidir. `null` = el
   * snapshot no lo pudo resolver, y NULL no es 1 (ver
   * schema.prisma#CatalogoItem.empaqueCompra): sin ese dato el umbral no se
   * puede aplicar, y la pantalla tiene que decirlo en vez de dejar elegir
   * "paquete" como si nada.
   */
  empaqueCompra: number | null;
  /** El simbolo tal cual lo tiene Dynamics ("Emp.12", "CJ"), para poder auditar de donde salio el numero. */
  empaqueCompraSimbolo: string | null;
  /** Lo que decidio el AUDITOR, o `null` si no hay excepcion (manda Dynamics). */
  clasificacion: ClasificacionDto | null;
}

export interface ListadoProductosDto {
  total: number;
  limite: number;
  desplazamiento: number;
  productos: ProductoClasificableDto[];
}

type FilaClasificacion = {
  codigo: string;
  esEmpresa: boolean;
  clase: ClaseItem | null;
  empaqueCompraCorregido: number | null;
  nota: string | null;
  clasificadoPorId: number;
  clasificadoEn: Date;
};

type FilaCatalogo = {
  codigo: string;
  descripcion: string;
  categoria: string | null;
  responsable: ResponsableItem | null;
  clase: ClaseItem;
  empaqueCompra: number | null;
  empaqueCompraSimbolo: string | null;
};

function aClasificacionDto(c: FilaClasificacion): ClasificacionDto {
  return {
    codigo: c.codigo,
    esEmpresa: c.esEmpresa,
    clase: c.clase,
    empaqueCompraCorregido: c.empaqueCompraCorregido,
    nota: c.nota,
    clasificadoPorId: c.clasificadoPorId,
    clasificadoEn: c.clasificadoEn.toISOString(),
  };
}

function aProductoDto(item: FilaCatalogo, clasificacion: FilaClasificacion | undefined): ProductoClasificableDto {
  return {
    codigo: item.codigo,
    descripcion: item.descripcion,
    categoria: item.categoria,
    responsableDynamics: item.responsable,
    claseDynamics: item.clase,
    empaqueCompra: item.empaqueCompra,
    empaqueCompraSimbolo: item.empaqueCompraSimbolo,
    clasificacion: clasificacion ? aClasificacionDto(clasificacion) : null,
  };
}

/**
 * `esEmpresa` SE DERIVA de la clase, nunca llega del cuerpo.
 *
 * Es lo que hace que la invariante (`clase == 'empresa'` <=> `esEmpresa`) se
 * cumpla POR CONSTRUCCION: no hay forma de escribir una sin la otra ni de que
 * un cliente las mande discrepando. Una funcion de una linea y con nombre para
 * que la regla tenga UN lugar, y no dos upserts recordando hacer lo mismo.
 */
function esEmpresaDe(clase: ClaseItem): boolean {
  return clase === 'empresa';
}

export async function buscar(actor: ColaboradorAutenticado, query: BuscarQuery): Promise<ListadoProductosDto> {
  validarPermisoDeClasificacion(actor);

  const condiciones: Prisma.CatalogoItemWhereInput[] = [];
  if (query.q) {
    condiciones.push({
      OR: [
        { codigo: { contains: query.q, mode: 'insensitive' } },
        { descripcion: { contains: query.q, mode: 'insensitive' } },
        { categoria: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }
  if (query.soloClasificados) {
    const clasificados = await prisma.clasificacionProducto.findMany({ select: { codigo: true } });
    condiciones.push({ codigo: { in: clasificados.map((c) => c.codigo) } });
  }
  const where: Prisma.CatalogoItemWhereInput =
    condiciones.length === 0 ? {} : condiciones.length === 1 ? condiciones[0]! : { AND: condiciones };

  const [grupos, filas] = await Promise.all([
    // El total ES la cantidad de codigos DISTINTOS que matchean, no de filas
    // de catalogo (el mismo codigo esta repetido en cada snapshot).
    prisma.catalogoItem.groupBy({ by: ['codigo'], where, orderBy: { codigo: 'asc' } }),
    prisma.catalogoItem.findMany({
      where,
      // Un codigo, su snapshot mas reciente: DISTINCT ON (codigo) exige que
      // `codigo` vaya primero en el orderBy; `inventarioId desc` elige la
      // fila mas nueva de ese codigo.
      distinct: ['codigo'],
      orderBy: [{ codigo: 'asc' }, { inventarioId: 'desc' }],
      take: query.limite,
      skip: query.desplazamiento,
      select: {
        codigo: true,
        descripcion: true,
        categoria: true,
        responsable: true,
        // La clase derivada del snapshot y el empaque de compra: los dos son
        // REFERENCIA para el Auditor, nunca algo que esta pantalla escriba.
        clase: true,
        empaqueCompra: true,
        empaqueCompraSimbolo: true,
      },
    }),
  ]);

  const codigos = filas.map((f) => f.codigo);
  const clasificaciones =
    codigos.length > 0 ? await prisma.clasificacionProducto.findMany({ where: { codigo: { in: codigos } } }) : [];
  const porCodigo = new Map(clasificaciones.map((c) => [c.codigo, c]));

  return {
    total: grupos.length,
    limite: query.limite,
    desplazamiento: query.desplazamiento,
    productos: filas.map((f) => aProductoDto(f, porCodigo.get(f.codigo))),
  };
}

export async function clasificar(
  actor: ColaboradorAutenticado,
  codigo: string,
  input: ClasificarInput,
): Promise<ClasificacionDto> {
  validarPermisoDeClasificacion(actor);

  const nota = input.nota ?? null;
  // LAS DOS COLUMNAS, SIEMPRE JUNTAS Y DESDE LA MISMA FUENTE. Escribir una sin
  // la otra deja la liquidacion mirando columnas que discrepan, que es
  // exactamente lo que la invariante prohibe.
  // `null` = no se fuerza ningun cuadro: lo decide el sistema. La invariante
  // se sostiene igual -- `esEmpresa` es `clase === 'empresa'`, y sin clase
  // forzada eso es `false`, que es lo correcto: no hay excepcion de empresa.
  const clase = input.clase ?? null;
  const esEmpresa = clase !== null && esEmpresaDe(clase);
  // Ausente y `null` significan lo mismo -- sin correccion -- porque esto es un
  // PUT: el cuerpo declara la excepcion entera (ver el schema).
  const empaqueCompraCorregido = input.empaqueCompraCorregido ?? null;

  // Se lee ANTES del upsert para saber si es alta o cambio, y para dejar el
  // valor anterior en la auditoria cuando es un cambio.
  const anterior = await prisma.clasificacionProducto.findUnique({ where: { codigo } });
  const clasificadoEn = new Date();

  const fila = await prisma.clasificacionProducto.upsert({
    where: { codigo },
    create: { codigo, esEmpresa, clase, empaqueCompraCorregido, nota, clasificadoPorId: actor.colaboradorId, clasificadoEn },
    update: { esEmpresa, clase, empaqueCompraCorregido, nota, clasificadoPorId: actor.colaboradorId, clasificadoEn },
  });

  // EL VALOR ANTERIOR Y EL NUEVO, los dos con su clase. Una reclasificacion
  // mueve plata de un lado a otro de la liquidacion: seis meses despues, "paso
  // de unidad a paquete" es la unica respuesta posible a por que un faltante
  // se descuenta distinto. `anterior.clase` puede ser null (excepcion vieja) y
  // se registra asi, tal cual estaba -- no se rellena con un valor inventado.
  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: anterior ? 'clasificacion.actualizada' : 'clasificacion.creada',
    entidad: 'clasificacion_producto',
    entidadId: fila.id,
    // UN CAMBIO DE EMPAQUE MUEVE PLATA DE UN CUADRO AL OTRO, asi que va con el
    // valor anterior igual que la clase: "paso de 1 a 12" es la unica
    // respuesta posible, seis meses despues, a por que un faltante dejo de
    // descontarse al personal.
    detalle: anterior
      ? {
          codigo,
          clase,
          esEmpresa,
          empaqueCompraCorregido,
          nota,
          anterior: {
            clase: anterior.clase,
            esEmpresa: anterior.esEmpresa,
            empaqueCompraCorregido: anterior.empaqueCompraCorregido,
            nota: anterior.nota,
          },
        }
      : { codigo, clase, esEmpresa, empaqueCompraCorregido, nota },
  });

  return aClasificacionDto(fila);
}

export async function desclasificar(actor: ColaboradorAutenticado, codigo: string): Promise<void> {
  validarPermisoDeClasificacion(actor);

  const anterior = await prisma.clasificacionProducto.findUnique({ where: { codigo } });
  if (!anterior) {
    throw new NoEncontrado(`No hay una clasificacion para el codigo ${codigo}.`);
  }

  await prisma.clasificacionProducto.delete({ where: { codigo } });

  // El RASTRO: la fila se borra a proposito (sin fila = sin excepcion, manda
  // Dynamics -- ver schema.prisma#ClasificacionProducto), pero la historia no
  // se pierde: queda QUE se quito, con su valor anterior, quien y cuando, en
  // RegistroAuditoria (el mismo lugar donde vive el historial de cambios).
  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'clasificacion.eliminada',
    entidad: 'clasificacion_producto',
    entidadId: anterior.id,
    detalle: {
      codigo,
      anterior: {
        clase: anterior.clase,
        esEmpresa: anterior.esEmpresa,
        empaqueCompraCorregido: anterior.empaqueCompraCorregido,
        nota: anterior.nota,
      },
    },
  });
}
