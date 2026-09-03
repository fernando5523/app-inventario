/**
 * Adaptador en memoria de RepositorioAuditoria.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts). Reusa los
 * productos REALES ya sembrados en la Hoja #002 (./_compartido.ts) en vez
 * de crear un catálogo paralelo — mismo producto, mismo código, dondequiera
 * que se lo referencie en la app.
 *
 * Los 3 items con ERP/1°/2°/3° conteo son los mismos EXACTOS de
 * mobile/design/auditoria.html (verificados con los tests de
 * dominio/auditoria.test.ts antes de cargarlos acá): no hay stock de
 * Dynamics real para los otros 127 ítems con diferencia que menciona la
 * maqueta — inventar 127 filas más sería el mismo error que ya se evitó
 * en mis-hojas.html/conteo.html con las hojas sin catálogo cargado.
 */

import { obtenerInventario, simularLatencia } from './_compartido';
import type { RepositorioAuditoria } from '../puertos/repositorios';
import type { ItemAuditoria } from '../dominio/tipos';

interface SemillaItem {
  codigoBarras: string;
  stockErp: number;
  conteo1: number | null;
  conteo2: number | null;
  conteo3: number | null;
  esEmpresa: boolean;
  precioVenta: number;
}

/** Códigos de barras de la Hoja #002 (ver _compartido.ts#BASE_PRODUCTOS). */
const SEMILLA: SemillaItem[] = [
  // Fideos Canuto Lavaggi 500g — cuadró en el 2do conteo, no llegó a necesitar un 3ro.
  { codigoBarras: '7750123054', stockErp: 80, conteo1: 74, conteo2: 80, conteo3: null, esEmpresa: false, precioVenta: 3.2 },
  // Leche Evaporada Gloria Azul 400g — faltante definitivo: -5 unid × S/4.80 = -S/24.00.
  { codigoBarras: '7750123088', stockErp: 96, conteo1: 88, conteo2: 90, conteo3: 91, esEmpresa: false, precioVenta: 4.8 },
  // Cerveza Cusqueña Trigo 310ml — regla de gerencia: la asume la empresa, no se descuenta a nómina.
  { codigoBarras: '7750999015', stockErp: 54, conteo1: 45, conteo2: 46, conteo3: 47, esEmpresa: true, precioVenta: 5.2 },
];

export const auditoriaMemoria: RepositorioAuditoria = {
  async matriz(inventarioId) {
    await simularLatencia();
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) return [];

    const hoja002 = inventario.hojas.find((h) => h.numero === '002');
    if (!hoja002) return [];

    const items: ItemAuditoria[] = [];
    for (const semilla of SEMILLA) {
      const producto = hoja002.productos.find((p) => p.codigoBarras === semilla.codigoBarras);
      if (!producto) continue; // catálogo de la hoja todavía no cargado — no se inventa el producto acá tampoco.
      items.push({
        productoId: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        zona: hoja002.zona,
        precioVenta: semilla.precioVenta,
        stockErp: semilla.stockErp,
        conteo1: semilla.conteo1,
        conteo2: semilla.conteo2,
        conteo3: semilla.conteo3,
        esEmpresa: semilla.esEmpresa,
      });
    }
    return items;
  },
};
