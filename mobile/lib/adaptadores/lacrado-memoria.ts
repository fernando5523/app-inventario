/**
 * Adaptador en memoria de RepositorioLacrado.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts). Es el punto
 * de no retorno más fuerte del sistema, así que `lacrar()` NUNCA confía en
 * que la pantalla ya deshabilitó el botón: vuelve a chequear acá mismo que
 * haya 2 aprobaciones y que todas las hojas del inventario estén
 * sincronizadas, y rechaza si no.
 *
 * `aprobar()` sigue el mismo criterio con la doble validación: la firma se
 * registra contra el colaborador de la SESIÓN ACTIVA, no contra un id que
 * le pasen. Así, las 2 aprobaciones son necesariamente de 2 personas
 * distintas en 2 sesiones distintas — que es todo el punto de un control
 * de dos personas. Antes el id venía por parámetro y el auditor logueado
 * podía firmar por el otro (arreglado 2026-09-03, decisión del cliente).
 *
 * El envío a Dynamics es fase 2 (acordado con el cliente en la reunión de
 * requisitos, ver mobile/design/lacrado.html): `marcarRegistradoEnDynamics`
 * es una marca manual de que TI lo cargó al ERP, nunca un ajuste
 * automático — no hay ningún `fetch` a Dynamics acá ni lo va a haber hasta
 * esa fase.
 */

import { obtenerInventario, simularLatencia } from './_compartido';
import { sesionMemoria } from './sesion-memoria';
import type { AprobacionLacrado, EstadoLacrado, RepositorioLacrado } from '../puertos/repositorios';

const APROBACIONES_REQUERIDAS = 2;

/** Código corto de sucursal para el hash — mismo criterio de "no inventar" que el resto: solo las 4 que ya existen en sesion-memoria.ts. */
const CODIGO_SUCURSAL: Record<number, string> = {
  1: 'LUZ',
  2: 'CAR',
  3: 'BOL',
  4: 'SUC',
};

interface RegistroInterno {
  aprobaciones: AprobacionLacrado[];
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

  /**
   * La identidad de quien firma sale de la SESIÓN ACTIVA, nunca de un
   * parámetro. Es el corazón del arreglo: con `colaboradorId` por
   * parámetro, Gilmer podía aprobar por Rosa sin que Rosa hubiera entrado
   * nunca — dos firmas registradas, una sola persona presente.
   *
   * Se valida acá y no solo en la pantalla porque una pantalla que
   * esconde un botón no es un control de acceso: es una sugerencia.
   */
  async aprobar(inventarioId) {
    await simularLatencia();
    const registro = registroDe(inventarioId);
    if (registro.lacrado) {
      throw new Error('El inventario ya está lacrado: no se pueden agregar más aprobaciones.');
    }

    const sesion = await sesionMemoria.sesionActiva();
    if (!sesion) {
      throw new Error('No hay sesión activa: la aprobación se registra siempre contra quien está logueado.');
    }
    const quien = sesion.colaborador;

    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

    if (quien.rol !== 'auditor') {
      throw new Error('Solo un Auditor puede aprobar el lacrado.');
    }
    // El Auditor tiene sucursal siempre (solo el Administrador no la
    // tiene, ver tipos.ts#Sesion), pero se compara sin `!`: si alguna vez
    // llegara null, negar es lo correcto — no aprobar el cierre de un
    // inventario de otra tienda.
    if (sesion.sucursal?.id !== inventario.sucursalId) {
      throw new Error('Solo un Auditor de la sucursal del inventario puede aprobar su lacrado.');
    }
    // Ya no se devuelve el estado en silencio: que truene es lo honesto.
    // Un segundo toque del mismo auditor NO es una segunda firma, y el
    // mensaje tiene que decir por qué en vez de dejar creer que sumó.
    if (registro.aprobaciones.some((a) => a.colaboradorId === quien.id)) {
      throw new Error(
        `${quien.nombre} ya aprobó este lacrado. La segunda firma tiene que ser de otro Auditor, desde su propia sesión.`,
      );
    }

    registro.aprobaciones.push({ colaboradorId: quien.id, nombre: quien.nombre, fecha: new Date().toISOString() });
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
