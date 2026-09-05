/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * backend/README.md). Las reglas -- quien ve que, como se calcula una
 * diferencia, como filtra la pantalla -- viven en auditoria.permisos.ts y
 * auditoria.calculos.ts, sin Prisma, para poder testearse sin base.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { totalUnidades } from '../hojas/hojas.calculos';
import type { EstadoInventario } from '../historial/historial.permisos';
import {
  aplicarFiltro,
  conteoFinal,
  diferenciaUnidades,
  diferenciaValor,
  embudoDeConteos,
  resumir,
  veredicto,
  type ItemAuditoria,
  type VeredictoAuditoria,
} from './auditoria.calculos';
import { puedeVerLaMatriz, validarAccesoALaMatriz, validarSucursal } from './auditoria.permisos';
import type { ListarAuditablesQuery, MatrizQuery } from './auditoria.schema';

// ---------------------------------------------------------------------------
// Armado de la matriz
// ---------------------------------------------------------------------------

/**
 * De donde sale cada columna:
 *
 *   stockErp, precioVenta, esEmpresa  -> CatalogoItem (el snapshot de
 *      Dynamics tomado al abrir el mes). NO se relee de Dynamics al
 *      auditar: el inventario se compara contra la foto del arranque, no
 *      contra lo que el ERP diga hoy.
 *   conteo1 / conteo2 / conteo3       -> los Conteo de las hojas
 *      FINALIZADAS de cada ronda. Una hoja a medio contar no entra en la
 *      matriz: un conteo parcial leido como definitivo reporta faltantes
 *      que no existen.
 *   zona, productoId                  -> el Producto de la ronda donde
 *      aparecio (la 1ra cubre el catalogo entero).
 *
 * El puente entre las tres rondas es el CODIGO del item, no el id: el mismo
 * articulo se materializa como un `Producto` distinto en cada hoja de cada
 * ronda. Por eso la matriz agrupa por codigo.
 */
const INCLUDE_HOJAS_PARA_MATRIZ = {
  // Solo hojas finalizadas: ver el comentario de arriba.
  where: { estado: 'finalizada' as const },
  select: {
    numeroConteo: true,
    zona: true,
    productos: {
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        empaques: { select: { nombre: true, factor: true } },
        conteos: {
          select: {
            sueltas: true,
            empaques: { select: { empaqueNombre: true, cantidad: true } },
          },
        },
      },
    },
  },
} satisfies Prisma.Inventario$hojasArgs;

interface InventarioParaMatriz {
  id: number;
  sucursalId: number;
  estado: EstadoInventario;
}

async function traerInventarioOFallar(inventarioId: number): Promise<InventarioParaMatriz> {
  const inv = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true },
  });
  if (inv === null) throw new NoEncontrado(`No existe el inventario ${inventarioId}.`);
  return { id: inv.id, sucursalId: inv.sucursalId, estado: inv.estado as EstadoInventario };
}

/**
 * Construye la matriz completa del inventario. Se arma entera (no paginada)
 * porque el resumen del encabezado se calcula sobre TODOS los items -- si
 * se paginara antes de resumir, los totales cambiarian al pasar de pagina.
 * La paginacion se aplica despues, sobre el resultado ya filtrado.
 *
 * EXPORTADA (no solo de este modulo): rondas.service.ts#cerrar la reusa
 * para calcular `ResultadoInventario` al cerrar el conteo -- mismo dato,
 * mismo cruce catalogo x 3 rondas, cero motivo para recalcularlo aparte
 * (ver el comentario de `embudoDeConteos` en auditoria.calculos.ts).
 */
export async function armarMatriz(inventarioId: number): Promise<ItemAuditoria[]> {
  const [catalogo, hojas] = await Promise.all([
    prisma.catalogoItem.findMany({
      where: { inventarioId },
      select: { codigo: true, descripcion: true, stockErp: true, precioVenta: true, esEmpresa: true },
      orderBy: { codigo: 'asc' },
    }),
    prisma.hojaConteo.findMany({
      where: { inventarioId, estado: 'finalizada' },
      select: INCLUDE_HOJAS_PARA_MATRIZ.select,
    }),
  ]);

  /** codigo -> lo que dio cada ronda. */
  const porCodigo = new Map<
    string,
    { productoId: number; zona: string; descripcion: string; conteos: Map<number, number> }
  >();

  for (const hoja of hojas) {
    for (const producto of hoja.productos) {
      const conteo = producto.conteos[0];
      if (conteo === undefined) continue; // producto en la hoja pero sin contar

      // La misma cuenta que usa el modulo de hojas -- no se reimplementa
      // aca: es el numero que se audita, no puede haber dos versiones.
      const unidades = totalUnidades(
        { empaques: conteo.empaques, sueltas: conteo.sueltas },
        producto.empaques,
      );

      const entrada = porCodigo.get(producto.codigo) ?? {
        productoId: producto.id,
        zona: hoja.zona,
        descripcion: producto.descripcion,
        conteos: new Map<number, number>(),
      };
      // La ronda 1 manda para productoId/zona: es la que cubre el catalogo
      // entero, y las hojas de reconteo se arman por diferencia, no por zona.
      if (hoja.numeroConteo === 1) {
        entrada.productoId = producto.id;
        entrada.zona = hoja.zona;
      }
      entrada.conteos.set(hoja.numeroConteo, unidades);
      porCodigo.set(producto.codigo, entrada);
    }
  }

  return catalogo.map((item) => {
    const contado = porCodigo.get(item.codigo);
    return {
      // 0 = el item esta en el catalogo del ERP pero ninguna hoja
      // finalizada lo incluye todavia. Se devuelve igual, con los tres
      // conteos en null: un item que nadie conto es informacion, no un
      // motivo para esconderlo de la matriz.
      productoId: contado?.productoId ?? 0,
      codigo: item.codigo,
      descripcion: contado?.descripcion ?? item.descripcion,
      zona: contado?.zona ?? '',
      // NULL SE PROPAGA COMO NULL, no como 0.
      //
      // El stock sale UNICAMENTE de CatalogoItem.stockErp -- el snapshot de
      // Dynamics tomado al abrir el mes -- y nunca de otro lado: `Producto`
      // no tiene stock y no puede tenerlo (conteo ciego).
      //
      // Cuando el snapshot no trajo el dato, viaja null y el item queda con
      // veredicto `sin_erp`. Poner 0 en su lugar hacia que 11.835 productos
      // reales sin stock cargado se reportaran como "100% cuadrados": el
      // peor error posible en la pantalla donde se decide si el inventario
      // cierra. Ver el comentario de cabecera de auditoria.calculos.ts.
      precioVenta: item.precioVenta?.toNumber() ?? null,
      stockErp: item.stockErp,
      conteo1: contado?.conteos.get(1) ?? null,
      conteo2: contado?.conteos.get(2) ?? null,
      conteo3: contado?.conteos.get(3) ?? null,
      esEmpresa: item.esEmpresa,
    };
  });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export interface FilaMatrizDto extends ItemAuditoria {
  /** Derivados -- nunca columnas (ver auditoria.calculos.ts). */
  conteoFinal: number | null;
  /** null = falta el stock del ERP o el conteo: no se puede comparar. */
  diferenciaUnidades: number | null;
  /** null = no se puede calcular la diferencia, o el item no tiene precio. */
  diferenciaValor: number | null;
  veredicto: VeredictoAuditoria;
  /**
   * Motivo legible de por que este item no se puede auditar todavia. null
   * cuando si se puede. Va en la fila y no solo en el veredicto para que la
   * pantalla pueda mostrarlo tal cual, sin traducir un enum a castellano.
   */
  motivoSinDato: string | null;
}

/**
 * La matriz de la pantalla del Auditor: ERP contra los 3 conteos.
 *
 * Devuelve `resumen` calculado sobre el inventario COMPLETO y `matriz`
 * paginada. Son dos cosas distintas a proposito: el encabezado tiene que
 * decir "7.870 de 8.000 cuadrados" siempre, no "98 de 100 en esta pagina".
 */
export async function matriz(
  actor: ColaboradorAutenticado,
  inventarioId: number,
  query: MatrizQuery,
): Promise<Record<string, unknown>> {
  const inv = await traerInventarioOFallar(inventarioId);
  validarAccesoALaMatriz(actor, inv);

  const completa = await armarMatriz(inventarioId);

  let filtrada = aplicarFiltro(completa, query.filtro);
  if (query.zona !== undefined) {
    filtrada = filtrada.filter((i) => i.zona === query.zona);
  }
  if (query.busqueda !== undefined) {
    const aguja = query.busqueda.toLowerCase();
    filtrada = filtrada.filter(
      (i) => i.codigo.toLowerCase().includes(aguja) || i.descripcion.toLowerCase().includes(aguja),
    );
  }

  const pagina = filtrada.slice(query.desplazamiento, query.desplazamiento + query.limite);

  return {
    inventarioId,
    estado: inv.estado,
    // El resumen NUNCA se calcula sobre la pagina ni sobre el filtro: es el
    // estado del inventario entero.
    resumen: resumir(completa),
    embudo: embudoDeConteos(completa),
    filtro: query.filtro,
    total: filtrada.length,
    limite: query.limite,
    desplazamiento: query.desplazamiento,
    matriz: pagina.map((i): FilaMatrizDto => {
      const v = veredicto(i);
      return {
        ...i,
        conteoFinal: conteoFinal(i),
        diferenciaUnidades: diferenciaUnidades(i),
        diferenciaValor: diferenciaValor(i),
        veredicto: v,
        motivoSinDato:
          v === 'sin_erp'
            ? 'Sin dato del ERP: el snapshot de Dynamics no trajo stock para este ítem, así que no hay contra qué compararlo.'
            : v === 'sin_contar'
              ? 'Sin contar: ninguna hoja finalizada incluye este ítem todavía.'
              : null,
      };
    }),
  };
}

/** Solo el encabezado, sin traer las filas. Lo usa la pantalla al entrar. */
export async function resumen(actor: ColaboradorAutenticado, inventarioId: number): Promise<Record<string, unknown>> {
  const inv = await traerInventarioOFallar(inventarioId);
  validarAccesoALaMatriz(actor, inv);

  const completa = await armarMatriz(inventarioId);
  const zonas = [...new Set(completa.map((i) => i.zona).filter((z) => z !== ''))].sort();

  return {
    inventarioId,
    estado: inv.estado,
    resumen: resumir(completa),
    embudo: embudoDeConteos(completa),
    // Para poblar el selector de zona sin bajarse las 8.000 filas.
    zonas,
  };
}

/**
 * Que inventarios puede auditar este actor. Devuelve tambien los que NO
 * puede abrir todavia, marcados con `puedeVerMatriz: false` y el motivo:
 * un coordinador que no ve la matriz del mes en curso necesita entender
 * por que, no encontrarse una lista vacia.
 */
export async function listarAuditables(
  actor: ColaboradorAutenticado,
  query: ListarAuditablesQuery,
): Promise<Record<string, unknown>> {
  const sucursalId = actor.rol === 'administrador' ? query.sucursalId : (actor.sucursalId ?? undefined);
  if (sucursalId !== undefined) validarSucursal(actor, sucursalId);

  const filas = await prisma.inventario.findMany({
    where: {
      ...(sucursalId !== undefined ? { sucursalId } : {}),
      // Un inventario anulado no se audita: no produce resultado.
      estado: { not: 'anulado' },
    },
    select: {
      id: true,
      sucursalId: true,
      estado: true,
      periodoAnio: true,
      periodoMes: true,
      snapshotItems: true,
      sucursal: { select: { nombre: true } },
      _count: { select: { hojas: true } },
    },
    orderBy: [{ periodoAnio: 'desc' }, { periodoMes: 'desc' }],
  });

  return {
    inventarios: filas.map((f) => {
      const paraPermisos = { sucursalId: f.sucursalId, estado: f.estado as EstadoInventario };
      const puede = puedeVerLaMatriz(actor, paraPermisos);
      return {
        id: f.id,
        sucursalId: f.sucursalId,
        sucursalNombre: f.sucursal.nombre,
        estado: f.estado,
        periodo: `${f.periodoAnio}-${String(f.periodoMes).padStart(2, '0')}`,
        snapshotItems: f.snapshotItems,
        hojas: f._count.hojas,
        puedeVerMatriz: puede,
        motivo: puede
          ? null
          : 'La auditoria de un inventario en curso es solo del auditor (conteo ciego). Vas a poder verla cuando el conteo cierre.',
      };
    }),
  };
}
