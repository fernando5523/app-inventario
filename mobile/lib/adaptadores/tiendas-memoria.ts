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

import type { Sucursal } from '../dominio/tipos';
import type { DatosTienda, RepositorioTiendas } from '../puertos/repositorios';
import { simularLatencia } from './_compartido';

const tiendas: Sucursal[] = [
  { id: 1, nombre: 'Market Central Luzuriaga', colaboradores: 11, activa: true },
  { id: 2, nombre: 'Market Carhuaz', colaboradores: 6, activa: true },
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
    const nueva: Sucursal = { id: proximoId++, nombre: datos.nombre, direccion: datos.direccion, colaboradores: 0, activa: true };
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
    return tienda;
  },

  async cambiarActiva(sucursalId, activa) {
    await simularLatencia();
    const tienda = tiendas.find((t) => t.id === sucursalId);
    if (!tienda) throw new Error(`Tienda ${sucursalId} no encontrada.`);
    tienda.activa = activa;
    return tienda;
  },
};
