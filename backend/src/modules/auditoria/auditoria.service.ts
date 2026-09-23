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
  atribucionDelItem,
  conteoFinal,
  diferenciaUnidades,
  diferenciaValor,
  embudoDeConteos,
  resumir,
  veredicto,
  type AtribucionItem,
  type ItemAuditoria,
  type VeredictoAuditoria,
} from './auditoria.calculos';
import { puedeVerLaMatriz, validarAccesoALaMatriz, validarSucursal } from './auditoria.permisos';
import type { ListarAuditablesQuery, MatrizQuery } from './auditoria.schema';
import { aplicarClasificacionVigente } from '../liquidacion/liquidacion.reclasificacion';

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
 *   conteos[]                         -> los Conteo de las hojas
 *      FINALIZADAS de cada ronda, en orden (indice 0 = ronda 1). Una hoja a
 *      medio contar no entra en la matriz: un conteo parcial leido como
 *      definitivo reporta faltantes que no existen.
 *   zona, productoId                  -> el Producto de la ronda donde
 *      aparecio (la 1ra cubre el catalogo entero).
 *
 * El puente entre las rondas es el CODIGO del item, no el id: el mismo
 * articulo se materializa como un `Producto` distinto en cada hoja de cada
 * ronda. Por eso la matriz agrupa por codigo.
 *
 * ESTO ERAN TRES COLUMNAS (`conteo1/2/3`) y ahora es una lista, porque el
 * Auditor puede abrir rondas extra. La consulta NO filtra por numero de
 * ronda -- nunca lo hizo -- asi que una ronda 4 o 5 entra sola; lo que habia
 * que cambiar era el destino, no el origen. El ajuste final del Auditor
 * tambien llega por aca: escribe sobre el `Conteo` de la ultima ronda, y esa
 * hoja ya esta finalizada.
 */
const INCLUDE_HOJAS_PARA_MATRIZ = {
  // Solo hojas finalizadas: ver el comentario de arriba.
  where: { estado: 'finalizada' as const },
  select: {
    numeroConteo: true,
    zona: true,
    // El rotulo de la hoja ("003"), para mostrar y filtrar en la matriz. Sale
    // de la misma consulta que la zona porque es el mismo tipo de dato.
    numero: true,
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
  /** `Inventario.umbralMediaUnidadPaquete`, congelado al abrir. */
  umbralMediaUnidadPaquete: number;
}

async function traerInventarioOFallar(inventarioId: number): Promise<InventarioParaMatriz> {
  const inv = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    select: { id: true, sucursalId: true, estado: true, umbralMediaUnidadPaquete: true },
  });
  if (inv === null) throw new NoEncontrado(`No existe el inventario ${inventarioId}.`);
  return {
    id: inv.id,
    sucursalId: inv.sucursalId,
    estado: inv.estado as EstadoInventario,
    // CONGELADO al abrir el inventario, no la config de hoy: recalcular agosto
    // con la perilla de hoy le cambiaria el descuento a alguien sobre un sueldo
    // ya pagado (ver el comentario de la columna en schema.prisma).
    umbralMediaUnidadPaquete: inv.umbralMediaUnidadPaquete.toNumber(),
  };
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
/**
 * El Map de ronda -> unidades, pasado a la lista que pide `ItemAuditoria`:
 * indice 0 = ronda 1.
 *
 * LOS HUECOS VAN EN null Y ESO ES TODO EL PUNTO. Un item contado en la ronda
 * 1 y de nuevo en la 4 (salteado en la 2 y la 3) tiene que dar
 * `[5, null, null, 7]` y NO `[5, 7]`: la posicion ES la ronda. Compactar la
 * lista haria que `rondasNecesarias` dijera 2 en vez de 4, y ese numero se
 * congela en `DiferenciaItem.resueltoEnConteo` y arma el embudo -- el
 * historico diria que el item se resolvio en la segunda pasada cuando hizo
 * falta llegar a la cuarta.
 *
 * El largo llega hasta la ronda mas alta que ESTE item tenga contada, no
 * hasta la del inventario: rellenar con nulls al final no agrega
 * informacion, y `conteoQueManda` (ultimo no nulo) y `embudoDeConteos`
 * (indexa con `?? null`) dan lo mismo con lista corta o acolchada.
 *
 * Sin ningun conteo devuelve `[]` -- no una lista de nulls. Las dos dicen lo
 * mismo, y la vacia lo dice sin inventar un largo.
 */
function aListaDeRondas(porRonda: Map<number, number> | undefined): Array<number | null> {
  if (porRonda === undefined || porRonda.size === 0) return [];
  const ultimaRonda = Math.max(...porRonda.keys());
  return Array.from({ length: ultimaRonda }, (_, i) => porRonda.get(i + 1) ?? null);
}

export async function armarMatriz(inventarioId: number): Promise<ItemAuditoria[]> {
  const [catalogo, hojas] = await Promise.all([
    prisma.catalogoItem.findMany({
      where: { inventarioId },
      select: {
        codigo: true,
        descripcion: true,
        stockErp: true,
        precioVenta: true,
        esEmpresa: true,
        // Las tres vias y su denominador. `clase` reemplaza conceptualmente a
        // `esEmpresa` (clase == 'empresa' es esEmpresa == true, min-1 lo dejo
        // con test), pero las dos viajan: el sello y los inventarios viejos
        // siguen leyendo el booleano.
        clase: true,
        empaqueCompra: true,
        empaqueCompraSimbolo: true,
      },
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
    { productoId: number; zona: string; hoja: string; descripcion: string; conteos: Map<number, number> }
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
        hoja: hoja.numero,
        descripcion: producto.descripcion,
        conteos: new Map<number, number>(),
      };
      // La ronda 1 manda para productoId/zona/hoja: es la que cubre el
      // catalogo entero, y las hojas de reconteo se arman por diferencia, no
      // por zona. El numero de hoja sigue la MISMA regla que la zona porque es
      // el mismo tipo de dato -- si mandara el reconteo, un item cuadrado en la
      // ronda 1 y otro que llego a la 3 se mostrarian con hojas de rondas
      // distintas, y "Hoja 003" querria decir dos cosas.
      if (hoja.numeroConteo === 1) {
        entrada.productoId = producto.id;
        entrada.zona = hoja.zona;
        entrada.hoja = hoja.numero;
      }
      entrada.conteos.set(hoja.numeroConteo, unidades);
      porCodigo.set(producto.codigo, entrada);
    }
  }

  return catalogo.map((item) => {
    const contado = porCodigo.get(item.codigo);
    return {
      // 0 = el item esta en el catalogo del ERP pero ninguna hoja
      // finalizada lo incluye todavia. Se devuelve igual, con la lista de
      // conteos vacia: un item que nadie conto es informacion, no un
      // motivo para esconderlo de la matriz.
      productoId: contado?.productoId ?? 0,
      codigo: item.codigo,
      descripcion: contado?.descripcion ?? item.descripcion,
      zona: contado?.zona ?? '',
      // VACIO, igual que la zona, cuando ninguna hoja finalizada lo incluye.
      // No se inventa un "sin hoja" ni un 0: cualquier cosa que parezca un
      // numero de hoja se leeria como una hoja que existe.
      hoja: contado?.hoja ?? '',
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
      // El snapshot manda: la excepcion MANUAL del Auditor no entra acá, se
      // resuelve en vivo al liquidar (ver `claseEfectiva`). Mezclarlas haria
      // que una reclasificacion de hoy pareciera parte de lo que se conto.
      clase: item.clase,
      // La forzada y el empaque corregido son EN VIVO: los aplica
      // `aplicarClasificacionVigente`, no el snapshot. Arrancan en null para
      // que quede claro que este no es su lugar.
      claseForzada: null,
      empaqueCompra: item.empaqueCompra,
      empaqueCompraSimbolo: item.empaqueCompraSimbolo,
      // El SNAPSHOT no sabe de correcciones: la del Auditor es en vivo y la
      // aplica `aplicarClasificacionVigente`, igual que la clase. Arranca en
      // null para que quede claro que este no es su lugar.
      empaqueCompraCorregido: null,
      conteos: aListaDeRondas(contado?.conteos),
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
  /**
   * A QUE CUADRO VA ESTE ITEM Y POR QUE, ya resuelto por el backend.
   *
   * Sale del MISMO calculo que los totales del encabezado
   * (`auditoria.calculos.ts#atribucionDelItem` -> `repartoDelItem`), no de una
   * segunda cuenta: la suma de las atribuciones tiene que dar exactamente esos
   * totales, y con dos calculos eso deja de estar garantizado. Ver el
   * comentario de `AtribucionItem`.
   */
  atribucion: AtribucionItem;
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

  // LA MISMA fuente que usa la liquidacion para decidir empresa/empleado
  // (liquidacion.reclasificacion.ts) -- ver esa funcion para el bug real que
  // existe para evitar: la matriz no puede seguir mostrando la clasificacion
  // de Dynamics cuando el Auditor ya la cambio.
  const completa = await aplicarClasificacionVigente(inventarioId, inv.estado, await armarMatriz(inventarioId));

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
    resumen: resumir(completa, inv.umbralMediaUnidadPaquete),
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
        atribucion: atribucionDelItem(i, inv.umbralMediaUnidadPaquete),
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

  const completa = await aplicarClasificacionVigente(inventarioId, inv.estado, await armarMatriz(inventarioId));
  const zonas = [...new Set(completa.map((i) => i.zona).filter((z) => z !== ''))].sort();

  return {
    inventarioId,
    estado: inv.estado,
    resumen: resumir(completa, inv.umbralMediaUnidadPaquete),
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
  // El auditor tambien elige sucursal (o ninguna = todas), igual que el
  // administrador -- corregido por el cliente (2026-09-09). Antes se
  // ignoraba lo que pedia y se forzaba a la suya.
  const sucursalId = actor.rol === 'administrador' || actor.rol === 'auditor' ? query.sucursalId : (actor.sucursalId ?? undefined);
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
