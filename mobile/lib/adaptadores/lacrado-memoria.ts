/**
 * Adaptador en memoria de RepositorioLacrado.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts). Es el punto
 * de no retorno más fuerte del sistema, así que `lacrar()` NUNCA confía en
 * que la pantalla ya deshabilitó el botón: vuelve a chequear acá mismo que
 * haya 2 aprobaciones y que todas las hojas del inventario estén
 * sincronizadas, y rechaza si no.
 *
 * El envío a Dynamics es fase 2 (acordado con el cliente en la reunión de
 * requisitos, ver mobile/design/lacrado.html): `marcarRegistradoEnDynamics`
 * es una marca manual de que TI lo cargó al ERP, nunca un ajuste
 * automático — no hay ningún `fetch` a Dynamics acá ni lo va a haber hasta
 * esa fase.
 */

import { obtenerInventario, simularLatencia } from './_compartido';
import { sesionMemoria } from './sesion-memoria';
import type { EstadoLacrado, RepositorioLacrado } from '../puertos/repositorios';

const APROBACIONES_REQUERIDAS = 2;

/** Código corto de sucursal para el hash — mismo criterio de "no inventar" que el resto: solo las 4 que ya existen en sesion-memoria.ts. */
const CODIGO_SUCURSAL: Record<number, string> = {
  1: 'LUZ',
  2: 'CAR',
  3: 'BOL',
  4: 'SUC',
};

interface RegistroInterno {
  aprobaciones: { colaboradorId: number; nombre: string }[];
  lacrado: boolean;
  hash: string | null;
  lacradoEn: string | null;
  registradoManualmenteEnDynamics: boolean;
}

const registros = new Map<number, RegistroInterno>();

function registroDe(inventarioId: number): RegistroInterno {
  let registro = registros.get(inventarioId);
  if (!registro) {
    registro = { aprobaciones: [], lacrado: false, hash: null, lacradoEn: null, registradoManualmenteEnDynamics: false };
    registros.set(inventarioId, registro);
  }
  return registro;
}

async function construirEstado(inventarioId: number): Promise<EstadoLacrado> {
  const registro = registroDe(inventarioId);
  const inventario = await obtenerInventario(inventarioId);
  const todoSincronizado = !!inventario && inventario.hojas.every((h) => h.sync === 'sincronizado');

  return {
    inventarioId,
    aprobaciones: registro.aprobaciones,
    aprobacionesRequeridas: APROBACIONES_REQUERIDAS,
    todoSincronizado,
    lacrado: registro.lacrado,
    hash: registro.hash,
    lacradoEn: registro.lacradoEn,
    registradoManualmenteEnDynamics: registro.registradoManualmenteEnDynamics,
  };
}

function generarHash(sucursalId: number, items: number): string {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const codigoSucursal = CODIGO_SUCURSAL[sucursalId] ?? 'SUC';
  const sufijo = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `#INV-${anio}-${mes}-${codigoSucursal}-${items}-${sufijo}`;
}

export const lacradoMemoria: RepositorioLacrado = {
  async estado(inventarioId) {
    await simularLatencia();
    return construirEstado(inventarioId);
  },

  async aprobar(inventarioId, colaboradorId) {
    await simularLatencia();
    const registro = registroDe(inventarioId);
    if (registro.lacrado) {
      throw new Error('El inventario ya está lacrado: no se pueden agregar más aprobaciones.');
    }
    if (registro.aprobaciones.some((a) => a.colaboradorId === colaboradorId)) {
      return construirEstado(inventarioId);
    }

    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

    const colaboradores = await sesionMemoria.colaboradores(inventario.sucursalId);
    const colaborador = colaboradores.find((c) => c.id === colaboradorId);
    if (!colaborador || colaborador.rol !== 'auditor') {
      throw new Error('Solo un Auditor de la sucursal puede aprobar el lacrado.');
    }

    registro.aprobaciones.push({ colaboradorId, nombre: colaborador.nombre });
    return construirEstado(inventarioId);
  },

  async lacrar(inventarioId) {
    await simularLatencia();
    const registro = registroDe(inventarioId);
    if (registro.lacrado) return construirEstado(inventarioId);

    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

    if (registro.aprobaciones.length < APROBACIONES_REQUERIDAS) {
      throw new Error(`Faltan aprobaciones: ${registro.aprobaciones.length} / ${APROBACIONES_REQUERIDAS}.`);
    }
    if (!inventario.hojas.every((h) => h.sync === 'sincronizado')) {
      throw new Error('No se puede lacrar con hojas todavía sin sincronizar con Dynamics.');
    }

    registro.lacrado = true;
    registro.hash = generarHash(inventario.sucursalId, inventario.snapshotItems);
    registro.lacradoEn = new Date().toISOString();
    return construirEstado(inventarioId);
  },

  async marcarRegistradoEnDynamics(inventarioId) {
    await simularLatencia();
    const registro = registroDe(inventarioId);
    if (!registro.lacrado) {
      throw new Error('Todavía no se puede registrar en Dynamics: el inventario no está lacrado.');
    }
    registro.registradoManualmenteEnDynamics = true;
    return construirEstado(inventarioId);
  },
};
