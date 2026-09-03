/**
 * Adaptador en memoria de RepositorioCatalogo.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts). Los
 * productos de cada hoja ya viven embebidos en el `HojaConteo` del
 * store compartido (./_compartido.ts): este adaptador solo los expone
 * a través del puerto, no mantiene su propia copia.
 */

import { buscarHojaPorId, simularLatencia } from './_compartido';
import type { RepositorioCatalogo } from '../puertos/repositorios';

export const catalogoMemoria: RepositorioCatalogo = {
  async deHoja(hojaId) {
    await simularLatencia();
    const hoja = await buscarHojaPorId(hojaId);
    return hoja ? hoja.productos : [];
  },

  async porCodigoBarras(hojaId, codigo) {
    await simularLatencia();
    const hoja = await buscarHojaPorId(hojaId);
    if (!hoja) return null;
    return hoja.productos.find((producto) => producto.codigoBarras === codigo) ?? null;
  },
};
