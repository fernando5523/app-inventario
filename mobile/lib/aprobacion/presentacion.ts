/**
 * Cómo se muestra cada dato de la aprobación. Puro, para probarlo sin
 * pantalla (presentacion.test.ts) y para que dos pantallas que muestran lo
 * mismo lo muestren igual: la regla de la casa es "mismo nombre, mismo número".
 */

import type { BadgeVariant } from '../../components/ui/Badge';
import type { DecisionLinea, EstadoSolicitud, FiltrosHistorial, LineaSolicitud, SolicitudResumen } from './tipos';

export const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  borrador: 'Borrador',
  pendiente: 'Pendiente',
  registrada: 'Registrada',
  rechazada: 'Rechazada',
  'error-registro': 'Error al registrar',
  anulada: 'Anulada',
};

/** El rojo de marca es la acción, nunca un estado: los estados usan la paleta semántica. */
export const VARIANTE_ESTADO: Record<EstadoSolicitud, BadgeVariant> = {
  borrador: 'espera',
  pendiente: 'proceso',
  registrada: 'ok',
  rechazada: 'espera',
  'error-registro': 'falta',
  anulada: 'espera',
};

export const ETIQUETA_DECISION: Record<DecisionLinea, string> = { pendiente: 'Por decidir', aprobada: 'Aprobado', rechazada: 'Rechazado' };
export const VARIANTE_DECISION: Record<DecisionLinea, BadgeVariant> = { pendiente: 'proceso', aprobada: 'ok', rechazada: 'espera' };

/** "Hace 3 h", "Hace 26 h", "Hace 3 días". Sin dato: "—" (nunca "Hace 0 h" inventado). */
export function textoEspera(horas: number | null): string {
  if (horas === null) return '—';
  if (horas < 1) return 'Hace menos de 1 h';
  if (horas < 48) return `Hace ${horas} h`;
  return `Hace ${Math.floor(horas / 24)} días`;
}

/** `2026-10-09` -> `09/10/2026`. Es una fecha sin hora: no se convierte de zona horaria. */
export function fechaDeSolicitud(fecha: string | null): string {
  if (fecha === null) return '—';
  const [a, m, d] = fecha.split('-');
  return a && m && d ? `${d}/${m}/${a}` : fecha;
}

/** "1 producto" / "3 productos". */
export function textoProductos(n: number): string {
  return `${n} producto${n === 1 ? '' : 's'}`;
}

/**
 * "1 Emp.4 · 4 U." -- la cantidad pedida y lo que sale del inventario. La
 * unidad va TAL CUAL la manda el ERP (regla de la casa: nada de pluralizar
 * "Emp.4"). Si ya está en la unidad de inventario, no se repite.
 */
export function textoCantidad(l: Pick<LineaSolicitud, 'cantidad' | 'unidad' | 'cantidadInventario' | 'unidadInventario'>): string {
  const pedido = `${formatoCantidad(l.cantidad)} ${l.unidad}`.trim();
  if (l.unidadInventario === '' || l.unidadInventario === l.unidad) return pedido;
  return `${pedido} · ${formatoCantidad(l.cantidadInventario)} ${l.unidadInventario}`;
}

function formatoCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** El resumen de la barra de Pendientes. */
export function resumenPendientes(total: number, demoradas: number): string {
  if (total === 0) return 'Sin solicitudes por aprobar';
  const base = `${total} solicitud${total === 1 ? '' : 'es'} por aprobar`;
  return demoradas > 0 ? `${base} · ${demoradas} con más de 24 h` : base;
}

/** El texto del recordatorio. null si no hay nada demorado. */
export function textoRecordatorio(demoradas: number): string | null {
  if (demoradas <= 0) return null;
  return demoradas === 1
    ? '1 solicitud espera tu aprobación hace más de 24 horas.'
    : `${demoradas} solicitudes esperan tu aprobación hace más de 24 horas.`;
}

/** Las líneas que quedan por decidir y lo que suman. */
export function pendientesDe(lineas: LineaSolicitud[]): { cantidad: number; importe: number } {
  const pendientes = lineas.filter((l) => l.decision === 'pendiente');
  return { cantidad: pendientes.length, importe: pendientes.reduce((s, l) => s + l.importe, 0) };
}

// ---------------------------------------------------------------------------
// Historial: periodos y filtros
// ---------------------------------------------------------------------------

export type Periodo = '7-dias' | 'este-mes' | 'mes-anterior' | 'todo';

export const PERIODOS: Array<{ id: Periodo; etiqueta: string }> = [
  { id: '7-dias', etiqueta: 'Últimos 7 días' },
  { id: 'este-mes', etiqueta: 'Este mes' },
  { id: 'mes-anterior', etiqueta: 'Mes anterior' },
  { id: 'todo', etiqueta: 'Todo' },
];

const aIso = (d: Date): string => d.toISOString().slice(0, 10);

/** El día de HOY en Lima (UTC-5, sin horario de verano), como fecha UTC a medianoche. */
function hoyEnLima(ahora: Date): Date {
  const lima = new Date(ahora.getTime() - 5 * 3_600_000);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()));
}

/** El rango `AAAA-MM-DD` (inclusive) de un periodo, en días de Lima. */
export function rangoDePeriodo(periodo: Periodo, ahora: Date = new Date()): { desde?: string; hasta?: string } {
  const hoy = hoyEnLima(ahora);
  const y = hoy.getUTCFullYear();
  const m = hoy.getUTCMonth();
  switch (periodo) {
    case '7-dias':
      return { desde: aIso(new Date(hoy.getTime() - 6 * 86_400_000)), hasta: aIso(hoy) };
    case 'este-mes':
      return { desde: aIso(new Date(Date.UTC(y, m, 1))), hasta: aIso(hoy) };
    case 'mes-anterior':
      return { desde: aIso(new Date(Date.UTC(y, m - 1, 1))), hasta: aIso(new Date(Date.UTC(y, m, 0))) };
    case 'todo':
      return {};
  }
}

export type FiltroEstado = 'todas' | NonNullable<FiltrosHistorial['estado']>;

export const FILTROS_ESTADO: Array<{ id: FiltroEstado; etiqueta: string }> = [
  { id: 'todas', etiqueta: 'Todas' },
  { id: 'registrada', etiqueta: 'Registradas' },
  { id: 'rechazada', etiqueta: 'Rechazadas' },
  { id: 'error-registro', etiqueta: 'Con error' },
];

/** Los filtros que viajan al servidor. Un campo vacío no viaja. */
export function filtrosDeHistorial(periodo: Periodo, estado: FiltroEstado, texto: string, ahora?: Date): FiltrosHistorial {
  const f: FiltrosHistorial = { ...rangoDePeriodo(periodo, ahora) };
  if (estado !== 'todas') f.estado = estado;
  if (texto.trim() !== '') f.texto = texto.trim();
  return f;
}

/** Los almacenes del historial cargado, ordenados como los lee una persona. */
export function almacenesDe(lista: SolicitudResumen[]): Array<{ id: string; nombre: string }> {
  const vistos = new Map<string, string>();
  for (const s of lista) if (s.almacenId !== '' && !vistos.has(s.almacenId)) vistos.set(s.almacenId, s.almacenNombre || s.almacenId);
  return [...vistos.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------------------------------------------------------------------------
// Filtro del historial (modal, mismo patrón que ModalFiltrosHojas: un
// borrador que se aplica con "Aplicar")
// ---------------------------------------------------------------------------

export interface FiltroHistorial {
  periodo: Periodo;
  estado: FiltroEstado;
  /** Código de almacén, o null = todos. Se filtra en el teléfono: las opciones salen del resultado. */
  almacen: string | null;
  texto: string;
}

/** "Este mes" es el punto de partida: no cuenta como filtro puesto. */
export const FILTRO_HISTORIAL_VACIO: FiltroHistorial = { periodo: 'este-mes', estado: 'todas', almacen: null, texto: '' };

/** Cuántos filtros cambió la persona respecto del inicial: el número del botón "Filtros". */
export function contarFiltrosHistorial(f: FiltroHistorial): number {
  return (
    (f.periodo !== FILTRO_HISTORIAL_VACIO.periodo ? 1 : 0) +
    (f.estado !== 'todas' ? 1 : 0) +
    (f.almacen !== null ? 1 : 0) +
    (f.texto.trim() !== '' ? 1 : 0)
  );
}

const etiquetaPeriodo = (p: Periodo): string => PERIODOS.find((x) => x.id === p)?.etiqueta ?? p;
const etiquetaEstado = (e: FiltroEstado): string => FILTROS_ESTADO.find((x) => x.id === e)?.etiqueta ?? e;

/** "Este mes · Rechazadas · AD02_CRH · "limpieza"" -- lo que se está mirando, siempre con el periodo. */
export function textoFiltroHistorial(f: FiltroHistorial): string {
  const partes = [etiquetaPeriodo(f.periodo)];
  if (f.estado !== 'todas') partes.push(etiquetaEstado(f.estado));
  if (f.almacen !== null) partes.push(f.almacen);
  if (f.texto.trim() !== '') partes.push(`"${f.texto.trim()}"`);
  return partes.join(' · ');
}

/** "Mostrando 3 solicitudes" / "Mostrando 1 de 3 solicitudes" (el total es el que trajo el servidor). */
export function textoMostrandoHistorial(visibles: number, total: number): string {
  const plural = total === 1 ? 'solicitud' : 'solicitudes';
  return visibles === total ? `Mostrando ${total} ${plural}` : `Mostrando ${visibles} de ${total} ${plural}`;
}

/** Las etiquetas que ofrecen los selects del modal, y su vuelta al valor. */
export const etiquetasPeriodo = (): string[] => PERIODOS.map((p) => p.etiqueta);
export const periodoDeEtiqueta = (e: string | null): Periodo => PERIODOS.find((p) => p.etiqueta === e)?.id ?? FILTRO_HISTORIAL_VACIO.periodo;
/** 'todas' no se ofrece como opción: es el "Cualquier estado" del select (igual que en ModalFiltrosHojas). */
export const etiquetasEstado = (): string[] => FILTROS_ESTADO.filter((e) => e.id !== 'todas').map((e) => e.etiqueta);
export const estadoDeEtiqueta = (e: string | null): FiltroEstado => FILTROS_ESTADO.find((x) => x.etiqueta === e)?.id ?? 'todas';
