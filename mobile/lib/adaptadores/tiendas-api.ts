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

import type { Almacen, Sucursal } from '../dominio/tipos';
import type { DatosTienda, RepositorioTiendas } from '../puertos/repositorios';
import { pedir } from './_http';

const RUTAS = {
  coleccion: '/api/tiendas',
  una: (sucursalId: number) => `/api/tiendas/${sucursalId}`,
  /**
   * `GET /api/d365/almacenes` (backend/src/modules/d365/d365.routes.ts) —
   * VERIFICADO contra el código: ya existe, `requiereRol('administrador')`,
   * devuelve `AlmacenDto[] = {codigo, nombre}[]` ordenado por código. No es
   * un endpoint pendiente: min3 ya lo construyó para este mismo cambio.
   */
  almacenes: '/api/d365/almacenes',
};

/**
 * Lo que manda el backend (`tiendas.service.ts#TiendaDto`, VERIFICADO
 * contra el código — min-5 ya lo aterrizó). Distinto de `Sucursal`: los
 * opcionales vienen como `null`, no ausentes, y trae `telefono`/
 * `puedeTraerStock` que el puerto no modela (`puedeTraerStock` es
 * `almacenId !== null`, se deriva del lado de acá si hace falta, no se
 * duplica un booleano que se pueda desincronizar).
 *
 * `almacenId`/`almacenNombre`: el backend los VERIFICA contra Dynamics al
 * guardar (`tiendas.service.ts#verificarAlmacen`) — nunca confía en el
 * formato solo. `almacenNombre` viaja siempre junto con `almacenId`,
 * nunca por separado: no hace falta cruzar contra `listarAlmacenes()`
 * para mostrar el nombre de una tienda ya configurada.
 */
interface TiendaDto {
  id: number;
  nombre: string;
  activa: boolean;
  direccion: string | null;
  telefono: string | null;
  almacenId: string | null;
  almacenNombre: string | null;
  puedeTraerStock: boolean;
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
    ...(dto.almacenId === null ? {} : { almacenId: dto.almacenId }),
    ...(dto.almacenNombre === null ? {} : { almacenNombre: dto.almacenNombre }),
  };
}

export const tiendasApi: RepositorioTiendas = {
  async listar() {
    return (await pedir<TiendaDto[]>(RUTAS.coleccion)).map(aSucursal);
  },

  async crear(datos: DatosTienda) {
    // `crearTiendaSchema.almacenId` es SOLO `.optional()`, no
    // `.nullable()` (backend/tiendas.schema.ts): no hay "almacén
    // asociado" que desasociar en un alta que todavía no existe. Si la
    // pantalla mandara `null` acá (no debería, ver TiendasScreen), se
    // omite en vez de mandar un 400 que no dice nada útil.
    const { almacenId, ...resto } = datos;
    const cuerpo = { ...resto, ...(almacenId ? { almacenId } : {}) };
    return aSucursal(await pedir<TiendaDto>(RUTAS.coleccion, { metodo: 'POST', cuerpo }));
  },

  async editar(sucursalId, datos: DatosTienda) {
    // Se manda el objeto entero de `DatosTienda` (nombre + dirección +
    // almacén): la pantalla de edición envía el formulario completo, así
    // que un PATCH parcial campo por campo no aportaría nada y sí abriría
    // la puerta a "guardé y se me borró la dirección".
    //
    // OJO con el borrado: el backend distingue `direccion: null` (borrala)
    // de campo ausente (dejala como está) — mismo criterio para
    // `almacenId`, y ACÁ SÍ se puede mandar `null` a propósito (ver
    // `DatosTienda.almacenId`): es como se desasocia un almacén mal
    // configurado. `DatosTienda.direccion` sigue siendo `string |
    // undefined` (nunca null), así que ese campo puntual todavía no se
    // puede vaciar desde acá — el día que la pantalla lo necesite, hay
    // que sumarlo al puerto primero, mismo criterio que ya regía antes.
    return aSucursal(await pedir<TiendaDto>(RUTAS.una(sucursalId), { metodo: 'PATCH', cuerpo: datos }));
  },

  async cambiarActiva(sucursalId, activa) {
    return aSucursal(await pedir<TiendaDto>(RUTAS.una(sucursalId), { metodo: 'PATCH', cuerpo: { activa } }));
  },

  async listarAlmacenes() {
    return pedir<Almacen[]>(RUTAS.almacenes);
  },
};
