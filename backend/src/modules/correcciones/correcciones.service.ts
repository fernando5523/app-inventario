/**
 * CORRECCIÓN MASIVA DE CONTEOS POR EXCEL: exportar lo contado, corregirlo en
 * Excel y volver a importar el mismo archivo.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA NO SE DUPLICA: TODO ESCRIBE POR `corregirConteo`
 * ---------------------------------------------------------------------------
 * Cada fila que se aplica entra por `hojas.service.ts#corregirConteo`, la
 * MISMA función que usa `PATCH /api/hojas/:id/conteos/:productoId/corregir`.
 * Este módulo es el LOTE por encima, no una vía paralela: no valida permisos
 * por su cuenta, no escribe `Conteo`, no registra la auditoría de la
 * corrección. El día que cambie quién puede corregir o en qué estado, cambia
 * en `ajuste.permisos.ts#validarCorreccion` y este flujo cambia con él.
 *
 * La vista previa SÍ llama a `validarCorreccion` -- la misma función, no una
 * copia de la regla -- y traduce lo que tira en el veredicto de la fila. Eso
 * no es duplicar: es preguntar antes de hacer.
 *
 * ---------------------------------------------------------------------------
 * DOS PASOS, COMO LOS AJUSTES DE NEGATIVOS
 * ---------------------------------------------------------------------------
 *   1. `previsualizarCorrecciones` -- lee el archivo, resuelve cada fila
 *      contra la base y devuelve el veredicto de TODAS. Nunca escribe.
 *   2. `confirmarCorrecciones` -- vuelve a leer el MISMO archivo y aplica las
 *      que siguen siendo aplicables, una por una.
 *
 * Sin estado intermedio entre los dos, igual que allá: confirmar relee el
 * archivo que el cliente ya tiene en la mano, en vez de guardar una vista
 * previa "pendiente" que haya que expirar.
 *
 * ---------------------------------------------------------------------------
 * EL LOTE CRUZA TIENDAS, Y ES UNA DECISIÓN
 * ---------------------------------------------------------------------------
 * El Excel de negativos es de UN inventario y rechaza por fila lo que es de
 * otra tienda. Acá es al revés: la pantalla muestra las once tiendas del
 * período juntas y el usuario pidió exportar eso y reimportarlo. Partir el
 * archivo por tienda a mano antes de subirlo sería trabajo manual inventado
 * por el backend.
 *
 * Lo que eso obliga: la ventana de corrección es POR INVENTARIO (`en_curso`),
 * y en un período real hay tiendas que ya pasaron al ajuste final. Con el lote
 * acotado a un inventario, ese caso sería un 409 que tira el archivo entero;
 * cruzando tiendas, las filas de esa tienda se rechazan UNA POR UNA con su
 * motivo y las demás se aplican. Es exactamente lo que se pidió: nunca un
 * rechazo global sin detalle, nunca aplicar la mitad y callar el resto.
 *
 * ---------------------------------------------------------------------------
 * EL LOTE NO ES ATÓMICO, Y ES A PROPÓSITO
 * ---------------------------------------------------------------------------
 * `corregirConteo` abre su propia transacción por fila (el cambio de valor y
 * la limpieza de la ronda siguiente son un solo hecho, ver su comentario).
 * Envolver el lote en una transacción más grande obligaría a reimplementar esa
 * función, que es lo que no se puede hacer.
 *
 * Así que un lote puede quedar aplicado a medias si algo falla en el medio --
 * y la respuesta lo dice fila por fila, con el motivo de la que no entró.
 * Cada corrección es un hecho independiente, ya auditado con su nombre y su
 * motivo; no hay ninguna invariante que exija que las 40 entren juntas.
 */

import ExcelJS from 'exceljs';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { puedeVerLaMatriz } from '../auditoria/auditoria.permisos';
import type { EstadoInventario } from '../historial/historial.permisos';
import { totalUnidades } from '../hojas/hojas.calculos';
import { corregirConteo } from '../hojas/hojas.service';
import { validarCorreccion, validarSucursal } from '../inventarios/ajuste.permisos';
import {
  COLUMNAS_EXPORT,
  leerCorrecciones,
  type ColumnaExport,
  type FilaLeida,
  type FilaRechazada,
  type FilaSinCambio,
  type MotivoRechazoFila,
} from './correcciones.formato';

/** Los tres roles que pueden corregir (`ajuste.permisos.ts#ROLES_QUE_CORRIGEN`). El recorte fino lo hace `validarCorreccion` por inventario. */
const ROLES_DEL_LOTE = ['administrador', 'auditor', 'coordinador'] as const;

function validarRolDelLote(actor: ColaboradorAutenticado): void {
  if (!(ROLES_DEL_LOTE as readonly string[]).includes(actor.rol)) {
    throw new Prohibido(
      'Corregir conteos es del Coordinador de la tienda o del Auditor: tu rol no puede cambiar lo que otro contó.',
    );
  }
}

// ---------------------------------------------------------------------------
// Lo que se sabe de cada inventario del archivo
// ---------------------------------------------------------------------------

interface InventarioDelLote {
  id: number;
  sucursalId: number;
  sucursalNombre: string;
  estado: EstadoInventario;
  periodo: string;
  /** `null` = este actor SÍ puede corregir en este inventario. Si no, el motivo y su texto. */
  bloqueo: { motivo: MotivoRechazoFila; detalle: string } | null;
}

/**
 * Trae los inventarios que nombra el archivo y resuelve, para cada uno, si
 * este actor puede corregir ahí -- preguntándole a `validarCorreccion`, no
 * reimplementando su regla. Lo que esa función tira se traduce en el veredicto
 * de las filas de ese inventario, con SU mensaje (dice qué regla se topó).
 */
async function cargarInventarios(
  actor: ColaboradorAutenticado,
  ids: readonly number[],
): Promise<Map<number, InventarioDelLote>> {
  if (ids.length === 0) return new Map();

  const filas = await prisma.inventario.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      sucursalId: true,
      estado: true,
      periodoAnio: true,
      periodoMes: true,
      sucursal: { select: { nombre: true } },
    },
  });

  return new Map(
    filas.map((inv) => {
      const estado = inv.estado as EstadoInventario;
      let bloqueo: InventarioDelLote['bloqueo'] = null;
      try {
        validarCorreccion(actor, { sucursalId: inv.sucursalId, estado: estado as never });
      } catch (error) {
        // El mensaje del servidor TAL CUAL: nombra la regla real ("el ajuste
        // final ya está iniciado", "ese inventario es de otra sucursal"), que
        // es lo único accionable. Un genérico lo borraría.
        const detalle = error instanceof Error ? error.message : 'No se puede corregir en este inventario.';
        bloqueo = { motivo: error instanceof Prohibido ? 'sin-permiso' : 'inventario-no-corrige', detalle };
      }
      return [
        inv.id,
        {
          id: inv.id,
          sucursalId: inv.sucursalId,
          sucursalNombre: inv.sucursal.nombre,
          estado,
          periodo: `${inv.periodoAnio}-${String(inv.periodoMes).padStart(2, '0')}`,
          bloqueo,
        },
      ];
    }),
  );
}

/** El conteo que una fila apunta, ya resuelto contra la base. */
interface ConteoApuntado {
  hojaId: number;
  numeroHoja: string;
  productoId: number;
  /** Unidades que tiene cargadas HOY, por `totalUnidades`. */
  contadoActual: number;
}

/**
 * Resuelve `(inventario, ronda, codigo)` -> el conteo. Una consulta por
 * inventario, no una por fila: un archivo de las once tiendas son once
 * consultas, no cuatrocientas.
 */
async function cargarConteos(
  inventarioId: number,
  rondas: readonly number[],
  codigos: readonly string[],
): Promise<Map<string, ConteoApuntado | 'ambiguo' | 'sin-conteo'>> {
  const productos = await prisma.producto.findMany({
    where: {
      codigo: { in: [...codigos] },
      hoja: { inventarioId, numeroConteo: { in: [...rondas] } },
    },
    select: {
      id: true,
      codigo: true,
      hojaId: true,
      hoja: { select: { numeroConteo: true, numero: true } },
      empaques: { select: { nombre: true, factor: true } },
      conteos: { select: { sueltas: true, empaques: { select: { empaqueNombre: true, cantidad: true } } } },
    },
  });

  const porClave = new Map<string, ConteoApuntado | 'ambiguo' | 'sin-conteo'>();
  for (const producto of productos) {
    const clave = `${producto.hoja.numeroConteo}|${producto.codigo}`;
    if (porClave.has(clave)) {
      // El mismo código en DOS hojas de la misma ronda: no se adivina cuál se
      // corrige. `partirEnHojas` reparte el catálogo en bloques sin repetir,
      // así que esto no debería pasar -- y si pasa, es un dato roto que hay
      // que mirar, no una fila que se aplica a ojo.
      porClave.set(clave, 'ambiguo');
      continue;
    }
    const conteo = producto.conteos[0];
    if (conteo === undefined) {
      porClave.set(clave, 'sin-conteo');
      continue;
    }
    porClave.set(clave, {
      hojaId: producto.hojaId,
      numeroHoja: producto.hoja.numero,
      productoId: producto.id,
      // `totalUnidades` y nunca una suma a mano: es el MISMO número que
      // exportó el archivo y el que ve quien corrige de a uno.
      contadoActual: totalUnidades(conteo, producto.empaques),
    });
  }
  return porClave;
}

// ---------------------------------------------------------------------------
// La vista previa
// ---------------------------------------------------------------------------

/** Una fila que SÍ se puede aplicar, con todo lo que hace falta para aplicarla. */
export interface FilaAplicable {
  fila: number;
  inventarioId: number;
  sucursal: string;
  ronda: number;
  hoja: string;
  codigo: string;
  hojaId: number;
  productoId: number;
  contadoActual: number;
  nuevoValor: number;
  motivo: string;
}

export interface ResumenCorrecciones {
  aCorregir: number;
  sinCambio: number;
  rechazadas: number;
  /** Cuántas filas tienen alguna advertencia (hoy, solo "motivo sin cambio"). */
  conAdvertencia: number;
}

export interface VistaPreviaCorreccionesDto {
  ok: true;
  resumen: ResumenCorrecciones;
  aCorregir: readonly FilaAplicable[];
  sinCambio: readonly FilaSinCambio[];
  rechazadas: readonly FilaRechazada[];
}

/**
 * Clasifica cada fila del archivo contra la base. Es TODO lo que hace el paso
 * 1: no escribe ni una celda.
 *
 * Devuelve las tres listas completas -- nunca un resumen sin detalle. Quien
 * mira la vista previa tiene que poder encontrar su fila en el Excel por
 * número y leer por qué no entra.
 */
async function clasificar(
  actor: ColaboradorAutenticado,
  archivo: Buffer,
): Promise<VistaPreviaCorreccionesDto | { ok: false; motivo: string; detalle: string }> {
  const lectura = await leerCorrecciones(archivo);
  if (!lectura.ok) return { ok: false, motivo: lectura.motivo, detalle: lectura.detalle };

  const rechazadas: FilaRechazada[] = [...lectura.rechazadas];
  const aplicables: FilaAplicable[] = [];

  const inventarios = await cargarInventarios(actor, [...new Set(lectura.aCorregir.map((f) => f.inventarioId))]);

  // Agrupadas por inventario: una consulta de conteos por inventario.
  const porInventario = new Map<number, FilaLeida[]>();
  for (const fila of lectura.aCorregir) {
    const grupo = porInventario.get(fila.inventarioId) ?? [];
    grupo.push(fila);
    porInventario.set(fila.inventarioId, grupo);
  }

  for (const [inventarioId, filas] of porInventario) {
    const inventario = inventarios.get(inventarioId);
    if (inventario === undefined) {
      for (const f of filas) {
        rechazadas.push({
          fila: f.fila,
          motivo: 'inventario-inexistente',
          detalle: `No existe el inventario ${inventarioId}. Si el archivo se editó a mano, revisa la columna Inventario.`,
          codigo: f.codigo,
          inventarioId,
          ronda: f.ronda,
        });
      }
      continue;
    }

    if (inventario.bloqueo !== null) {
      for (const f of filas) {
        rechazadas.push({
          fila: f.fila,
          motivo: inventario.bloqueo.motivo,
          detalle: `${inventario.sucursalNombre}: ${inventario.bloqueo.detalle}`,
          codigo: f.codigo,
          inventarioId,
          ronda: f.ronda,
        });
      }
      continue;
    }

    const conteos = await cargarConteos(
      inventarioId,
      [...new Set(filas.map((f) => f.ronda))],
      [...new Set(filas.map((f) => f.codigo))],
    );

    for (const f of filas) {
      /**
       * EL NOMBRE DE LA TIENDA SE VERIFICA, NO SE USA. Si no concuerda con el
       * id, la fila se rechaza en vez de preferir uno de los dos: un archivo
       * donde alguien reordenó o pegó mal las filas no se arregla adivinando
       * cuál de los dos datos era el bueno.
       */
      if (f.tienda !== null && f.tienda !== '' && f.tienda !== inventario.sucursalNombre) {
        rechazadas.push({
          fila: f.fila,
          motivo: 'tienda-no-coincide',
          detalle: `La fila dice "${f.tienda}" pero el inventario ${inventarioId} es de ${inventario.sucursalNombre}. Exporta de nuevo en vez de corregir el nombre a mano.`,
          codigo: f.codigo,
          inventarioId,
          ronda: f.ronda,
        });
        continue;
      }

      const apuntado = conteos.get(`${f.ronda}|${f.codigo}`);

      if (apuntado === undefined) {
        rechazadas.push({
          fila: f.fila,
          motivo: 'producto-inexistente',
          detalle: `El código ${f.codigo} no está en la ronda ${f.ronda} de ${inventario.sucursalNombre}. Puede ser de otra ronda, o de otra tienda.`,
          codigo: f.codigo,
          inventarioId,
          ronda: f.ronda,
        });
        continue;
      }

      if (apuntado === 'ambiguo') {
        rechazadas.push({
          fila: f.fila,
          motivo: 'producto-ambiguo',
          detalle: `El código ${f.codigo} aparece en más de una hoja de la ronda ${f.ronda}: no se puede saber cuál conteo corregir.`,
          codigo: f.codigo,
          inventarioId,
          ronda: f.ronda,
        });
        continue;
      }

      if (apuntado === 'sin-conteo') {
        /**
         * La misma regla que corta la corrección de a uno: sin conteo previo
         * esto no es corregir, es CARGAR un conteo a nombre de nadie. Un 0
         * significa "lo vi y no había" y lo tiene que afirmar quien fue a la
         * góndola.
         */
        rechazadas.push({
          fila: f.fila,
          motivo: 'sin-conteo-previo',
          detalle: `El código ${f.codigo} todavía no tiene ningún conteo cargado en la ronda ${f.ronda}: no hay nada que corregir. Tiene que contarlo quien esté en la góndola — un 0 también se carga a mano.`,
          codigo: f.codigo,
          inventarioId,
          ronda: f.ronda,
        });
        continue;
      }

      /**
       * EL ARCHIVO QUEDÓ VIEJO. Entre que se exportó y que se sube, alguien
       * corrigió ese mismo conteo: aplicar la fila pisaría su trabajo en
       * silencio, y quien lo hizo no se enteraría nunca. Se rechaza con los
       * dos números a la vista para que se pueda decidir.
       */
      if (apuntado.contadoActual !== f.contado) {
        rechazadas.push({
          fila: f.fila,
          motivo: 'valor-desactualizado',
          detalle: `El archivo dice que había ${f.contado} y ahora hay ${apuntado.contadoActual}: alguien corrigió este conteo después de exportar. Exporta de nuevo para no pisar ese cambio.`,
          codigo: f.codigo,
          inventarioId,
          ronda: f.ronda,
        });
        continue;
      }

      aplicables.push({
        fila: f.fila,
        inventarioId,
        sucursal: inventario.sucursalNombre,
        ronda: f.ronda,
        hoja: apuntado.numeroHoja,
        codigo: f.codigo,
        hojaId: apuntado.hojaId,
        productoId: apuntado.productoId,
        contadoActual: apuntado.contadoActual,
        nuevoValor: f.nuevoValor,
        motivo: f.motivo,
      });
    }
  }

  const ordenar = <T extends { fila: number }>(filas: T[]): T[] => [...filas].sort((a, b) => a.fila - b.fila);

  return {
    ok: true,
    resumen: {
      aCorregir: aplicables.length,
      sinCambio: lectura.sinCambio.length,
      rechazadas: rechazadas.length,
      conAdvertencia: lectura.sinCambio.filter((f) => f.advertencias.length > 0).length,
    },
    aCorregir: ordenar(aplicables),
    sinCambio: ordenar([...lectura.sinCambio]),
    rechazadas: ordenar(rechazadas),
  };
}

/** Paso 1: la vista previa. Nunca toca la base. */
export async function previsualizarCorrecciones(
  actor: ColaboradorAutenticado,
  archivo: Buffer,
): Promise<VistaPreviaCorreccionesDto> {
  validarRolDelLote(actor);
  const resultado = await clasificar(actor, archivo);
  if (!resultado.ok) throw new SolicitudInvalida(resultado.detalle);
  return resultado;
}

// ---------------------------------------------------------------------------
// Confirmar
// ---------------------------------------------------------------------------

export interface FilaAplicada {
  fila: number;
  inventarioId: number;
  sucursal: string;
  ronda: number;
  hoja: string;
  codigo: string;
  valorAnterior: number;
  valorNuevo: number;
  /** `true` = la corrección lo hizo cuadrar y salió de la ronda siguiente. */
  salioDeLaRondaSiguiente: boolean;
}

export interface ConfirmarCorreccionesDto {
  nombreArchivo: string;
  aplicadoEn: string;
  resumen: ResumenCorrecciones & { aplicadas: number; fallidas: number };
  aplicadas: readonly FilaAplicada[];
  sinCambio: readonly FilaSinCambio[];
  rechazadas: readonly FilaRechazada[];
}

/**
 * Paso 2: aplicar. Relee el archivo, lo vuelve a clasificar contra la base --
 * el estado pudo cambiar entre la vista previa y esto -- y escribe fila por
 * fila POR `corregirConteo`.
 *
 * Una fila que falla al escribir NO corta el lote: se reporta con el mensaje
 * del servidor y se sigue. Cortar dejaría el resto sin aplicar y sin explicar,
 * que es lo contrario de lo que se pidió.
 */
export async function confirmarCorrecciones(
  actor: ColaboradorAutenticado,
  archivo: Buffer,
  nombreArchivo: string,
): Promise<ConfirmarCorreccionesDto> {
  validarRolDelLote(actor);
  const vista = await clasificar(actor, archivo);
  if (!vista.ok) throw new SolicitudInvalida(vista.detalle);

  const aplicadas: FilaAplicada[] = [];
  const rechazadas: FilaRechazada[] = [...vista.rechazadas];

  for (const fila of vista.aCorregir) {
    try {
      // LA MISMA función que la corrección de a uno. `empaques: []` + las
      // unidades como sueltas: el archivo trae el valor en unidades, que es
      // la unidad del ERP (mismo criterio que la pantalla de ajuste).
      const resultado = await corregirConteo(actor, fila.hojaId, fila.productoId, {
        empaques: [],
        sueltas: fila.nuevoValor,
        motivo: fila.motivo,
      });
      aplicadas.push({
        fila: fila.fila,
        inventarioId: fila.inventarioId,
        sucursal: fila.sucursal,
        ronda: fila.ronda,
        hoja: fila.hoja,
        codigo: fila.codigo,
        valorAnterior: resultado.totalAnterior,
        valorNuevo: resultado.total,
        salioDeLaRondaSiguiente: (resultado.salioDeLaRonda ?? null) !== null,
      });
    } catch (error) {
      rechazadas.push({
        fila: fila.fila,
        motivo: 'fallo-al-aplicar',
        detalle: error instanceof Error ? error.message : 'No se pudo aplicar esta corrección.',
        codigo: fila.codigo,
        inventarioId: fila.inventarioId,
        ronda: fila.ronda,
      });
    }
  }

  const aplicadoEn = new Date();

  /**
   * UNA entrada de auditoría POR EL LOTE, además de la que `corregirConteo`
   * ya escribe por cada corrección. No reemplaza a esas -- el detalle de cada
   * valor sigue estando una por una -- sino que deja constancia del acto:
   * quién subió qué archivo y cuántas filas movió de una vez.
   */
  await registrarAuditoria({
    actorId: actor.colaboradorId,
    accion: 'conteos.corregidos_por_lote',
    entidad: 'archivo',
    entidadId: 0,
    detalle: {
      nombreArchivo,
      aplicadas: aplicadas.length,
      sinCambio: vista.sinCambio.length,
      rechazadas: rechazadas.length,
      inventarios: [...new Set(aplicadas.map((a) => a.inventarioId))],
    },
  });

  return {
    nombreArchivo,
    aplicadoEn: aplicadoEn.toISOString(),
    resumen: {
      ...vista.resumen,
      rechazadas: rechazadas.length,
      aplicadas: aplicadas.length,
      fallidas: rechazadas.length - vista.rechazadas.length,
    },
    aplicadas,
    sinCambio: vista.sinCambio,
    rechazadas: [...rechazadas].sort((a, b) => a.fila - b.fila),
  };
}

// ---------------------------------------------------------------------------
// La exportación: el mismo archivo que después se reimporta
// ---------------------------------------------------------------------------

export interface FiltroExportacion {
  anio: number;
  mes: number;
  /** Una sola tienda. Sin esto van TODAS las del período -- es el caso de la pantalla. */
  sucursalId?: number;
  /** Solo las filas cuyo conteo NO coincide con el stock del ERP. Default `false`. */
  soloSinCuadrar: boolean;
}

/**
 * EL ARCHIVO, con las once tiendas del período si hace falta.
 *
 * Qué filas entran: una por CONTEO CARGADO -- inventario, ronda, producto.
 * Un producto sin conteo no entra, y no es un recorte cosmético: no se puede
 * corregir lo que nadie contó, así que una fila suya solo podría terminar
 * rechazada.
 *
 * ENTRAN TAMBIÉN LAS TIENDAS QUE HOY NO SE PUEDEN CORREGIR (el inventario ya
 * pasó al ajuste final, o cerró), con la columna `Corregible` diciendo por
 * qué. Sacarlas dejaría al Auditor preguntándose dónde está Luzuriaga; el
 * importador las vuelve a chequear igual, así que la columna es informativa.
 *
 * EL STOCK DEL ERP SOLO PARA QUIEN YA PODÍA VERLO: las columnas `Stock ERP` y
 * `Diferencia` se escriben únicamente si `puedeVerLaMatriz` dice que sí para
 * ESE inventario -- la misma regla que decide si la corrección de a uno le
 * devuelve el stock. Para el Coordinador con el inventario en rondas eso es
 * `false`, y es todo el conteo ciego: si viera el stock mientras corrige,
 * dejaría de corregir un error y pasaría a hacer que el inventario cuadre.
 * Por eso las dos columnas se omiten ENTERAS en vez de ir vacías: una celda en
 * blanco en "Stock ERP" diría que el ERP no trajo el dato.
 */
export async function exportarCorrecciones(
  actor: ColaboradorAutenticado,
  filtro: FiltroExportacion,
): Promise<{ buffer: Buffer; nombreArchivo: string; filas: number }> {
  validarRolDelLote(actor);
  if (filtro.sucursalId !== undefined) validarSucursal(actor, filtro.sucursalId);

  const inventarios = await prisma.inventario.findMany({
    where: {
      periodoAnio: filtro.anio,
      periodoMes: filtro.mes,
      estado: { not: 'anulado' },
      ...(filtro.sucursalId !== undefined ? { sucursalId: filtro.sucursalId } : {}),
    },
    select: {
      id: true,
      sucursalId: true,
      estado: true,
      periodoAnio: true,
      periodoMes: true,
      sucursal: { select: { nombre: true } },
    },
    orderBy: { id: 'asc' },
  });

  // El Coordinador solo exporta su tienda: sin esto, un archivo "del período"
  // le traería los conteos de las otras diez, que no son suyos ni para mirar.
  const propios = inventarios.filter((inv) => {
    try {
      validarSucursal(actor, inv.sucursalId);
      return true;
    } catch {
      return false;
    }
  });

  const veElStock = propios.some((inv) =>
    puedeVerLaMatriz(actor, { sucursalId: inv.sucursalId, estado: inv.estado as EstadoInventario }),
  );

  const columnas = veElStock ? [...COLUMNAS_EXPORT] : COLUMNAS_EXPORT.filter((c) => c !== 'Stock ERP' && c !== 'Diferencia');

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Conteos');
  hoja.addRow(columnas);

  let filasEscritas = 0;

  for (const inventario of propios) {
    const estado = inventario.estado as EstadoInventario;
    let corregible = 'si';
    try {
      validarCorreccion(actor, { sucursalId: inventario.sucursalId, estado: estado as never });
    } catch (error) {
      corregible = `no: ${error instanceof Error ? error.message : 'no se puede corregir'}`;
    }

    const [hojas, catalogo] = await Promise.all([
      prisma.hojaConteo.findMany({
        where: { inventarioId: inventario.id },
        select: {
          numero: true,
          numeroConteo: true,
          productos: {
            select: {
              codigo: true,
              descripcion: true,
              empaques: { select: { nombre: true, factor: true } },
              conteos: { select: { sueltas: true, empaques: { select: { empaqueNombre: true, cantidad: true } } } },
            },
          },
        },
        orderBy: [{ numeroConteo: 'asc' }, { numero: 'asc' }],
      }),
      prisma.catalogoItem.findMany({
        where: { inventarioId: inventario.id },
        select: { codigo: true, stockErp: true },
      }),
    ]);

    const stockPorCodigo = new Map(catalogo.map((i) => [i.codigo, i.stockErp]));
    const periodo = `${inventario.periodoAnio}-${String(inventario.periodoMes).padStart(2, '0')}`;

    for (const h of hojas) {
      for (const producto of h.productos) {
        const conteo = producto.conteos[0];
        if (conteo === undefined) continue;
        const contado = totalUnidades(conteo, producto.empaques);
        const stockErp = stockPorCodigo.get(producto.codigo) ?? null;
        // `null` y no 0: sin stock del ERP no hay contra qué comparar, y un 0
        // afirmaría que el ERP dice que no hay ninguno.
        const diferencia = stockErp === null ? null : contado - stockErp;

        if (filtro.soloSinCuadrar && diferencia === 0) continue;

        const valores: Record<ColumnaExport, string | number | null> = {
          Inventario: inventario.id,
          Tienda: inventario.sucursal.nombre,
          Periodo: periodo,
          Ronda: h.numeroConteo,
          Hoja: h.numero,
          Codigo: producto.codigo,
          Descripcion: producto.descripcion,
          Contado: contado,
          // VACÍAS a propósito: son las dos únicas que se llenan a mano. Si
          // "Nuevo valor" viniera con el valor actual, bastaría un pegado
          // distraído para que el archivo pareciera no cambiar nada.
          'Nuevo valor': null,
          Motivo: null,
          Corregible: corregible,
          'Stock ERP': stockErp,
          Diferencia: diferencia,
        };
        hoja.addRow(columnas.map((c) => valores[c]));
        filasEscritas += 1;
      }
    }
  }

  escribirInstrucciones(libro, veElStock);

  const sufijo = filtro.sucursalId === undefined ? 'cadena' : `suc${filtro.sucursalId}`;
  const nombreArchivo = `conteos-${filtro.anio}-${String(filtro.mes).padStart(2, '0')}-${sufijo}.xlsx`;

  return { buffer: Buffer.from(await libro.xlsx.writeBuffer()), nombreArchivo, filas: filasEscritas };
}

/**
 * LA SEGUNDA HOJA, que dice qué columnas lee el importador y qué pasa con cada
 * caso. Es la respuesta a "si una columna es solo informativa y el importador
 * la ignora, dilo": el archivo se explica solo, en el mismo archivo, para
 * quien lo abre seis meses después sin haber leído ninguna documentación.
 *
 * El lector mira SOLO la primera hoja, así que esta no lo molesta.
 */
function escribirInstrucciones(libro: ExcelJS.Workbook, veElStock: boolean): void {
  const hoja = libro.addWorksheet('Instrucciones');
  const lineas: string[][] = [
    ['Cómo corregir conteos con este archivo'],
    [''],
    ['1. Escribe el valor corregido en la columna "Nuevo valor", en UNIDADES.'],
    ['2. Escribe por qué en la columna "Motivo". Es obligatorio en cada fila que cambias (3 a 200 caracteres).'],
    ['3. Guarda el archivo y súbelo. Primero vas a ver una vista previa fila por fila; nada se escribe hasta que confirmes.'],
    [''],
    ['Qué columnas lee el importador'],
    ['Inventario, Ronda, Codigo', 'Identifican el conteo. NO las cambies.'],
    ['Contado', 'Lo que hay cargado hoy. NO lo cambies: se usa para saber si tu fila cambia algo y para avisarte si alguien corrigió ese conteo después de que exportaste.'],
    ['Nuevo valor', 'Lo que quieres dejar. Vacío o igual a Contado = esta fila no cambia nada.'],
    ['Motivo', 'Obligatorio en la fila que cambia. Si la fila no cambia, se ignora (y se te avisa).'],
    [''],
    ['Qué columnas NO lee el importador (son para que puedas leer el archivo)'],
    ['Tienda', 'Se verifica contra Inventario: si no concuerdan, la fila se rechaza.'],
    ['Periodo, Hoja, Descripcion, Corregible', 'Informativas.'],
  ];
  if (veElStock) {
    lineas.push(['Stock ERP, Diferencia', 'Informativas: lo que dice el ERP y cuánto se aparta lo contado.']);
  }
  lineas.push(
    [''],
    ['Qué pasa con las filas que no tocas'],
    ['Se informan como "sin cambio" y no se escriben. La vista previa te dice cuántas son antes de confirmar.'],
    [''],
    ['Filas que no se van a poder aplicar'],
    ['Se listan una por una con su número de fila y el motivo: sin conteo previo, código que no está en esa ronda, inventario que ya pasó al ajuste final, archivo desactualizado.'],
  );
  for (const linea of lineas) hoja.addRow(linea);
}
