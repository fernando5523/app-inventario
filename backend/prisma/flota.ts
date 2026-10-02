/**
 * LAS DIEZ TIENDAS Y SU ALMACEN DE DYNAMICS -- el dato, sin nada que se
 * ejecute al importarlo.
 *
 * ESTE ARCHIVO EXISTE POR UN ERROR REAL (2026-10-02). La lista vivia dentro de
 * `seed.ts`, y `sembrar-flota.ts` la importaba de ahi. Pero `seed.ts` llama a
 * `main()` en su ultima linea, asi que **importarlo lo ejecuta**: al correr el
 * seed de la flota contra la base PUBLICADA se crearon tambien los
 * colaboradores inventados del seed de desarrollo. Hubo que borrarlos a mano.
 *
 * La regla que esto deja escrita: un modulo del que alguien vaya a importar un
 * dato NO puede tener efectos al cargarse. Por eso la lista se muda aca, a un
 * archivo que solo declara, y `seed.ts` la importa como todos los demas.
 *
 * El `almacenId` NO es decorativo: es contra ese almacen de Dynamics que se
 * pide el stock (`WarehousesOnHandV2`), asi que un id mal puesto hace que una
 * tienda cuente contra el inventario de otra.
 */
export const SUCURSALES = [
  { id: 1, nombre: 'Market Luzuriaga', almacenId: 'MD01_LUZ', almacenNombre: 'ALMACÉN DISPONIBLE MARKET LUZURIAGA' },
  { id: 2, nombre: 'Market Carhuaz', almacenId: 'MD03_CRH', almacenNombre: 'ALMACÉN DISPONIBLE MARKET CARHUAZ' },
  { id: 3, nombre: 'Market Bolívar', almacenId: 'MD06_BOL', almacenNombre: 'ALMACÉN DISPONIBLE MARKET BOLIVAR' },
  { id: 4, nombre: 'Market Sucre', almacenId: 'MD04_SUC', almacenNombre: 'ALMACÉN DISPONIBLE MARKET  SUCRE' },
  { id: 5, nombre: 'Market Jr. Caraz', almacenId: 'MD02_JRC', almacenNombre: 'ALMACÉN DISPONIBLE MARKET JR. CARAZ' },
  { id: 6, nombre: 'Market Caraz', almacenId: 'MD05_CRZ', almacenNombre: 'ALMACÉN DISPONIBLE MARKET CARAZ' },
  { id: 7, nombre: 'Market Raymondi', almacenId: 'MD08_RAY', almacenNombre: 'ALMACÉN DISPONIBLE MARKET RAYMONDI' },
  { id: 8, nombre: 'Market Raymondi 351', almacenId: 'MD09_R351', almacenNombre: 'ALMACÉN DISPONIBLE MARKET RAYMONDI 351' },
  { id: 9, nombre: 'Market Santa Rosa', almacenId: 'MD10', almacenNombre: 'ALMACÉN DISPONIBLE MARKET SANTA ROSA' },
  { id: 10, nombre: 'Market Centenario', almacenId: 'MD11_CENT', almacenNombre: 'ALMACÉN DISPONIBLE MARKET CENTENARIO' },
] as const;
