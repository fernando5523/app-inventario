export { d365Router } from './d365.routes';
/**
 * Se monta en `/api/inventarios`, no en `/api/d365`: la descarga de stock de un
 * reconteo pertenece a una RONDA de un inventario. Ver la cabecera de
 * d365.stock-ronda.routes.ts.
 */
export { stockRondaRouter } from './d365.stock-ronda.routes';
