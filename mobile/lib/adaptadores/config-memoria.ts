/**
 * Adaptador en memoria de RepositorioConfig.
 *
 * Defaults: `tamanoHojaDefecto` (50) y `conteosDelCiclo` (3) son los ya
 * validados en las maquetas (mobile/design/hojas.html, ciclo-conteos.html).
 * `umbralMediaUnidad` (0.5 = "mitad del paquete") es el valor por
 * defecto de una regla que hoy define el auditor caso por caso (ver
 * docs/pantallas.md, Pantalla 3 / Modal 1: "mitad del paquete más uno")
 * — acá se vuelve configurable, no se inventa un número nuevo.
 */

import type { ConfigSistema } from '../dominio/tipos';
import type { RepositorioConfig } from '../puertos/repositorios';
import { simularLatencia } from './_compartido';

let config: ConfigSistema = {
  tamanoHojaDefecto: 50,
  conteosDelCiclo: 3,
  umbralMediaUnidad: 0.5,
};

export const configMemoria: RepositorioConfig = {
  async obtener() {
    await simularLatencia();
    return config;
  },

  async actualizar(datos: ConfigSistema) {
    await simularLatencia();
    if (datos.conteosDelCiclo < 1) throw new Error('El ciclo necesita al menos 1 conteo.');
    if (datos.umbralMediaUnidad <= 0 || datos.umbralMediaUnidad > 1) {
      throw new Error('El umbral de media unidad tiene que estar entre 0 y 1.');
    }
    config = { ...datos };
    return config;
  },
};
