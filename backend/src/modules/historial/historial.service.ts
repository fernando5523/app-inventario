/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * backend/README.md). Todo lo que es regla de negocio -- quien ve que, quien
 * puede firmar, como se calcula un descuento, como se arma un hash -- vive
 * en historial.permisos.ts / historial.calculos.ts / historial.lacrado.ts,
 * sin Prisma, para que se pueda testear sin base de datos.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  calcularEmbudo,
  calcularResumenLiquidacion,
  calcularTotalDescuento,
  compararPeriodos,
  resumirHistoricoItem,
  type PuntoComparativo,
} from './historial.calculos';
import {
  ALGORITMO_HASH,
  armarContenidoLacrado,
  armarFolio,
  calcularHash,
  verificarLacrado,
  type ContenidoLacrado,
  type DatosLacrado,
  type ResultadoVerificacion,
} from './historial.lacrado';
import {
  resolverSucursalConsultable,
  validarAccesoAInventario,
  validarPuedeAprobar,
  validarPuedeLacrar,
  type EstadoInventario,
} from './historial.permisos';
import type {
  AprobarCierreInput,
  ComparativoQuery,
  HistoricoItemQuery,
  ListarDiferenciasQuery,
  ListarInventariosQuery,
  RegistrarEnErpInput,
} from './historial.schema';

// ---------------------------------------------------------------------------
// Helpers de forma
// ---------------------------------------------------------------------------

/**
 * Prisma devuelve las columnas Decimal como Prisma.Decimal, no como number:
 * mandarlo tal cual al JSON lo serializa como string y el consumidor tendria
 * que parsear plata a mano en cada pantalla. Se convierte una sola vez, aca.
 */
function aNumero(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : valor.toNumber();
}

function aNumeroObligatorio(valor: Prisma.Decimal): number {
  return valor.toNumber();
}

function aIso(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString();
}

/** "2026-08" -- clave de periodo legible y ordenable como texto. */
function claveDePeriodo(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

export interface InventarioListadoDto {
  id: number;
  sucursalId: number;
  sucursalNombre: string;
  estado: EstadoInventario;
  periodo: string;
  periodoAnio: number;
  periodoMes: number;
  tamanoHoja: number;
  snapshotItems: number | null;
  abiertoEn: string;
  cerradoEn: string | null;
  /** true = es el inventario en curso de esa sucursal. */
  abierto: boolean;
  /** Resumen del mes. `null` mientras el conteo no cerro. */
  resultado: ResultadoResumenDto | null;
  /** Sello del mes. `null` si todavia no se lacro. */
  lacrado: LacradoResumenDto | null;
  aprobaciones: number;
}

export interface ResultadoResumenDto {
  itemsTotales: number;
  itemsConDiferencia: number;
  itemsCuadrados: number;
  porcentajeCuadrado: number;
  montoFaltanteBruto: number;
  montoFaltanteNeto: number;
  cuotaBase: number;
}

export interface LacradoResumenDto {
  folio: string;
  hash: string;
  lacradoEn: string;
  lacradoPor: { id: number; nombre: string };
  registradoEnErp: boolean;
}

const INCLUDE_LISTADO = {
  sucursal: { select: { id: true, nombre: true } },
  resultado: true,
  lacrado: {
    include: {
      lacradoPor: { select: { id: true, nombre: true } },
      registroErp: true,
    },
  },
  _count: { select: { aprobaciones: true } },
} satisfies Prisma.InventarioInclude;

type InventarioConIncludes = Prisma.InventarioGetPayload<{ include: typeof INCLUDE_LISTADO }>;

function resumirResultado(r: InventarioConIncludes['resultado']): ResultadoResumenDto | null {
  if (r === null) return null;

  const embudo = calcularEmbudo(r);
  const liq = calcularResumenLiquidacion({
    montoFaltanteBruto: aNumeroObligatorio(r.montoFaltanteBruto),
    montoNegativos: aNumeroObligatorio(r.montoNegativos),
    montoFaltanteEmpresa: aNumeroObligatorio(r.montoFaltanteEmpresa),
    colaboradoresAlcanzados: r.colaboradoresAlcanzados,
    colaboradoresAsistieron: r.colaboradoresAsistieron,
    multaInasistencia: aNumeroObligatorio(r.multaInasistencia),
  });

  return {
    itemsTotales: r.itemsTotales,
    itemsConDiferencia: r.itemsConDiferencia,
    itemsCuadrados: embudo.itemsCuadrados,
    porcentajeCuadrado: embudo.porcentajeCuadrado,
    montoFaltanteBruto: aNumeroObligatorio(r.montoFaltanteBruto),
    montoFaltanteNeto: liq.montoFaltanteNeto,
    cuotaBase: liq.cuotaBase,
  };
}

function resumirLacrado(l: InventarioConIncludes['lacrado']): LacradoResumenDto | null {
  if (l === null) return null;
  return {
    folio: l.folio,
    hash: l.hash,
    lacradoEn: l.lacradoEn.toISOString(),
    lacradoPor: { id: l.lacradoPor.id, nombre: l.lacradoPor.nombre },
    registradoEnErp: l.registroErp !== null,
  };
}

function aListadoDto(inv: InventarioConIncludes): InventarioListadoDto {
  return {
    id: inv.id,
    sucursalId: inv.sucursalId,
    sucursalNombre: inv.sucursal.nombre,
    estado: inv.estado as EstadoInventario,
    periodo: claveDePeriodo(inv.periodoAnio, inv.periodoMes),
    periodoAnio: inv.periodoAnio,
    periodoMes: inv.periodoMes,
    tamanoHoja: inv.tamanoHoja,
    snapshotItems: inv.snapshotItems,
    abiertoEn: inv.abiertoEn.toISOString(),
    cerradoEn: aIso(inv.cerradoEn),
    abierto: inv.abierto === true,
    resultado: resumirResultado(inv.resultado),
    lacrado: resumirLacrado(inv.lacrado),
    aprobaciones: inv._count.aprobaciones,
  };
}

export interface ListadoInventariosDto {
  total: number;
  limite: number;
  desplazamiento: number;
  inventarios: InventarioListadoDto[];
}

export async function listarInventarios(
  actor: ColaboradorAutenticado,
  query: ListarInventariosQuery,
): Promise<ListadoInventariosDto> {
  const sucursalId = resolverSucursalConsultable(actor, query.sucursalId);

  const where: Prisma.InventarioWhereInput = {
    ...(sucursalId !== undefined ? { sucursalId } : {}),
    ...(query.estado !== undefined ? { estado: query.estado } : {}),
    ...(query.periodoAnio !== undefined ? { periodoAnio: query.periodoAnio } : {}),
    ...(query.periodoMes !== undefined ? { periodoMes: query.periodoMes } : {}),
  };

  const [total, filas] = await Promise.all([
    prisma.inventario.count({ where }),
    prisma.inventario.findMany({
      where,
      include: INCLUDE_LISTADO,
      // Mas reciente primero: el historico se lee hacia atras.
      orderBy: [{ periodoAnio: 'desc' }, { periodoMes: 'desc' }, { id: 'desc' }],
      take: query.limite,
      skip: query.desplazamiento,
    }),
  ]);

  return {
    total,
    limite: query.limite,
    desplazamiento: query.desplazamiento,
    inventarios: filas.map(aListadoDto),
  };
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

const INCLUDE_DETALLE = {
  sucursal: { select: { id: true, nombre: true } },
  resultado: true,
  cerradoPor: { select: { id: true, nombre: true } },
  lacrado: {
    include: {
      lacradoPor: { select: { id: true, nombre: true } },
      registroErp: { include: { registradoPor: { select: { id: true, nombre: true } } } },
    },
  },
  aprobaciones: {
    include: { aprobador: { select: { id: true, nombre: true } } },
    orderBy: { aprobadoEn: 'asc' },
  },
  hojas: {
    select: {
      id: true,
      numeroConteo: true,
      numero: true,
      zona: true,
      gondola: true,
      tamano: true,
      estado: true,
      sync: true,
      asignadoA: { select: { id: true, nombre: true } },
      asignadoA2: { select: { id: true, nombre: true } },
      _count: { select: { productos: true, conteos: true } },
    },
    orderBy: [{ numeroConteo: 'asc' }, { numero: 'asc' }],
  },
  _count: { select: { diferencias: true, liquidaciones: true } },
} satisfies Prisma.InventarioInclude;

async function traerInventarioOFallar<T extends Prisma.InventarioInclude>(
  actor: ColaboradorAutenticado,
  id: number,
  include: T,
): Promise<Prisma.InventarioGetPayload<{ include: T }>> {
  const inv = await prisma.inventario.findUnique({ where: { id }, include });
  if (inv === null) throw new NoEncontrado(`No existe el inventario ${id}.`);
  // El chequeo de alcance va DESPUES de traerlo (hace falta su sucursalId) y
  // ANTES de devolver nada: un auditor de otra tienda recibe 403, no datos.
  validarAccesoAInventario(actor, inv as { sucursalId: number });
  return inv as Prisma.InventarioGetPayload<{ include: T }>;
}

export async function obtenerDetalle(actor: ColaboradorAutenticado, id: number): Promise<Record<string, unknown>> {
  const inv = await traerInventarioOFallar(actor, id, INCLUDE_DETALLE);

  const resultado = inv.resultado;
  const embudo = resultado === null ? null : calcularEmbudo(resultado);
  const liquidacion =
    resultado === null
      ? null
      : calcularResumenLiquidacion({
          montoFaltanteBruto: aNumeroObligatorio(resultado.montoFaltanteBruto),
          montoNegativos: aNumeroObligatorio(resultado.montoNegativos),
          montoFaltanteEmpresa: aNumeroObligatorio(resultado.montoFaltanteEmpresa),
          colaboradoresAlcanzados: resultado.colaboradoresAlcanzados,
          colaboradoresAsistieron: resultado.colaboradoresAsistieron,
          multaInasistencia: aNumeroObligatorio(resultado.multaInasistencia),
        });

  return {
    id: inv.id,
    sucursal: { id: inv.sucursal.id, nombre: inv.sucursal.nombre },
    estado: inv.estado,
    periodo: claveDePeriodo(inv.periodoAnio, inv.periodoMes),
    periodoAnio: inv.periodoAnio,
    periodoMes: inv.periodoMes,
    tamanoHoja: inv.tamanoHoja,
    snapshotItems: inv.snapshotItems,
    snapshotTomadoEn: aIso(inv.snapshotTomadoEn),
    abierto: inv.abierto === true,
    abiertoEn: inv.abiertoEn.toISOString(),
    cerradoEn: aIso(inv.cerradoEn),
    cerradoPor: inv.cerradoPor === null ? null : { id: inv.cerradoPor.id, nombre: inv.cerradoPor.nombre },

    resultado:
      resultado === null || embudo === null || liquidacion === null
        ? null
        : {
            itemsTotales: resultado.itemsTotales,
            itemsConDiferencia: resultado.itemsConDiferencia,
            itemsSegundoConteo: resultado.itemsSegundoConteo,
            itemsTercerConteo: resultado.itemsTercerConteo,
            unidadesFaltantes: resultado.unidadesFaltantes,
            unidadesSobrantes: resultado.unidadesSobrantes,
            montoFaltanteBruto: aNumeroObligatorio(resultado.montoFaltanteBruto),
            montoNegativos: aNumeroObligatorio(resultado.montoNegativos),
            montoFaltanteEmpresa: aNumeroObligatorio(resultado.montoFaltanteEmpresa),
            colaboradoresAlcanzados: resultado.colaboradoresAlcanzados,
            colaboradoresAsistieron: resultado.colaboradoresAsistieron,
            multaInasistencia: aNumeroObligatorio(resultado.multaInasistencia),
            calculadoEn: resultado.calculadoEn.toISOString(),
            // Derivados -- ver historial.calculos.ts (no son columnas).
            ...embudo,
            ...liquidacion,
          },

    hojas: inv.hojas.map((h) => ({
      id: h.id,
      numeroConteo: h.numeroConteo,
      numero: h.numero,
      zona: h.zona,
      gondola: h.gondola,
      tamano: h.tamano,
      estado: h.estado,
      sync: h.sync,
      asignados: [h.asignadoA, h.asignadoA2].filter((a) => a !== null).map((a) => ({ id: a.id, nombre: a.nombre })),
      productos: h._count.productos,
      contados: h._count.conteos,
    })),

    // Solo el conteo: las diferencias pueden ser cientos y van paginadas en
    // GET /inventarios/:id/diferencias.
    diferencias: inv._count.diferencias,
    liquidaciones: inv._count.liquidaciones,

    aprobaciones: inv.aprobaciones.map((a) => ({
      aprobadorId: a.aprobadorId,
      aprobadorNombre: a.aprobador.nombre,
      // El rol congelado al firmar, no el actual del colaborador.
      rolAlAprobar: a.rolAlAprobar,
      aprobadoEn: a.aprobadoEn.toISOString(),
      nota: a.nota,
    })),

    lacrado:
      inv.lacrado === null
        ? null
        : {
            folio: inv.lacrado.folio,
            hash: inv.lacrado.hash,
            hashAlgoritmo: inv.lacrado.hashAlgoritmo,
            lacradoEn: inv.lacrado.lacradoEn.toISOString(),
            lacradoPor: { id: inv.lacrado.lacradoPor.id, nombre: inv.lacrado.lacradoPor.nombre },
            registroErp:
              inv.lacrado.registroErp === null
                ? null
                : {
                    referencia: inv.lacrado.registroErp.referencia,
                    registradoEn: inv.lacrado.registroErp.registradoEn.toISOString(),
                    registradoPor: {
                      id: inv.lacrado.registroErp.registradoPor.id,
                      nombre: inv.lacrado.registroErp.registradoPor.nombre,
                    },
                  },
          },
  };
}

// ---------------------------------------------------------------------------
// Diferencias
// ---------------------------------------------------------------------------

export async function listarDiferencias(
  actor: ColaboradorAutenticado,
  id: number,
  query: ListarDiferenciasQuery,
): Promise<Record<string, unknown>> {
  await traerInventarioOFallar(actor, id, { sucursal: { select: { id: true } } });

  const where: Prisma.DiferenciaItemWhereInput = {
    inventarioId: id,
    ...(query.tipo === 'faltante' ? { diferencia: { lt: 0 } } : {}),
    ...(query.tipo === 'sobrante' ? { diferencia: { gt: 0 } } : {}),
    ...(query.resueltoEnConteo !== undefined ? { resueltoEnConteo: query.resueltoEnConteo } : {}),
  };

  const [total, filas] = await Promise.all([
    prisma.diferenciaItem.count({ where }),
    prisma.diferenciaItem.findMany({
      where,
      // Por diferencia ascendente = los faltantes mas grandes primero, que es
      // lo que se mira cuando se abre esta pantalla.
      orderBy: [{ diferencia: 'asc' }, { codigo: 'asc' }],
      take: query.limite,
      skip: query.desplazamiento,
    }),
  ]);

  return {
    total,
    limite: query.limite,
    desplazamiento: query.desplazamiento,
    diferencias: filas.map((d) => ({
      codigo: d.codigo,
      descripcion: d.descripcion,
      stockSistema: d.stockSistema,
      conteoFinal: d.conteoFinal,
      diferencia: d.diferencia,
      tipo: d.diferencia < 0 ? 'faltante' : 'sobrante',
      resueltoEnConteo: d.resueltoEnConteo,
      costoUnitario: aNumero(d.costoUnitario),
      montoDiferencia: aNumero(d.montoDiferencia),
    })),
  };
}

// ---------------------------------------------------------------------------
// Liquidacion (planilla del mes)
// ---------------------------------------------------------------------------

export async function obtenerLiquidacion(actor: ColaboradorAutenticado, id: number): Promise<Record<string, unknown>> {
  const inv = await traerInventarioOFallar(actor, id, {
    sucursal: { select: { id: true, nombre: true } },
    resultado: true,
    liquidaciones: {
      include: { colaborador: { select: { id: true, nombre: true, dni: true } } },
      orderBy: { colaboradorId: 'asc' },
    },
  });

  const r = inv.resultado;
  const resumen =
    r === null
      ? null
      : calcularResumenLiquidacion({
          montoFaltanteBruto: aNumeroObligatorio(r.montoFaltanteBruto),
          montoNegativos: aNumeroObligatorio(r.montoNegativos),
          montoFaltanteEmpresa: aNumeroObligatorio(r.montoFaltanteEmpresa),
          colaboradoresAlcanzados: r.colaboradoresAlcanzados,
          colaboradoresAsistieron: r.colaboradoresAsistieron,
          multaInasistencia: aNumeroObligatorio(r.multaInasistencia),
        });

  return {
    inventarioId: inv.id,
    sucursal: { id: inv.sucursal.id, nombre: inv.sucursal.nombre },
    periodo: claveDePeriodo(inv.periodoAnio, inv.periodoMes),
    resumen,
    planilla: inv.liquidaciones.map((l) => {
      const cuotaBase = aNumeroObligatorio(l.cuotaBase);
      const multaInasistencia = aNumeroObligatorio(l.multaInasistencia);
      const bonoAsistencia = aNumeroObligatorio(l.bonoAsistencia);
      return {
        colaboradorId: l.colaboradorId,
        // El nombre CONGELADO al liquidar, no el actual: es lo que decia el
        // recibo. `nombreActual` va al lado para poder identificar a la
        // persona si se renombro despues.
        nombre: l.nombreAlLiquidar,
        nombreActual: l.colaborador.nombre,
        dni: l.colaborador.dni,
        rol: l.rolAlLiquidar,
        asistio: l.asistio,
        cuotaBase,
        multaInasistencia,
        bonoAsistencia,
        // Derivado, nunca una columna (ver historial.calculos.ts).
        totalDescuento: calcularTotalDescuento({ cuotaBase, multaInasistencia, bonoAsistencia }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Armado del contenido sellado (compartido por lacrar y verificar)
// ---------------------------------------------------------------------------

const INCLUDE_SELLO = {
  sucursal: { select: { id: true, nombre: true } },
  resultado: true,
  diferencias: { orderBy: { codigo: 'asc' } },
  liquidaciones: { orderBy: { colaboradorId: 'asc' } },
  // El nombre del aprobador viaja para la respuesta HTTP, NO para el hash:
  // armarDatosLacrado solo toma id, rol y fecha. Un nombre que cambia no
  // debe romper la verificacion de un sello (ver historial.lacrado.ts).
  aprobaciones: {
    include: { aprobador: { select: { id: true, nombre: true } } },
    orderBy: { aprobadorId: 'asc' },
  },
} satisfies Prisma.InventarioInclude;

type InventarioParaSello = Prisma.InventarioGetPayload<{ include: typeof INCLUDE_SELLO }>;

/**
 * Traduce el inventario al objeto que entra al hash. Vive en el service (no
 * en historial.lacrado.ts) porque es lo unico de esta cadena que necesita
 * conocer la forma de Prisma; el armado canonico y el hash en si quedan del
 * lado puro, testeable sin base.
 */
function armarDatosLacrado(inv: InventarioParaSello): DatosLacrado {
  return {
    inventarioId: inv.id,
    sucursalId: inv.sucursalId,
    sucursalNombre: inv.sucursal.nombre,
    periodoAnio: inv.periodoAnio,
    periodoMes: inv.periodoMes,
    tamanoHoja: inv.tamanoHoja,
    snapshotItems: inv.snapshotItems,
    snapshotTomadoEn: aIso(inv.snapshotTomadoEn),
    cerradoEn: aIso(inv.cerradoEn),
    resultado:
      inv.resultado === null
        ? null
        : {
            itemsTotales: inv.resultado.itemsTotales,
            itemsConDiferencia: inv.resultado.itemsConDiferencia,
            itemsSegundoConteo: inv.resultado.itemsSegundoConteo,
            itemsTercerConteo: inv.resultado.itemsTercerConteo,
            unidadesFaltantes: inv.resultado.unidadesFaltantes,
            unidadesSobrantes: inv.resultado.unidadesSobrantes,
            montoFaltanteBruto: aNumeroObligatorio(inv.resultado.montoFaltanteBruto),
            montoNegativos: aNumeroObligatorio(inv.resultado.montoNegativos),
            montoFaltanteEmpresa: aNumeroObligatorio(inv.resultado.montoFaltanteEmpresa),
            colaboradoresAlcanzados: inv.resultado.colaboradoresAlcanzados,
            colaboradoresAsistieron: inv.resultado.colaboradoresAsistieron,
            multaInasistencia: aNumeroObligatorio(inv.resultado.multaInasistencia),
          },
    diferencias: inv.diferencias.map((d) => ({
      codigo: d.codigo,
      stockSistema: d.stockSistema,
      conteoFinal: d.conteoFinal,
      diferencia: d.diferencia,
      resueltoEnConteo: d.resueltoEnConteo,
      montoDiferencia: aNumero(d.montoDiferencia),
    })),
    liquidaciones: inv.liquidaciones.map((l) => ({
      colaboradorId: l.colaboradorId,
      asistio: l.asistio,
      cuotaBase: aNumeroObligatorio(l.cuotaBase),
      multaInasistencia: aNumeroObligatorio(l.multaInasistencia),
      bonoAsistencia: aNumeroObligatorio(l.bonoAsistencia),
    })),
    aprobaciones: inv.aprobaciones.map((a) => ({
      aprobadorId: a.aprobadorId,
      rolAlAprobar: a.rolAlAprobar,
      aprobadoEn: a.aprobadoEn.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Aprobacion del cierre -- el control de dos personas
// ---------------------------------------------------------------------------

export interface AprobacionDto {
  inventarioId: number;
  aprobadorId: number;
  aprobadorNombre: string;
  rolAlAprobar: string;
  aprobadoEn: string;
  nota: string | null;
  aprobacionesTotales: number;
  /** true = ya se puede lacrar (dos firmas de personas distintas). */
  listoParaLacrar: boolean;
}

/**
 * Registra la aprobacion DEL COLABORADOR DE LA SESION.
 *
 * Fijate en la firma: no hay ningun `aprobadorId` de entrada. `actor` sale
 * de req.colaborador, que auth.middleware.ts resuelve del token verificado
 * contra la base -- y historial.schema.ts rechaza con 400 cualquier body que
 * intente mandar una identidad. Es lo que convierte la doble validacion en
 * un control de dos personas de verdad, y no en dos botones que una sola
 * persona puede apretar.
 */
export async function aprobarCierre(
  actor: ColaboradorAutenticado,
  id: number,
  input: AprobarCierreInput,
): Promise<AprobacionDto> {
  const inv = await traerInventarioOFallar(actor, id, {
    aprobaciones: { select: { aprobadorId: true } },
  });

  validarPuedeAprobar(
    actor,
    { sucursalId: inv.sucursalId, estado: inv.estado as EstadoInventario },
    inv.aprobaciones,
  );

  const aprobacion = await prisma.aprobacionCierre.create({
    data: {
      inventarioId: id,
      // Del token. Nunca del body.
      aprobadorId: actor.colaboradorId,
      // Rol congelado al firmar: si manana cambia de rol, la firma tiene que
      // seguir diciendo con que autoridad se dio.
      rolAlAprobar: actor.rol,
      ...(input.nota !== undefined ? { nota: input.nota } : {}),
    },
    include: { aprobador: { select: { id: true, nombre: true } } },
  });

  const aprobadores = await prisma.aprobacionCierre.findMany({
    where: { inventarioId: id },
    select: { aprobadorId: true },
  });
  const distintos = new Set(aprobadores.map((a) => a.aprobadorId)).size;

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.cierre_aprobado',
    entidad: 'inventario',
    entidadId: id,
    detalle: { aprobadorId: actor.colaboradorId, rolAlAprobar: actor.rol, aprobacionesTotales: distintos },
  });

  return {
    inventarioId: id,
    aprobadorId: aprobacion.aprobadorId,
    aprobadorNombre: aprobacion.aprobador.nombre,
    rolAlAprobar: aprobacion.rolAlAprobar,
    aprobadoEn: aprobacion.aprobadoEn.toISOString(),
    nota: aprobacion.nota,
    aprobacionesTotales: distintos,
    listoParaLacrar: distintos >= 2,
  };
}

// ---------------------------------------------------------------------------
// Lacrado
// ---------------------------------------------------------------------------

export interface LacradoDto {
  inventarioId: number;
  folio: string;
  hash: string;
  hashAlgoritmo: string;
  lacradoEn: string;
  lacradoPor: { id: number; nombre: string };
  aprobadoPor: Array<{ id: number; nombre: string; rol: string; aprobadoEn: string }>;
}

/**
 * Cierra el mes. Es la operacion mas irreversible del sistema: despues de
 * esto el inventario no se toca nunca mas y cualquier ajuste entra en el
 * periodo siguiente (docs/pantallas.md, Pantalla 7).
 *
 * Tres cosas pasan en UNA transaccion, y tienen que ser atomicas: se crea el
 * sello, se marca el inventario como lacrado y se libera la sucursal
 * (`abierto: null`). Si se hicieran sueltas y fallara la del medio, quedaria
 * un sello sin inventario cerrado -- o peor, una sucursal bloqueada con un
 * inventario que ya se firmo.
 */
export async function lacrar(actor: ColaboradorAutenticado, id: number): Promise<LacradoDto> {
  const inv = await traerInventarioOFallar(actor, id, INCLUDE_SELLO);
  const yaLacrado = (await prisma.lacradoInventario.count({ where: { inventarioId: id } })) > 0;

  validarPuedeLacrar(
    actor,
    { sucursalId: inv.sucursalId, estado: inv.estado as EstadoInventario, yaLacrado },
    inv.aprobaciones,
  );

  const contenido = armarContenidoLacrado(armarDatosLacrado(inv));
  const hash = calcularHash(contenido);
  const folio = armarFolio({
    periodoAnio: inv.periodoAnio,
    periodoMes: inv.periodoMes,
    sucursalNombre: inv.sucursal.nombre,
    items: inv.resultado?.itemsTotales ?? inv.snapshotItems ?? 0,
    hash,
  });

  const lacrado = await prisma.$transaction(async (tx) => {
    const creado = await tx.lacradoInventario.create({
      data: {
        inventarioId: id,
        folio,
        hash,
        hashAlgoritmo: ALGORITMO_HASH,
        contenido: contenido as Prisma.InputJsonValue,
        lacradoPorId: actor.colaboradorId,
      },
      include: { lacradoPor: { select: { id: true, nombre: true } } },
    });

    await tx.inventario.update({
      where: { id },
      data: {
        estado: 'lacrado',
        // Libera la sucursal para el inventario del mes que viene. NULL, no
        // false: ver el comentario de Inventario.abierto en el schema.
        abierto: null,
      },
    });

    return creado;
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.lacrado',
    entidad: 'inventario',
    entidadId: id,
    detalle: {
      folio,
      hash,
      aprobadores: inv.aprobaciones.map((a) => a.aprobadorId),
    },
  });

  return {
    inventarioId: id,
    folio: lacrado.folio,
    hash: lacrado.hash,
    hashAlgoritmo: lacrado.hashAlgoritmo,
    lacradoEn: lacrado.lacradoEn.toISOString(),
    lacradoPor: { id: lacrado.lacradoPor.id, nombre: lacrado.lacradoPor.nombre },
    aprobadoPor: inv.aprobaciones.map((a) => ({
      id: a.aprobadorId,
      nombre: a.aprobador.nombre,
      rol: a.rolAlAprobar,
      aprobadoEn: a.aprobadoEn.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Verificacion del sello
// ---------------------------------------------------------------------------

export interface VerificacionDto extends ResultadoVerificacion {
  inventarioId: number;
  folio: string;
  lacradoEn: string;
  verificadoEn: string;
}

/**
 * Recalcula el hash sobre el estado ACTUAL del inventario y lo compara con
 * el sellado. Es lo que hace que la inmutabilidad sea comprobable en vez de
 * declarada: si alguien toco una hoja, una diferencia o la planilla despues
 * del cierre, este endpoint lo dice y ademas dice donde.
 */
export async function verificarSello(actor: ColaboradorAutenticado, id: number): Promise<VerificacionDto> {
  const inv = await traerInventarioOFallar(actor, id, { ...INCLUDE_SELLO, lacrado: true });

  if (inv.lacrado === null) {
    throw new Conflicto('El inventario todavia no esta lacrado: no hay sello que verificar.');
  }

  const contenidoActual = armarContenidoLacrado(armarDatosLacrado(inv));
  const guardado = inv.lacrado.contenido as Record<string, unknown>;

  return {
    inventarioId: id,
    folio: inv.lacrado.folio,
    lacradoEn: inv.lacrado.lacradoEn.toISOString(),
    verificadoEn: new Date().toISOString(),
    ...verificarLacrado(guardado, inv.lacrado.hash, contenidoActual as ContenidoLacrado),
  };
}

// ---------------------------------------------------------------------------
// Registro manual en Dynamics (fase 2)
// ---------------------------------------------------------------------------

export async function registrarEnErp(
  actor: ColaboradorAutenticado,
  id: number,
  input: RegistrarEnErpInput,
): Promise<Record<string, unknown>> {
  const inv = await traerInventarioOFallar(actor, id, {
    lacrado: { include: { registroErp: true } },
  });

  if (inv.lacrado === null) {
    throw new Conflicto('Solo se puede registrar en Dynamics un inventario ya lacrado.');
  }
  if (inv.lacrado.registroErp !== null) {
    throw new Conflicto('Este inventario ya figura como registrado en Dynamics.');
  }

  const registro = await prisma.registroErpInventario.create({
    data: {
      lacradoId: inv.lacrado.id,
      registradoPorId: actor.colaboradorId,
      ...(input.referencia !== undefined ? { referencia: input.referencia } : {}),
    },
    include: { registradoPor: { select: { id: true, nombre: true } } },
  });

  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'inventario.registrado_en_erp',
    entidad: 'inventario',
    entidadId: id,
    detalle: { folio: inv.lacrado.folio, referencia: registro.referencia },
  });

  return {
    inventarioId: id,
    folio: inv.lacrado.folio,
    referencia: registro.referencia,
    registradoEn: registro.registradoEn.toISOString(),
    registradoPor: { id: registro.registradoPor.id, nombre: registro.registradoPor.nombre },
  };
}

// ---------------------------------------------------------------------------
// Historico de un articulo
// ---------------------------------------------------------------------------

export async function historicoDeItem(
  actor: ColaboradorAutenticado,
  codigo: string,
  query: HistoricoItemQuery,
): Promise<Record<string, unknown>> {
  const sucursalId = resolverSucursalConsultable(actor, query.sucursalId);

  const filas = await prisma.diferenciaItem.findMany({
    where: {
      codigo,
      inventario: {
        ...(sucursalId !== undefined ? { sucursalId } : {}),
        ...(query.desdeAnio !== undefined || query.hastaAnio !== undefined
          ? {
              periodoAnio: {
                ...(query.desdeAnio !== undefined ? { gte: query.desdeAnio } : {}),
                ...(query.hastaAnio !== undefined ? { lte: query.hastaAnio } : {}),
              },
            }
          : {}),
        // Solo inventarios que llegaron a cerrar: un inventario en curso
        // todavia puede resolver esa diferencia en el 2do o 3er conteo, y
        // contarla como historica seria contar un resultado que no existe.
        estado: { in: ['conteo_cerrado', 'liquidado', 'lacrado'] },
      },
    },
    include: {
      inventario: {
        select: {
          id: true,
          periodoAnio: true,
          periodoMes: true,
          estado: true,
          sucursal: { select: { id: true, nombre: true } },
        },
      },
    },
    orderBy: [{ inventario: { periodoAnio: 'asc' } }, { inventario: { periodoMes: 'asc' } }],
  });

  const apariciones = filas.map((f) => ({
    inventarioId: f.inventarioId,
    sucursalId: f.inventario.sucursal.id,
    sucursalNombre: f.inventario.sucursal.nombre,
    periodo: claveDePeriodo(f.inventario.periodoAnio, f.inventario.periodoMes),
    periodoAnio: f.inventario.periodoAnio,
    periodoMes: f.inventario.periodoMes,
    estadoInventario: f.inventario.estado,
    descripcion: f.descripcion,
    stockSistema: f.stockSistema,
    conteoFinal: f.conteoFinal,
    diferencia: f.diferencia,
    resueltoEnConteo: f.resueltoEnConteo,
    montoDiferencia: aNumero(f.montoDiferencia),
  }));

  return {
    codigo,
    // La descripcion mas reciente, que es la que la gente reconoce.
    descripcion: apariciones[apariciones.length - 1]?.descripcion ?? null,
    resumen: resumirHistoricoItem(apariciones),
    apariciones,
  };
}

// ---------------------------------------------------------------------------
// Comparativo entre periodos
// ---------------------------------------------------------------------------

export async function comparativo(
  actor: ColaboradorAutenticado,
  query: ComparativoQuery,
): Promise<Record<string, unknown>> {
  const sucursalId = resolverSucursalConsultable(actor, query.sucursalId);

  const filas = await prisma.inventario.findMany({
    where: {
      ...(sucursalId !== undefined ? { sucursalId } : {}),
      ...(query.desdeAnio !== undefined || query.hastaAnio !== undefined
        ? {
            periodoAnio: {
              ...(query.desdeAnio !== undefined ? { gte: query.desdeAnio } : {}),
              ...(query.hastaAnio !== undefined ? { lte: query.hastaAnio } : {}),
            },
          }
        : {}),
      // Comparar contra un inventario a medio contar no compara nada.
      estado: { in: ['conteo_cerrado', 'liquidado', 'lacrado'] },
      resultado: { isNot: null },
    },
    include: { resultado: true, sucursal: { select: { id: true, nombre: true } }, lacrado: { select: { folio: true } } },
    // Cronologico ascendente: compararPeriodos calcula la variacion contra el
    // punto anterior de la serie y depende de este orden.
    orderBy: [{ periodoAnio: 'asc' }, { periodoMes: 'asc' }],
  });

  const puntos: PuntoComparativo[] = [];
  const meta: Array<{ inventarioId: number; sucursalNombre: string; folio: string | null }> = [];

  for (const f of filas) {
    if (f.resultado === null) continue;
    const liq = calcularResumenLiquidacion({
      montoFaltanteBruto: aNumeroObligatorio(f.resultado.montoFaltanteBruto),
      montoNegativos: aNumeroObligatorio(f.resultado.montoNegativos),
      montoFaltanteEmpresa: aNumeroObligatorio(f.resultado.montoFaltanteEmpresa),
      colaboradoresAlcanzados: f.resultado.colaboradoresAlcanzados,
      colaboradoresAsistieron: f.resultado.colaboradoresAsistieron,
      multaInasistencia: aNumeroObligatorio(f.resultado.multaInasistencia),
    });
    puntos.push({
      periodoAnio: f.periodoAnio,
      periodoMes: f.periodoMes,
      itemsTotales: f.resultado.itemsTotales,
      itemsConDiferencia: f.resultado.itemsConDiferencia,
      montoFaltanteNeto: liq.montoFaltanteNeto,
    });
    meta.push({ inventarioId: f.id, sucursalNombre: f.sucursal.nombre, folio: f.lacrado?.folio ?? null });
  }

  const serie = compararPeriodos(puntos).map((p, i) => ({
    ...p,
    periodo: claveDePeriodo(p.periodoAnio, p.periodoMes),
    ...meta[i],
  }));

  return { sucursalId: sucursalId ?? null, periodos: serie.length, serie };
}
