/**
 * Adaptador HTTP de RepositorioTiendas. Mismo puerto que tiendas-memoria.ts.
 * Solo lo usa el Administrador.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra el código del backend
 * ---------------------------------------------------------------------------
 * Leído de backend/src/modules/tiendas/{tiendas.routes,tiendas.schema}.ts y
 * del montaje en backend/src/config/app.ts. Las 3 rutas que yo había
 * deducido coincidían exactamente:
 *
 *   GET   /api/tiendas       → listar()
 *   POST  /api/tiendas       → 201, crear()
 *   PATCH /api/tiendas/:id   → editar()  y  cambiarActiva()
 *
 * Todo el router va detrás de `requiereSesion` + `requiereRol('administrador')`
 * — el Auditor NO entra acá (a diferencia de usuarios). Un 403 se traduce a
 * `sin-permiso`.
 *
 * Nota: `crearTiendaSchema` acepta además un `telefono` opcional que
 * `DatosTienda` no tiene. No se manda: agregar un campo al puerto para
 * emparejar con el backend es al revés de como va: primero lo pide el
 * cliente en una pantalla, después existe en el puerto.
 *
 * `/api/tiendas` y no `/api/sucursales`: el modelo de Prisma se llama
 * `Sucursal` y `RepositorioSesion` ya sirve el padrón por `/api/sesion/
 * sucursales`. Son dos vistas distintas del mismo dato — una pública, de
 * solo lectura, para el login; otra de gestión, con permiso de
 * Administrador. Separarlas por ruta evita que el mismo path tenga dos
 * reglas de autorización según el verbo.
 *
 * `editar` y `cambiarActiva` comparten PATCH porque son literalmente un
 * merge parcial sobre el mismo recurso; lo que NO comparten es el permiso
 * de negocio, y eso lo resuelve el backend, no la forma de la ruta.
 *
 * No hay DELETE, igual que en usuarios-api.ts: "Nunca se borra una tienda
 * (mismo criterio que Usuarios): se activa o desactiva".
 */

import type { Sucursal } from '../dominio/tipos';
import type { DatosTienda, RepositorioTiendas } from '../puertos/repositorios';
import { pedir } from './_http';

const RUTAS = {
  coleccion: '/api/tiendas',
  una: (sucursalId: number) => `/api/tiendas/${sucursalId}`,
};

/**
 * Lo que manda el backend (README §Tiendas). Distinto de `Sucursal`: los
 * opcionales vienen como `null`, no ausentes, y trae un `telefono` que el
 * puerto no modela.
 */
interface TiendaDto {
  id: number;
  nombre: string;
  activa: boolean;
  direccion: string | null;
  telefono: string | null;
  colaboradores: number;
}

/**
 * `null` → ausente, igual que en usuarios-api.ts. El puerto declara
 * `direccion?: string`; recibir `null` haría que un `?? 'Sin dirección'`
 * funcione pero un `=== undefined` no, que es la clase de inconsistencia
 * que después aparece en una sola pantalla y nadie entiende por qué.
 */
function aSucursal(dto: TiendaDto): Sucursal {
  return {
    id: dto.id,
    nombre: dto.nombre,
    colaboradores: dto.colaboradores,
    activa: dto.activa,
    ...(dto.direccion === null ? {} : { direccion: dto.direccion }),
  };
}

export const tiendasApi: RepositorioTiendas = {
  async listar() {
    return (await pedir<TiendaDto[]>(RUTAS.coleccion)).map(aSucursal);
  },

  async crear(datos: DatosTienda) {
    return aSucursal(await pedir<TiendaDto>(RUTAS.coleccion, { metodo: 'POST', cuerpo: datos }));
  },

  async editar(sucursalId, datos: DatosTienda) {
    // Se manda el objeto entero de `DatosTienda` (nombre + dirección): la
    // pantalla de edición envía el formulario completo, así que un PATCH
    // parcial campo por campo no aportaría nada y sí abriría la puerta a
    // "guardé y se me borró la dirección".
    //
    // OJO con el borrado: el backend distingue `direccion: null` (borrala)
    // de campo ausente (dejala como está). `DatosTienda.direccion` es
    // `string | undefined`, y `JSON.stringify` elimina los `undefined` — así
    // que hoy este método NUNCA borra una dirección, solo la reemplaza. Es
    // el comportamiento correcto para el puerto tal como está declarado; el
    // día que la pantalla necesite vaciar el campo, hay que agregarlo al
    // puerto primero.
    return aSucursal(await pedir<TiendaDto>(RUTAS.una(sucursalId), { metodo: 'PATCH', cuerpo: datos }));
  },

  async cambiarActiva(sucursalId, activa) {
    return aSucursal(await pedir<TiendaDto>(RUTAS.una(sucursalId), { metodo: 'PATCH', cuerpo: { activa } }));
  },
};
