/**
 * Adaptador HTTP de RepositorioCatalogo. Mismo puerto que catalogo-memoria.ts.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — RUTAS VERIFICADAS contra backend/src/modules/hojas/hojas.routes.ts
 * (montado en /api/hojas) y documentadas en backend/README.md.
 *
 * La FORMA de la respuesta todavia no se pudo probar de punta a punta: el
 * backend no tiene modulo que CREE hojas (paso 2 del Coordinador), asi que
 * no hay ninguna hoja en la base contra la cual pedir productos. Las rutas
 * responden 404 por hoja inexistente, no por ruta faltante.
 * ---------------------------------------------------------------------------
 *   GET /api/hojas/:hojaId/productos                       → deHoja()
 *   GET /api/hojas/:hojaId/productos/barras/:codigo        → porCodigoBarras()
 *
 * `porCodigoBarras` se resuelve del lado del SERVIDOR y no bajando la hoja
 * entera para filtrar acá: el puerto exige que devuelva null cuando el
 * código no pertenece a esa hoja — el caso de la góndola, donde el producto
 * de al lado entra en cuadro — y esa pertenencia la sabe la base
 * (`@@index([hojaId, codigoBarras])` en el schema), no el teléfono.
 */

import type { Producto } from '../dominio/tipos';
import type { RepositorioCatalogo } from '../puertos/repositorios';
import { ErrorApi, pedir } from './_http';

const RUTAS = {
  deHoja: (hojaId: number) => `/api/hojas/${hojaId}/productos`,
  porCodigoBarras: (hojaId: number, codigo: string) =>
    `/api/hojas/${hojaId}/productos/barras/${encodeURIComponent(codigo)}`,
};

export const catalogoApi: RepositorioCatalogo = {
  async deHoja(hojaId) {
    return pedir<Producto[]>(RUTAS.deHoja(hojaId));
  },

  async porCodigoBarras(hojaId, codigo) {
    // 404 = "ese código no es de esta hoja", que es EXACTAMENTE el caso que
    // el puerto pide devolver como null. Es el camino más transitado de la
    // pantalla de conteo (escanear el producto equivocado), así que no puede
    // llegar a la pantalla como un error rojo.
    try {
      return await pedir<Producto>(RUTAS.porCodigoBarras(hojaId, codigo));
    } catch (error) {
      if (error instanceof ErrorApi && error.clase === 'no-encontrado') return null;
      throw error;
    }
  },
};
