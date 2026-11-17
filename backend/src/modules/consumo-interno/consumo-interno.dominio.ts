/**
 * Logica pura de la aprobacion de consumo interno: filtros OData, traduccion
 * de lo que devuelve Dynamics a lo que muestra la app, antiguedad y busqueda.
 * Sin red ni Express, para probarla entera en consumo-interno.dominio.test.ts.
 */

import { literalOData } from './consumo-interno.d365';

// ---------------------------------------------------------------------------
// Lo que devuelve Dynamics (contrato de las entidades)
// ---------------------------------------------------------------------------

export type EstadoD365 = 'Draft' | 'Submitted' | 'Posted' | 'Rejected' | 'PostingError' | 'Cancelled';
export type EstadoLineaD365 = 'Pending' | 'Approved' | 'Rejected';

export interface SolicitudD365 {
  dataAreaId?: string;
  RequestId: string;
  WarehouseId?: string;
  WarehouseName?: string;
  RequestDate?: string;
  Reason?: string;
  WithdrawnByName?: string;
  AuthorizedByName?: string;
  RequestedByName?: string;
  Status?: string;
  SubmittedDateTime?: string;
  TotalAmount?: number;
  ApprovedAmount?: number;
  LineCount?: number;
  PendingLineCount?: number;
  JournalId?: string;
  PostingMessage?: string;
}

export interface LineaD365 {
  RequestId: string;
  LineNumber: number;
  ItemNumber?: string;
  ItemName?: string;
  UnitSymbol?: string;
  Quantity?: number;
  InventoryQuantity?: number;
  InventoryUnitSymbol?: string;
  SalesPrice?: number;
  LineAmount?: number;
  LineStatus?: string;
  DecidedBy?: string;
  DecidedDateTime?: string;
  DecisionComment?: string;
}

// ---------------------------------------------------------------------------
// Lo que ve la app
// ---------------------------------------------------------------------------

export type EstadoSolicitud = 'borrador' | 'pendiente' | 'registrada' | 'rechazada' | 'error-registro' | 'anulada';
export type DecisionLinea = 'pendiente' | 'aprobada' | 'rechazada';

export interface SolicitudResumenDto {
  id: string;
  almacenId: string;
  almacenNombre: string;
  /** Fecha de la solicitud, `AAAA-MM-DD`. */
  fecha: string | null;
  motivo: string;
  retiraNombre: string;
  autorizaNombre: string;
  solicitaNombre: string;
  estado: EstadoSolicitud;
  /** ISO. null si Dynamics no la tiene (una solicitud nunca enviada). */
  enviadaEn: string | null;
  /** Horas completas desde el envio. null si no hay fecha de envio. */
  horasEsperando: number | null;
  /** Esperando 24 horas o mas: el recordatorio de la app. */
  demorada: boolean;
  importeTotal: number;
  importeAprobado: number;
  productos: number;
  productosPendientes: number;
  diario: string;
  mensajeRegistro: string;
}

export interface LineaDto {
  linea: number;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidadInventario: number;
  unidadInventario: string;
  precio: number;
  importe: number;
  decision: DecisionLinea;
  decididoPor: string;
  decididoEn: string | null;
  comentario: string;
}

export interface SolicitudDetalleDto extends SolicitudResumenDto {
  lineas: LineaDto[];
}

export const HORAS_RECORDATORIO = 24;

const ESTADOS: Record<EstadoD365, EstadoSolicitud> = {
  Draft: 'borrador',
  Submitted: 'pendiente',
  Posted: 'registrada',
  Rejected: 'rechazada',
  PostingError: 'error-registro',
  Cancelled: 'anulada',
};

const ESTADOS_INVERSO = Object.fromEntries(Object.entries(ESTADOS).map(([d, a]) => [a, d])) as Record<EstadoSolicitud, EstadoD365>;

const DECISIONES: Record<EstadoLineaD365, DecisionLinea> = { Pending: 'pendiente', Approved: 'aprobada', Rejected: 'rechazada' };

/** Estados que cuentan como "ya decidida" para el historial. */
export const ESTADOS_HISTORIAL: EstadoSolicitud[] = ['registrada', 'rechazada', 'error-registro'];

const ENUM_ESTADO = 'Microsoft.Dynamics.DataEntities.TRU_InventConsumptionStatus';

function enumEstado(estado: EstadoSolicitud): string {
  return `Status eq ${ENUM_ESTADO}'${ESTADOS_INVERSO[estado]}'`;
}

/** Un estado que Dynamics no deberia mandar se muestra como borrador, nunca como "registrada". */
export function estadoDeD365(valor: string | undefined): EstadoSolicitud {
  return ESTADOS[valor as EstadoD365] ?? 'borrador';
}

export function decisionDeD365(valor: string | undefined): DecisionLinea {
  return DECISIONES[valor as EstadoLineaD365] ?? 'pendiente';
}

/** Dynamics manda `1900-01-01T00:00:00Z` para una fecha vacia. */
function fechaReal(iso: string | undefined): string | null {
  if (!iso || iso.startsWith('1900-01-01')) return null;
  return iso;
}

export function horasDesde(iso: string | null, ahora: Date): number | null {
  if (iso === null) return null;
  const desde = Date.parse(iso);
  if (Number.isNaN(desde)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - desde) / 3_600_000));
}

const numero = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const texto = (t: string | undefined): string => (t ?? '').trim();

export function aResumen(s: SolicitudD365, ahora: Date): SolicitudResumenDto {
  const enviadaEn = fechaReal(s.SubmittedDateTime);
  const estado = estadoDeD365(s.Status);
  const horas = horasDesde(enviadaEn, ahora);
  const fecha = fechaReal(s.RequestDate);
  return {
    id: s.RequestId,
    almacenId: texto(s.WarehouseId),
    almacenNombre: texto(s.WarehouseName),
    fecha: fecha === null ? null : fecha.slice(0, 10),
    motivo: texto(s.Reason),
    retiraNombre: texto(s.WithdrawnByName),
    autorizaNombre: texto(s.AuthorizedByName),
    solicitaNombre: texto(s.RequestedByName),
    estado,
    enviadaEn,
    horasEsperando: horas,
    // El recordatorio es solo para lo que todavia espera a la aprobadora.
    demorada: estado === 'pendiente' && horas !== null && horas >= HORAS_RECORDATORIO,
    importeTotal: numero(s.TotalAmount),
    importeAprobado: numero(s.ApprovedAmount),
    productos: numero(s.LineCount),
    productosPendientes: numero(s.PendingLineCount),
    diario: texto(s.JournalId),
    mensajeRegistro: texto(s.PostingMessage),
  };
}

export function aLinea(l: LineaD365): LineaDto {
  return {
    linea: numero(l.LineNumber),
    codigo: texto(l.ItemNumber),
    nombre: texto(l.ItemName),
    unidad: texto(l.UnitSymbol),
    cantidad: numero(l.Quantity),
    cantidadInventario: numero(l.InventoryQuantity),
    unidadInventario: texto(l.InventoryUnitSymbol),
    precio: numero(l.SalesPrice),
    importe: numero(l.LineAmount),
    decision: decisionDeD365(l.LineStatus),
    decididoPor: texto(l.DecidedBy),
    decididoEn: fechaReal(l.DecidedDateTime),
    comentario: texto(l.DecisionComment),
  };
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export function filtroPendientes(dataAreaId: string): string {
  return `dataAreaId eq ${literalOData(dataAreaId)} and ${enumEstado('pendiente')}`;
}

export interface FiltrosHistorial {
  /** `AAAA-MM-DD`, inclusive. */
  desde?: string | undefined;
  /** `AAAA-MM-DD`, inclusive. */
  hasta?: string | undefined;
  almacen?: string | undefined;
  estado?: EstadoSolicitud | undefined;
  texto?: string | undefined;
}

/**
 * El `$filter` del historial. El texto NO va a Dynamics: F&O no soporta
 * `contains()` y su comodin solo sirve sobre un campo; se busca en memoria
 * sobre varios (`coincideTexto`), y el volumen lo permite (unas 45 solicitudes
 * al mes en toda la cadena).
 */
export function filtroHistorial(dataAreaId: string, f: FiltrosHistorial): string {
  const partes = [`dataAreaId eq ${literalOData(dataAreaId)}`];
  const estados = f.estado !== undefined && ESTADOS_HISTORIAL.includes(f.estado) ? [f.estado] : ESTADOS_HISTORIAL;
  partes.push(`(${estados.map(enumEstado).join(' or ')})`);
  if (f.desde) partes.push(`RequestDate ge ${f.desde}T00:00:00Z`);
  if (f.hasta) partes.push(`RequestDate le ${f.hasta}T23:59:59Z`);
  if (f.almacen) partes.push(`WarehouseId eq ${literalOData(f.almacen)}`);
  return partes.join(' and ');
}

function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Busqueda sin acentos ni mayusculas en los datos que la aprobadora reconoce. */
export function coincideTexto(s: SolicitudResumenDto, buscado: string | undefined): boolean {
  const q = normalizar(buscado ?? '');
  if (q === '') return true;
  return [s.id, s.almacenId, s.almacenNombre, s.motivo, s.solicitaNombre, s.autorizaNombre, s.retiraNombre, s.diario].some((campo) =>
    normalizar(campo).includes(q),
  );
}

/** Pendientes: la mas antigua primero (es la que mas espera). */
export function ordenarPendientes(lista: SolicitudResumenDto[]): SolicitudResumenDto[] {
  return [...lista].sort((a, b) => (a.enviadaEn ?? '').localeCompare(b.enviadaEn ?? '') || a.id.localeCompare(b.id));
}

/** Historial: la mas reciente primero. */
export function ordenarHistorial(lista: SolicitudResumenDto[]): SolicitudResumenDto[] {
  return [...lista].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || b.id.localeCompare(a.id, 'es', { numeric: true }));
}
