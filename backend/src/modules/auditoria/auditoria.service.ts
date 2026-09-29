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
  detalleDeDiferencias,
  diferenciaUnidades,
  diferenciaValor,
  embudoDeConteos,
  filaDeCadena,
  filaDeCadenaSinInventario,
  resumir,
  stockDeLaMedicion,
  totalizarCadena,
  veredicto,
  type AtribucionItem,
  type FilaCadena,
  type ItemAuditoria,
  type StockDeLaMedicion,
  type TotalCadena,
  type VeredictoAuditoria,
} from './auditoria.calculos';
import {
  armarLibroDiferenciasCadena,
  nombreArchivoDiferenciasCadena,
  type FilaExportDiferenciaCadena,
} from './auditoria.exportar-diferencias';
import {
  puedeVerLaMatriz,
  validarAccesoALaCadena,
  validarAccesoALaMatriz,
  validarSucursal,
} from './auditoria.permisos';
import type { CadenaQuery, ListarAuditablesQuery, MatrizQuery } from './auditoria.schema';
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
 *      contra lo que el ERP diga hoy. `stockErp` es el de la RONDA 1.
 *   stockPorRonda[]                   -> StockRonda: el stock que el ERP dio
 *      PARA CADA RONDA (decision del cliente 2026-09-29, ver
 *      `ItemAuditoria.stockPorRonda`). La ronda 1 tambien esta ahi y es la
 *      misma cifra que `CatalogoItem.stockErp`; de las dos manda esa.
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

/**
 * El stock que el ERP dio para CADA ronda, por codigo: indice 0 = ronda 1.
 *
 * LA MISMA FORMA QUE `aListaDeRondas` y por la misma razon -- la POSICION es la
 * ronda, asi que los huecos van en `null` y no se compactan. Una ronda que no
 * bajo stock para un item deja un `null` en su posicion, y ese `null` NO ES 0
 * (ver la cabecera de auditoria.calculos.ts).
 *
 * El largo llega hasta la ronda mas alta que ESTE item tenga en la tabla. Un
 * inventario sin stock por ronda -- todos los que ya estaban en la base antes
 * de la migracion de datos -- no aparece en el Map y su item queda con `[]`:
 * todo cae a la ronda 1 y el calculo da exactamente lo que daba antes.
 *
 * SE CONSULTA APARTE Y NO CON UN `include` DEL CATALOGO porque no hay FK entre
 * las dos tablas: el puente es el CODIGO, igual que entre rondas (ver el
 * comentario de `StockRonda.codigo` en schema.prisma).
 */
export async function stockPorRondaDelInventario(
  inventarioId: number,
): Promise<Map<string, Array<number | null>>> {
  const filas = await prisma.stockRonda.findMany({
    where: { inventarioId },
    select: { codigo: true, numeroConteo: true, stockErp: true },
    orderBy: { numeroConteo: 'asc' },
  });

  const porCodigo = new Map<string, Array<number | null>>();
  for (const fila of filas) {
    const lista = porCodigo.get(fila.codigo) ?? [];
    // Rellena los huecos con null hasta la posicion de esta ronda: una ronda 3
    // sin ronda 2 tiene que dar `[x, null, y]` y no `[x, y]`, o la posicion
    // dejaria de ser la ronda y el stock de la 3 se leeria como el de la 2.
    while (lista.length < fila.numeroConteo - 1) lista.push(null);
    lista[fila.numeroConteo - 1] = fila.stockErp;
    porCodigo.set(fila.codigo, lista);
  }
  return porCodigo;
}

export async function armarMatriz(inventarioId: number): Promise<ItemAuditoria[]> {
  const [catalogo, hojas, stockPorRonda] = await Promise.all([
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
    stockPorRondaDelInventario(inventarioId),
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
      // EL STOCK DE CADA RONDA, al lado de `conteos` y con la misma forma: el
      // ultimo conteo se compara contra el stock de SU ronda, no contra esta
      // unica vara (ver `ItemAuditoria.stockPorRonda`). `[]` para el inventario
      // que no tiene stock por ronda -- ahi todo cae a `stockErp` y el
      // resultado es identico al de antes del cambio.
      stockPorRonda: stockPorRonda.get(item.codigo) ?? [],
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
   * CONTRA QUE STOCK SE MIDIO ESTA FILA Y DE QUE RONDA SALIO.
   *
   * Existe porque desde 2026-09-29 la vara ya no es una sola: cada conteo se
   * compara contra el stock que el ERP dio PARA SU RONDA, y una ronda sin stock
   * propio cae al de la ronda 1. Esa caida NO puede ser silenciosa -- "faltan
   * 3" contra el stock del dia y "faltan 3" contra el del dia 22 no son la
   * misma afirmacion, y la matriz tiene que poder marcar la fila
   * (`cayoALaRonda1`) para que quien discuta un descuento sepa cual le toco.
   *
   * Lo resuelve el servidor y no la pantalla, por lo mismo que `atribucion`:
   * dos lugares que decidan con que stock se midio son dos lugares que pueden
   * discrepar sobre el mismo item.
   */
  stockDeLaMedicion: StockDeLaMedicion;
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
        stockDeLaMedicion: stockDeLaMedicion(i),
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

// ---------------------------------------------------------------------------
// LA CADENA: las diez tiendas de un periodo en una sola llamada
// ---------------------------------------------------------------------------

export interface CadenaDto {
  periodo: { anio: number; mes: number };
  total: TotalCadena;
  tiendas: FilaCadena[];
}

/** El inventario que manda en una tienda de un periodo, listo para armar su matriz. */
interface InventarioDeLaCadena {
  id: number;
  sucursalId: number;
  estado: EstadoInventario;
  /** `mensual` o `anual`. Viaja porque es lo que DECIDE cual manda -- ver abajo. */
  tipo: string;
  /** `Inventario.umbralMediaUnidadPaquete`, ya en `number`. */
  umbral: number;
  /**
   * `ResultadoInventario.montoNegativos` -- los ajustes del mes, que restan del
   * total a descontar. `null` = no se capturo (ver `filaDeCadena`), y son dos
   * casos: el inventario no tiene resultado todavia, o lo tiene con la columna
   * en NULL porque nadie importo el Excel de Dynamics.
   *
   * Viaja junto al inventario y NO en una consulta por tienda: sale del mismo
   * `findMany` de arriba por la relacion `resultado`, asi que la cadena entera
   * cuesta lo mismo que antes.
   */
  montoNegativos: number | null;
}

interface PeriodoDeLaCadena {
  anio: number;
  mes: number;
  /** sucursalId -> el inventario que manda ahi. Sin entrada = no arranco el periodo. */
  porSucursal: Map<number, InventarioDeLaCadena>;
}

/**
 * QUE PERIODO ES Y QUE INVENTARIO MANDA EN CADA TIENDA. Es la entrada comun de
 * `cadena` (la tabla) y de `exportarDiferenciasDeLaCadena` (el .xlsx que la
 * respalda).
 *
 * ESTA EXTRAIDO Y NO COPIADO A PROPOSITO. Si la tabla y su archivo de respaldo
 * eligieran los inventarios con reglas separadas, algun dia dirian cosas
 * distintas sobre los MISMOS items -- el Auditor baja el detalle para explicar
 * una cifra de la tabla y el detalle no suma esa cifra. Es el peor resultado
 * posible de este endpoint, peor que no tenerlo.
 *
 * Las tres reglas que viven acá:
 *
 *   1. EL PERIODO EN CURSO ES LA HORA DEL SERVIDOR, igual que al TOMAR el
 *      snapshot (d365-catalogo.service.ts): las dos puntas tienen que estar de
 *      acuerdo en qué mes es, o el panel pediria un periodo en el que nadie creo
 *      nada. Y el nombre del archivo sale de acá por lo mismo -- el front no
 *      conoce el mes que eligio el servidor.
 *   2. UN INVENTARIO ANULADO NO SE AUDITA: no produce resultado (misma regla que
 *      `listarAuditables`).
 *   3. UNA TIENDA, UN INVENTARIO -- Y EL PERIODO PUEDE TENER DOS. La unique del
 *      schema es `[sucursalId, periodoAnio, periodoMes, tipo]`, asi que una
 *      tienda puede tener el MENSUAL y el ANUAL del mismo periodo. La tabla
 *      tiene una fila por tienda, asi que hay que elegir, y MANDA EL MENSUAL: es
 *      el que se hace todos los meses, el anual es la excepcion y hay que
 *      pedirlo explicito (ver el comentario de `Inventario.tipo` en
 *      schema.prisma). Con un solo inventario -- el caso normal -- no se nota.
 */
async function inventariosDelPeriodo(query: CadenaQuery): Promise<PeriodoDeLaCadena> {
  const ahora = new Date();
  const anio = query.anio ?? ahora.getFullYear();
  const mes = query.mes ?? ahora.getMonth() + 1;

  const inventarios = await prisma.inventario.findMany({
    where: { periodoAnio: anio, periodoMes: mes, estado: { not: 'anulado' } },
    select: {
      id: true,
      sucursalId: true,
      estado: true,
      tipo: true,
      umbralMediaUnidadPaquete: true,
      // LOS AJUSTES DEL MES EN LA MISMA CONSULTA, por la relacion: el total a
      // descontar de cada tienda los resta, y pedirlos tienda por tienda
      // volveria a la cadena en N+1 justo en el endpoint que existe para
      // ahorrar las diez llamadas del navegador.
      resultado: { select: { montoNegativos: true } },
    },
    orderBy: { id: 'asc' },
  });

  const porSucursal = new Map<number, InventarioDeLaCadena>();
  for (const inv of inventarios) {
    const previo = porSucursal.get(inv.sucursalId);
    if (previo === undefined || (previo.tipo !== 'mensual' && inv.tipo === 'mensual')) {
      porSucursal.set(inv.sucursalId, {
        id: inv.id,
        sucursalId: inv.sucursalId,
        estado: inv.estado as EstadoInventario,
        tipo: inv.tipo,
        // CONGELADO al abrir el inventario, no la config de hoy, y de CADA
        // inventario y no una constante: dos tiendas del mismo mes pueden tener
        // umbrales distintos si la perilla se movio entre un snapshot y el otro,
        // y recalcular con la de hoy cambiaria un descuento ya comunicado.
        umbral: inv.umbralMediaUnidadPaquete.toNumber(),
        // Sin resultado Y con la columna en NULL colapsan al mismo `null`: la
        // formula del neto trata los dos igual ("no se capturo"), y quien
        // necesita distinguirlos -- la guarda de `liquidar()` -- lee la columna
        // directo, no esta tabla.
        montoNegativos: inv.resultado?.montoNegativos?.toNumber() ?? null,
      });
    }
  }

  return { anio, mes, porSucursal };
}

/**
 * LA TABLA DE TODAS LAS SUCURSALES DE UN PERIODO.
 *
 * Pedido del usuario: *"¿podemos mostrar una tabla con todas las sucursales
 * implicadas en el inventario?"*. El Panel muestra una tienda por vez y el
 * Auditor tiene diez: sin esto, la pantalla haria diez pedidos a `/resumen`
 * desde el navegador y armaria el total en el cliente -- o sea, una segunda
 * cuenta de la plata, en el unico lugar donde nadie la puede auditar.
 *
 * ---------------------------------------------------------------------------
 * CADA CIFRA SALE DE LA MISMA TUBERIA QUE `/resumen`
 * ---------------------------------------------------------------------------
 * `armarMatriz` -> `aplicarClasificacionVigente` -> `resumir`, con el umbral
 * de CADA inventario. No hay ni una cuenta nueva acá: si esta tabla y el panel
 * de una tienda dieran distinto, la pantalla mostraria dos verdades.
 *
 * El umbral es el de cada inventario (`umbralMediaUnidadPaquete`, congelado al
 * abrirlo) y no una constante ni la config de hoy: dos tiendas del mismo mes
 * pueden tener umbrales distintos si la perilla se movio entre un snapshot y
 * el otro, y recalcular con la de hoy cambiaria un descuento ya comunicado.
 *
 * ---------------------------------------------------------------------------
 * CUANTO CUESTA -- MEDIDO, NO ESTIMADO
 * ---------------------------------------------------------------------------
 * Medido el 2026-09-25 contra la base de desarrollo, con `armarMatriz` +
 * `aplicarClasificacionVigente` + `resumir` por tienda (mejor de 3 corridas):
 *
 *   una tienda de   985 items ->   18 ms
 *   una tienda de    40 items ->    1 ms
 *   el endpoint entero (11 tiendas, 2 con inventario, 1.025 items) -> 18 ms
 *   respuesta: 5,6 KB de JSON
 *
 * O sea ~54 items por milisegundo, y el costo es del ARMADO, no de las
 * consultas: las nueve tiendas sin inventario no cuestan nada porque no se les
 * arma matriz.
 *
 * PROYECCION, dicha como proyeccion y no como medicion: diez tiendas de ~1.000
 * items son ~180 ms. Con el catalogo ANUAL completo (11.835 items por tienda)
 * serian ~2 s, y ahi si habria que hablarlo -- pero el anual es una vez al ano
 * y hoy no existe ninguno en la base para medirlo de verdad.
 *
 * ---------------------------------------------------------------------------
 * UNA TIENDA, UN INVENTARIO -- Y EL PERIODO PUEDE TENER DOS
 * ---------------------------------------------------------------------------
 * La regla ("manda el MENSUAL") y la del periodo en curso viven en
 * `inventariosDelPeriodo`, compartidas con el export del detalle: ver su
 * comentario para por que estan extraidas y no copiadas.
 */
export async function cadena(actor: ColaboradorAutenticado, query: CadenaQuery): Promise<CadenaDto> {
  validarAccesoALaCadena(actor);

  const [sucursales, periodo] = await Promise.all([
    // TODAS las tiendas activas, con inventario o sin el: `inventarioId: null`
    // es la cobertura del periodo, no un hueco que convenga esconder.
    // Las inactivas no van -- una tienda cerrada no deberia contar este mes --
    // pero sus inventarios historicos siguen existiendo (Sucursal.activa).
    prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { id: 'asc' } }),
    inventariosDelPeriodo(query),
  ]);

  /**
   * SECUENCIAL, no `Promise.all`. Es la forma obvia y la que acota la memoria:
   * con diez matrices en paralelo hay diez catalogos completos vivos a la vez
   * (~10.000 items con sus conteos) en vez de uno. Paralelizar es la palanca
   * que queda si el numero de arriba dejara de alcanzar -- no se toma por
   * cuenta propia.
   */
  const filas: FilaCadena[] = [];
  for (const suc of sucursales) {
    const inv = periodo.porSucursal.get(suc.id);
    if (inv === undefined) {
      filas.push(filaDeCadenaSinInventario(suc.id, suc.nombre));
      continue;
    }
    // LA MISMA fuente que la matriz y que la liquidacion: la clasificacion
    // vigente del Auditor, no la del snapshot (ver liquidacion.reclasificacion).
    const completa = await aplicarClasificacionVigente(inv.id, inv.estado, await armarMatriz(inv.id));
    filas.push(
      filaDeCadena(
        { sucursalId: suc.id, sucursal: suc.nombre, inventarioId: inv.id, estado: inv.estado },
        resumir(completa, inv.umbral),
        // Los ajustes del mes de ESTA tienda. Con esto, el total a descontar de
        // la fila es identico al que Liquidacion va a mostrar para el mismo
        // inventario; sin ellos (lo normal en `ajuste_auditor`, que no tiene
        // resultado todavia) es el neto antes de los ajustes.
        inv.montoNegativos,
      ),
    );
  }

  return { periodo: { anio: periodo.anio, mes: periodo.mes }, total: totalizarCadena(filas), tiendas: filas };
}

/**
 * EL .XLSX CON EL DETALLE POR PRODUCTO de la tabla de arriba: una fila por
 * producto con diferencia, de TODAS las tiendas del periodo, en una sola hoja.
 *
 * Pedido del usuario: *"Incluir los sobrantes y faltantes en la tabla, asi
 * puede sacar sus calculos y exportar el detalle de sobrantes y faltantes por
 * productos"*. La tabla dice cuanta plata; este archivo dice CUALES productos.
 *
 * ---------------------------------------------------------------------------
 * LA MISMA TUBERIA QUE LA TABLA, HASTA EL ULTIMO PASO
 * ---------------------------------------------------------------------------
 *   `inventariosDelPeriodo` -> `armarMatriz` -> `aplicarClasificacionVigente`
 *      -> y acá `detalleDeDiferencias` donde la tabla usa `resumir`
 *
 * Los tres primeros pasos son LITERALMENTE los mismos que `cadena`, no una
 * copia: el primero porque esta extraido, y los otros dos porque son las mismas
 * dos llamadas. Por eso la suma de `Monto` del archivo filtrada por cuadro
 * cierra contra la columna correspondiente de la tabla -- y por eso NO se lee
 * `DiferenciaItem` (ver el comentario de cabecera de
 * auditoria.exportar-diferencias.ts: los dos inventarios de 2026-09 tienen 0
 * filas ahi, el archivo bajaria vacio justo cuando se lo necesita).
 *
 * TIENDAS ACTIVAS, ordenadas por NOMBRE. Activas por lo mismo que la tabla: una
 * tienda desactivada conserva sus inventarios historicos y si aportara filas, el
 * archivo no cerraria contra la tabla que no la muestra. Por nombre y no por id
 * -- el unico lugar donde este endpoint difiere de `/cadena` a proposito --
 * porque en un archivo de diez tiendas las filas de una misma tienda tienen que
 * quedar juntas y en un orden legible, que es lo mismo que ya hace
 * `exportarDiferenciasConsolidado`. La tabla, en cambio, tiene su propio orden
 * de pantalla y no se toca.
 *
 * Una tienda sin inventario en el periodo NO aporta filas y eso no es esconderla:
 * la cobertura del periodo la reporta la tabla con su fila en cero, este archivo
 * es el detalle de las diferencias y una tienda que no arranco no tiene ninguna.
 *
 * ---------------------------------------------------------------------------
 * CUANTO CUESTA -- MEDIDO, NO ESTIMADO
 * ---------------------------------------------------------------------------
 * Medido el 2026-09-25 contra la base de desarrollo, por API y contra el backend
 * vivo (11 tiendas activas, 2 con inventario en 2026-09: el 8078 de Luzuriaga
 * con 985 items y el 8079 de Trujillo Piloto con 40), mejor de 3 corridas y con
 * `scripts/verificar-export-cadena-api.mjs`:
 *
 *   el endpoint entero (1.025 items, 6 filas de producto)  ->  25 ms
 *   el .xlsx que devuelve                                  ->  7,2 KB
 *   `/cadena` para el mismo periodo, para comparar          ->  21 ms
 *
 * O sea que armar el libro sobre las filas que quedan cuesta ~4 ms: el costo es
 * del ARMADO DE LAS MATRICES, igual que en `/cadena`, y las nueve tiendas sin
 * inventario no cuestan nada porque no se les arma matriz.
 *
 * PROYECCION, dicha como proyeccion: diez tiendas de ~1.000 items son ~250 ms, y
 * con el catalogo ANUAL completo (11.835 items por tienda) ~3 s. Lejos de los
 * 230 s de timeout del Azure Web App -- pero el anual es una vez al año y hoy no
 * existe ninguno en la base para medirlo de verdad.
 *
 * SECUENCIAL, igual que `cadena` y por la misma razon (diez catalogos completos
 * vivos a la vez). No se paraleliza por cuenta propia.
 */
export async function exportarDiferenciasDeLaCadena(
  actor: ColaboradorAutenticado,
  query: CadenaQuery,
): Promise<{ buffer: Buffer; nombreArchivo: string }> {
  // EL MISMO PERMISO que `/cadena`, sin excepciones ni recortes nuevos: el
  // Auditor audita la cadena entera (correccion del cliente del 2026-09-09, ver
  // auditoria.permisos.ts). El corte esta acá, antes de armar una sola matriz.
  validarAccesoALaCadena(actor);

  const [sucursales, periodo] = await Promise.all([
    prisma.sucursal.findMany({
      where: { activa: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    }),
    inventariosDelPeriodo(query),
  ]);

  const filas: FilaExportDiferenciaCadena[] = [];
  for (const suc of sucursales) {
    const inv = periodo.porSucursal.get(suc.id);
    if (inv === undefined) continue;
    const completa = await aplicarClasificacionVigente(inv.id, inv.estado, await armarMatriz(inv.id));
    for (const fila of detalleDeDiferencias(completa, inv.umbral)) {
      // Las cuatro columnas que la unidad pura no puede poner: de que tienda,
      // de que periodo y de que inventario es esta fila.
      filas.push({
        ...fila,
        sucursal: suc.nombre,
        periodoAnio: periodo.anio,
        periodoMes: periodo.mes,
        inventarioId: inv.id,
      });
    }
  }

  return {
    buffer: await armarLibroDiferenciasCadena(filas),
    nombreArchivo: nombreArchivoDiferenciasCadena(periodo.anio, periodo.mes),
  };
}
