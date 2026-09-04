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
 * Rol: `administrador`, `auditor` o `coordinador` (el router monta
 * `requiereRol` con los tres). Un rol `conteo` recibe 403 — correcto: el
 * conteo es ciego, quien cuenta no puede ver el stock del ERP.
 *
 * Cada fila de `matriz` trae los campos de `ItemAuditoria` tal cual
 * (`FilaMatrizDto extends ItemAuditoria` del lado del servidor), más tres
 * derivados que el puerto no pide (`conteoFinal`, `diferenciaUnidades`,
 * `veredicto`). Se descartan acá: el dominio del front los calcula solo
 * (dominio/auditoria.ts) y tener dos fuentes para el mismo número es cómo se
 * llega a que la pantalla y el servidor discutan sobre cuánto falta.
 */

import type { ItemAuditoria } from '../dominio/tipos';
import type { RepositorioAuditoria } from '../puertos/repositorios';
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
    precioVenta: fila.precioVenta,
    stockErp: fila.stockErp,
    conteo1: fila.conteo1,
    conteo2: fila.conteo2,
    conteo3: fila.conteo3,
    esEmpresa: fila.esEmpresa,
  };
}

export const auditoriaApi: RepositorioAuditoria = {
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
