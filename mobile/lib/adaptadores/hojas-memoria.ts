/**
 * Adaptador en memoria de RepositorioHojas.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts para la
 * explicación completa del patrón). El estado real (hojas, productos,
 * conteos) vive en ./_compartido.ts, compartido con inventario-memoria.ts
 * y catalogo-memoria.ts — una hoja que el Coordinador crea es la MISMA
 * que ve acá el Contador, no una copia.
 */

import { finalizarDominio, puedeEditar, buscarHojaPorId, obtenerInventario, reemplazarHoja, simularLatencia } from './_compartido';
import { sesionMemoria } from './sesion-memoria';
import type { RepositorioHojas } from '../puertos/repositorios';

/**
 * El dataset de ejemplo (`_compartido.ts`) solo tiene la ronda 1 sembrada:
 * no modela el reconteo. Para una ronda > 1 no hay nada que devolver — vacío,
 * en vez de hacer pasar las hojas de la ronda 1 por otra ronda. Contra el
 * backend real las rondas 2/3 sí existen; esto es solo el mock de dev.
 */
const RONDA_SEMBRADA = 1;

export const hojasMemoria: RepositorioHojas = {
  async mias(inventarioId, ronda) {
    await simularLatencia();
    if (ronda !== RONDA_SEMBRADA) return [];
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) return [];

    const sesion = await sesionMemoria.sesionActiva();
    if (!sesion) return [];

    return inventario.hojas.filter((hoja) => hoja.asignados.includes(sesion.colaborador.nombre));
  },

  async todas(inventarioId, ronda) {
    await simularLatencia();
    if (ronda !== RONDA_SEMBRADA) return [];
    const inventario = await obtenerInventario(inventarioId);
    return inventario ? inventario.hojas : [];
  },

  async porNumero(inventarioId, numero, ronda) {
    await simularLatencia();
    if (ronda !== RONDA_SEMBRADA) return null;
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) return null;
    return inventario.hojas.find((hoja) => hoja.numero === numero) ?? null;
  },

  async guardarConteo(hojaId, conteo) {
    await simularLatencia();
    const hoja = await buscarHojaPorId(hojaId);
    if (!hoja) throw new Error(`Hoja ${hojaId} no encontrada.`);
    if (!puedeEditar(hoja)) {
      throw new Error(`La hoja #${hoja.numero} ya está finalizada: no se puede corregir el conteo.`);
    }

    const indice = hoja.conteos.findIndex((c) => c.productoId === conteo.productoId);
    if (indice >= 0) hoja.conteos[indice] = conteo;
    else hoja.conteos.push(conteo);

    // El primer conteo saca a la hoja de "pendiente". Pasar a "finalizada"
    // es una decision aparte (ver finalizar()), nunca automatica.
    if (hoja.estado === 'pendiente') hoja.estado = 'en-proceso';
    hoja.sync = 'local';
  },

  async finalizar(hojaId) {
    await simularLatencia();
    const hoja = await buscarHojaPorId(hojaId);
    if (!hoja) throw new Error(`Hoja ${hojaId} no encontrada.`);

    // finalizarDominio es puro (no muta `hoja`) y lanza si ya estaba
    // finalizada: ese es el punto de no retorno, no se relaja acá.
    const finalizada = finalizarDominio(hoja);
    // DECISIÓN DEL CLIENTE (2026-09-05): al finalizar, cada producto SIN
    // CONTAR se registra en 0 explícito ("si no hay el producto, es 0").
    // Espeja hojas-sqlite.ts#finalizar y hojas.service.ts#finalizar — este
    // adaptador es el mock de dev, así que solo mantiene el estado en memoria
    // coherente (no hay cola: el "servidor" siempre está).
    const ahora = new Date().toISOString();
    const contados = new Set(hoja.conteos.map((c) => c.productoId));
    const ceros = hoja.productos
      .filter((p) => !contados.has(p.id))
      .map((p) => ({ productoId: p.id, empaques: [], sueltas: 0, confirmadoPorEscaner: false, contadoEn: ahora }));
    finalizada.conteos = [...hoja.conteos, ...ceros];
    finalizada.sync = 'sincronizado';
    await reemplazarHoja(finalizada);
    return finalizada;
  },
};
