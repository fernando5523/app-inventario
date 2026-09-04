/**
 * Adaptador en memoria de RepositorioTiendas.
 *
 * Arranca con las mismas 4 sucursales de sesion-memoria.ts (mismos
 * nombres, no una lista inventada aparte) más el campo `activa` que ese
 * padrón no necesita. Es un store en memoria PROPIO, no comparte objetos
 * con sesion-memoria.ts: dar de alta o desactivar una tienda acá no
 * afecta el selector de sucursal del login todavía — eso lo conecta el
 * agente de integración cuando reemplace este archivo por el HTTP real.
 */

import type { Almacen, Sucursal } from '../dominio/tipos';
import type { DatosTienda, RepositorioTiendas } from '../puertos/repositorios';
import { simularLatencia } from './_compartido';

/**
 * Solo los 2 códigos reales que dio el cliente como ejemplo (MD11_CENT,
 * AD04_TCE) — no se inventan más para no hacerle creer a quien pruebe en
 * memoria que hay un catálogo completo de almacenes. El resto de la
 * lista sale de verdad de `GET /api/d365/almacenes` (tiendas-api.ts).
 */
const ALMACENES: Almacen[] = [
  { codigo: 'AD04_TCE', nombre: 'Tienda Carhuaz' },
  { codigo: 'MD11_CENT', nombre: 'Almacén Central' },
];

// Dos sucursales CON almacén y dos SIN, a propósito: para poder probar en
// memoria las dos historias que tiene que distinguir la pantalla (ver
// TiendasScreen y el aviso de "sin almacén configurado").
function almacenPorCodigo(codigo: string): Almacen | undefined {
  return ALMACENES.find((a) => a.codigo === codigo);
}

const tiendas: Sucursal[] = [
  { id: 1, nombre: 'Market Central Luzuriaga', colaboradores: 11, activa: true, almacenId: ALMACENES[1].codigo, almacenNombre: ALMACENES[1].nombre },
  { id: 2, nombre: 'Market Carhuaz', colaboradores: 6, activa: true, almacenId: ALMACENES[0].codigo, almacenNombre: ALMACENES[0].nombre },
  { id: 3, nombre: 'Market Bolívar', colaboradores: 7, activa: true },
  { id: 4, nombre: 'Market Sucre', colaboradores: 5, activa: true },
];
let proximoId = 5;

export const tiendasMemoria: RepositorioTiendas = {
  async listar() {
    await simularLatencia();
    return tiendas;
  },

  async crear(datos: DatosTienda) {
    await simularLatencia();
    if (!datos.nombre.trim()) throw new Error('El nombre de la tienda es obligatorio.');
    // Mismo criterio que el backend real (tiendas.service.ts#verificarAlmacen):
    // se verifica contra la lista, nunca se guarda un código a ciegas.
    if (datos.almacenId && !almacenPorCodigo(datos.almacenId)) {
      throw new Error(`El almacén "${datos.almacenId}" no existe en Dynamics.`);
    }
    const almacen = datos.almacenId ? almacenPorCodigo(datos.almacenId) : undefined;
    const nueva: Sucursal = {
      id: proximoId++,
      nombre: datos.nombre,
      direccion: datos.direccion,
      colaboradores: 0,
      activa: true,
      ...(almacen ? { almacenId: almacen.codigo, almacenNombre: almacen.nombre } : {}),
    };
    tiendas.push(nueva);
    return nueva;
  },

  async editar(sucursalId, datos: DatosTienda) {
    await simularLatencia();
    const tienda = tiendas.find((t) => t.id === sucursalId);
    if (!tienda) throw new Error(`Tienda ${sucursalId} no encontrada.`);
    if (!datos.nombre.trim()) throw new Error('El nombre de la tienda es obligatorio.');
    tienda.nombre = datos.nombre;
    tienda.direccion = datos.direccion;
    // `null` desasocia, `undefined` deja como está, un código lo cambia
    // (mismo criterio que el PATCH real, ver DatosTienda.almacenId).
    if (datos.almacenId === null) {
      tienda.almacenId = null;
      tienda.almacenNombre = null;
    } else if (datos.almacenId !== undefined) {
      const almacen = almacenPorCodigo(datos.almacenId);
      if (!almacen) throw new Error(`El almacén "${datos.almacenId}" no existe en Dynamics.`);
      tienda.almacenId = almacen.codigo;
      tienda.almacenNombre = almacen.nombre;
    }
    return tienda;
  },

  async cambiarActiva(sucursalId, activa) {
    await simularLatencia();
    const tienda = tiendas.find((t) => t.id === sucursalId);
    if (!tienda) throw new Error(`Tienda ${sucursalId} no encontrada.`);
    tienda.activa = activa;
    return tienda;
  },

  async listarAlmacenes() {
    await simularLatencia();
    return ALMACENES;
  },
};
