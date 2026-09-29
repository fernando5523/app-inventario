/**
 * Adaptador HTTP de RepositorioAuditoria. Mismo puerto que
 * auditoria-memoria.ts.
 *
 * Es la pantalla donde se decide si el inventario cuadra: la comparación
 * ítem por ítem del stock del ERP contra los 3 conteos. Era la última que
 * mostraba datos inventados.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra el backend real (2026-09-04)
 * ---------------------------------------------------------------------------
 *   GET /api/auditoria/inventarios/:inventarioId/matriz
 *       ?limite=&desplazamiento=
 *   → { total, limite, desplazamiento, resumen, embudo, matriz: [...] }
 *
 *   GET /api/auditoria/cadena?anio=&mes=
 *   → { periodo, total, tiendas: [...] }   (ver `ResumenCadena` en el puerto)
 *
 *   GET /api/auditoria/cadena/diferencias/exportar?anio=&mes=
 *   → el BINARIO del .xlsx, con el nombre en `Content-Disposition`
 *     (`diferencias-cadena-2026-09.xlsx`). Mismo permiso que `/cadena`.
 *
 * Rol: `administrador`, `auditor` o `coordinador` (el router monta
 * `requiereRol` con los tres). Un rol `conteo` recibe 403 — correcto: el
 * conteo es ciego, quien cuenta no puede ver el stock del ERP.
 *
 * Cada fila de `matriz` trae los campos de `ItemAuditoria` tal cual
 * (`FilaMatrizDto extends ItemAuditoria` del lado del servidor), más los
 * derivados que el puerto no pide (`conteoFinal`, `diferenciaUnidades`,
 * `veredicto`, `stockDeLaMedicion`). Se descartan acá: el dominio del front los
 * calcula solo (dominio/auditoria.ts) y tener dos fuentes para el mismo número
 * es cómo se llega a que la pantalla y el servidor discutan sobre cuánto falta.
 *
 * QUE SE DESCARTEN NO ES DESPERDICIO: son la única forma de verificar que las dos
 * copias siguen coincidiendo. `auditoria-api.paridad.test.ts` le pasa a la copia
 * local las filas que manda el servidor y falla si los derivados difieren — sin
 * eso, las dos copias se separan con el tiempo y nadie se entera hasta que el
 * Auditor ve un número en la matriz y otro en el cierre.
 */

import type { ItemAuditoria } from '../dominio/tipos';
import type {
  ArchivoExportado,
  RepositorioAuditoria,
  ResumenAuditoriaServidor,
  ResumenCadena,
} from '../puertos/repositorios';
import { pedir } from './_http';

/**
 * El backend pagina (máximo 500 por pedido) y el puerto devuelve la matriz
 * COMPLETA: son 8.000 ítems, así que hay que recorrer las páginas.
 *
 * 500 y no 100 (el default del servidor): son 16 viajes en vez de 80 sobre
 * la WiFi de la tienda. La pantalla del Auditor necesita el total para
 * filtrar y ordenar sin volver a pedir.
 */
const POR_PAGINA = 500;

/**
 * Techo de páginas. No es paranoia: un bug de paginación del lado del
 * servidor (que `desplazamiento` no avance, por ejemplo) convertiría esto en
 * un bucle infinito que vacía la batería del teléfono en silencio. Con
 * 8.000 ítems reales se usan 16 páginas; 100 deja margen de sobra para
 * crecer y corta antes de colgar la app.
 */
const MAX_PAGINAS = 100;

interface RespuestaMatriz {
  total: number;
  limite: number;
  desplazamiento: number;
  /** `FilaMatrizDto` — `ItemAuditoria` más derivados que acá se ignoran. */
  matriz: ItemAuditoria[];
}

function ruta(inventarioId: number, desplazamiento: number): string {
  const q = new URLSearchParams({
    limite: String(POR_PAGINA),
    desplazamiento: String(desplazamiento),
  });
  return `/api/auditoria/inventarios/${inventarioId}/matriz?${q.toString()}`;
}

/** Se queda con los campos del puerto y descarta los derivados del servidor. */
function aItemAuditoria(fila: ItemAuditoria): ItemAuditoria {
  return {
    productoId: fila.productoId,
    codigo: fila.codigo,
    descripcion: fila.descripcion,
    zona: fila.zona,
    // Sin esta línea el campo llega del servidor y se tira: esta función
    // reconstruye el objeto campo por campo a propósito (ver su cabecera), así
    // que lo que no se nombra acá no existe para la pantalla.
    hoja: fila.hoja,
    precioVenta: fila.precioVenta,
    stockErp: fila.stockErp,
    // La lista entera, tal cual la manda el servidor: un elemento por ronda.
    // Antes eran tres campos fijos, y con eso un 4to conteo llegaba y se
    // descartaba en silencio -- el Auditor lo habría visto desaparecer.
    conteos: fila.conteos,
    // EL STOCK DE CADA RONDA, tal cual lo manda el servidor. Sin esta línea el
    // campo llega y se tira (esta función reconstruye el objeto campo por campo,
    // ver su cabecera), y el teléfono mediría TODAS las rondas contra el stock
    // del día 22 mientras el servidor mide cada una contra la suya: dos
    // diferencias distintas sobre el mismo ítem, que es exactamente el bug que
    // `dominio/auditoria.ts` existe para evitar. Un inventario viejo trae `[]`.
    stockPorRonda: fila.stockPorRonda,
    // El reparto ya resuelto por el servidor: se pasa tal cual. Ver
    // `AtribucionItem` para por qué no se calcula de este lado.
    atribucion: fila.atribucion,
    esEmpresa: fila.esEmpresa,
  };
}

/** Lo que responde `/resumen`: el resumen adentro, con el estado y el embudo al lado. */
interface RespuestaResumen {
  resumen: ResumenAuditoriaServidor;
}

/**
 * La query del período, compartida por `cadena` y `exportarDiferenciasCadena`.
 *
 * Los dos endpoints resuelven el mes con la MISMA regla del servidor cuando no
 * se manda nada, así que armar la query dos veces serían dos formas de pedir
 * lo mismo que se pueden desalinear -- y el día que se desalineen, el .xlsx
 * traería un período distinto del que muestra la tabla de al lado.
 *
 * Sin `periodo` devuelve la cadena VACÍA, no un `?` pelado: un `?` ya es una
 * query, y este adaptador no manda ninguna cuando el período lo decide el
 * servidor (ver `cadena`).
 */
function consultaPeriodo(periodo?: { anio: number; mes: number }): string {
  if (periodo === undefined) return '';
  return `?${new URLSearchParams({ anio: String(periodo.anio), mes: String(periodo.mes) }).toString()}`;
}

export const auditoriaApi: RepositorioAuditoria = {
  /**
   * `GET /api/auditoria/inventarios/:id/resumen`.
   *
   * Se pide APARTE de la matriz y no se deriva de ella: el reparto entre
   * cuadros depende del `umbral` congelado en el inventario, que el teléfono
   * no tiene. Calcularlo acá sería una segunda copia de la regla que decide a
   * quién se le descuenta la plata (ver `ResumenAuditoriaServidor`).
   *
   * El cuerpo trae además `estado`, `embudo` y `zonas`; acá se toma solo
   * `resumen` — lo demás lo pide quien lo necesite, sin pasar por este puerto.
   */
  async resumen(inventarioId) {
    const respuesta = await pedir<RespuestaResumen>(`/api/auditoria/inventarios/${inventarioId}/resumen`);
    return respuesta.resumen;
  },

  /**
   * `GET /api/auditoria/cadena?anio=&mes=`.
   *
   * Se pasa TAL CUAL: el cuerpo de esta respuesta ya tiene la forma del puerto
   * (período, total y tiendas), así que no hay nada que reconstruir. Sin
   * `periodo` no se manda query y el período lo resuelve el servidor -- que es
   * quien sabe cuál es el del inventario en curso.
   *
   * NO HAY RELLENO acá: si el endpoint falla, falla, y la pantalla lo dice. Un
   * adaptador que devolviera una cadena vacía o inventada mostraría "0 tiendas
   * con inventario" sobre una cadena que sí está contando.
   */
  async cadena(periodo) {
    return pedir<ResumenCadena>(`/api/auditoria/cadena${consultaPeriodo(periodo)}`);
  },

  /**
   * `GET /api/auditoria/cadena/diferencias/exportar?anio=&mes=`.
   *
   * `binario: true` porque el cuerpo es un .xlsx: son bytes, y hacerlos pasar
   * por `.text()`/`JSON.parse` los corrompe (ver la opción en _http.ts).
   *
   * `conNombreDeArchivo: true` porque el nombre lo arma el SERVIDOR con el
   * período que ÉL resolvió, y cuando no se manda `periodo` este lado no
   * conoce ese período -- ver `RepositorioAuditoria.exportarDiferenciasCadena`
   * para por qué no se rearma acá.
   *
   * Es el MISMO par de opciones que `historial-api.ts#exportarCuadros`, a
   * propósito: es la única mecánica del repo para bajar bytes con nombre, y
   * arrastra gratis el token, el timeout, los reintentos y la traducción de
   * errores que ya tiene `pedir`. Una descarga con `fetch` a mano perdería las
   * cuatro cosas, y un .xlsx también se cae con la WiFi de la tienda.
   *
   * SIN RELLENO, igual que `cadena`: si el endpoint falla, falla. Devolver un
   * archivo vacío bajaría una planilla sin diferencias sobre una cadena que sí
   * tiene faltantes.
   */
  async exportarDiferenciasCadena(periodo): Promise<ArchivoExportado> {
    return pedir<ArchivoExportado>(`/api/auditoria/cadena/diferencias/exportar${consultaPeriodo(periodo)}`, {
      binario: true,
      conNombreDeArchivo: true,
    });
  },

  async matriz(inventarioId) {
    const items: ItemAuditoria[] = [];
    let desplazamiento = 0;

    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const respuesta = await pedir<RespuestaMatriz>(ruta(inventarioId, desplazamiento));
      items.push(...respuesta.matriz.map(aItemAuditoria));

      // Se corta por lo que REALMENTE llegó, no por `total`: si el servidor
      // devuelve una página vacía antes de tiempo, seguir pidiendo es pedir
      // lo mismo para siempre.
      if (respuesta.matriz.length === 0) break;
      desplazamiento += respuesta.matriz.length;
      if (desplazamiento >= respuesta.total) break;
    }

    return items;
  },
};
