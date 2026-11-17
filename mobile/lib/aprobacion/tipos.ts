/**
 * Contrato de /api/consumo-interno (backend/src/modules/consumo-interno).
 * Copia a mano, igual que el resto de los adaptadores: si el backend cambia
 * un campo, `tsc` no lo ve -- lo ven los tests del adaptador y la pantalla.
 */

export type EstadoSolicitud = 'borrador' | 'pendiente' | 'registrada' | 'rechazada' | 'error-registro' | 'anulada';
export type DecisionLinea = 'pendiente' | 'aprobada' | 'rechazada';

export interface Aprobador {
  cuenta: string;
  nombre: string;
  origen: 'entra' | 'desarrollo';
}

export interface SolicitudResumen {
  id: string;
  almacenId: string;
  almacenNombre: string;
  fecha: string | null;
  motivo: string;
  retiraNombre: string;
  autorizaNombre: string;
  solicitaNombre: string;
  estado: EstadoSolicitud;
  enviadaEn: string | null;
  horasEsperando: number | null;
  demorada: boolean;
  importeTotal: number;
  importeAprobado: number;
  productos: number;
  productosPendientes: number;
  diario: string;
  mensajeRegistro: string;
}

export interface LineaSolicitud {
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

export interface SolicitudDetalle extends SolicitudResumen {
  lineas: LineaSolicitud[];
}

export interface Pendientes {
  solicitudes: SolicitudResumen[];
  demoradas: number;
}

export interface FiltrosHistorial {
  desde?: string;
  hasta?: string;
  estado?: 'registrada' | 'rechazada' | 'error-registro';
  texto?: string;
}

export interface ResultadoDecisionMasiva {
  solicitud: SolicitudDetalle;
  decididas: number;
  error: string | null;
}
