import { describe, expect, it } from 'vitest';

import {
  aLinea,
  aResumen,
  coincideTexto,
  filtroHistorial,
  filtroPendientes,
  ordenarHistorial,
  ordenarPendientes,
  type SolicitudD365,
} from './consumo-interno.dominio';

const AHORA = new Date('2026-10-10T15:00:00Z');
const ENUM = 'Microsoft.Dynamics.DataEntities.TRU_InventConsumptionStatus';

const base: SolicitudD365 = {
  RequestId: 'SCI-000041',
  WarehouseId: 'AD02_CRH',
  WarehouseName: 'ALMACÉN DISPONIBLE MAYORISTA CARHUAZ',
  RequestDate: '2026-10-09T12:00:00Z',
  Reason: 'Para personal de despacho / descarga',
  WithdrawnByName: 'Santos Ferro Miriam',
  AuthorizedByName: 'Gerencia Comercial',
  RequestedByName: 'Santos Ferro Miriam',
  Status: 'Submitted',
  SubmittedDateTime: '2026-10-09T15:00:00Z',
  TotalAmount: 22.2,
  ApprovedAmount: 0,
  LineCount: 2,
  PendingLineCount: 2,
  JournalId: '',
  PostingMessage: '',
};

describe('filtros OData', () => {
  it('pendientes: la empresa y el estado Submitted con el enum de Dynamics', () => {
    expect(filtroPendientes('trv')).toBe(`dataAreaId eq 'trv' and Status eq ${ENUM}'Submitted'`);
  });

  it('historial sin filtros: solo las decididas (registrada, rechazada, error)', () => {
    expect(filtroHistorial('trv', {})).toBe(
      `dataAreaId eq 'trv' and (Status eq ${ENUM}'Posted' or Status eq ${ENUM}'Rejected' or Status eq ${ENUM}'PostingError')`,
    );
  });

  it('historial con todo: un estado, el rango de fechas inclusivo y el almacen', () => {
    expect(filtroHistorial('trv', { estado: 'rechazada', desde: '2026-10-01', hasta: '2026-10-31', almacen: 'AD02_CRH' })).toBe(
      `dataAreaId eq 'trv' and (Status eq ${ENUM}'Rejected') and RequestDate ge 2026-10-01T00:00:00Z and RequestDate le 2026-10-31T23:59:59Z and WarehouseId eq 'AD02_CRH'`,
    );
  });

  it('un estado que no es de historial (borrador) no se cuela: quedan los tres', () => {
    expect(filtroHistorial('trv', { estado: 'borrador' })).toContain(`'PostingError'`);
  });

  it('comilla simple escapada en el almacen', () => {
    expect(filtroHistorial('trv', { almacen: "X'Y" })).toContain(`WarehouseId eq 'X''Y'`);
  });
});

describe('aResumen', () => {
  it('traduce estados y marca demorada a las 24 horas exactas', () => {
    const r = aResumen(base, AHORA);
    expect(r).toMatchObject({ id: 'SCI-000041', estado: 'pendiente', fecha: '2026-10-09', horasEsperando: 24, demorada: true, productos: 2 });
  });

  it('23 horas no es demorada', () => {
    expect(aResumen({ ...base, SubmittedDateTime: '2026-10-09T16:00:01Z' }, AHORA).demorada).toBe(false);
  });

  it('una registrada vieja no es "demorada": el recordatorio es solo para lo pendiente', () => {
    expect(aResumen({ ...base, Status: 'Posted' }, AHORA)).toMatchObject({ estado: 'registrada', demorada: false });
  });

  it('la fecha vacia de Dynamics (1900) se muestra como sin dato, no como 1900', () => {
    expect(aResumen({ ...base, SubmittedDateTime: '1900-01-01T00:00:00Z' }, AHORA)).toMatchObject({ enviadaEn: null, horasEsperando: null });
  });

  it('un estado desconocido nunca se muestra como registrada', () => {
    expect(aResumen({ ...base, Status: 'Raro' }, AHORA).estado).toBe('borrador');
  });

  it('un importe que no vino es 0, no NaN', () => {
    const { TotalAmount: _t, ...sinTotal } = base;
    expect(aResumen(sinTotal, AHORA).importeTotal).toBe(0);
  });
});

describe('aLinea', () => {
  it('traduce la decision y mantiene la unidad tal como la manda el ERP', () => {
    expect(
      aLinea({ RequestId: 'SCI-1', LineNumber: 2, ItemNumber: '101057', UnitSymbol: 'Emp.4', Quantity: 1, InventoryQuantity: 4, LineStatus: 'Rejected' }),
    ).toMatchObject({ linea: 2, unidad: 'Emp.4', cantidadInventario: 4, decision: 'rechazada', decididoEn: null });
  });
});

describe('busqueda y orden', () => {
  const r = aResumen(base, AHORA);
  it('busca sin acentos ni mayusculas en almacen, motivo y personas', () => {
    expect(coincideTexto(r, 'almacen disponible')).toBe(true);
    expect(coincideTexto(r, 'DESPACHO')).toBe(true);
    expect(coincideTexto(r, 'miriam')).toBe(true);
    expect(coincideTexto(r, 'gerencia')).toBe(true);
    expect(coincideTexto(r, 'zapatos')).toBe(false);
    expect(coincideTexto(r, '  ')).toBe(true);
  });

  it('pendientes: la mas antigua primero; historial: la mas reciente primero', () => {
    const vieja = aResumen({ ...base, RequestId: 'SCI-1', SubmittedDateTime: '2026-10-01T10:00:00Z', RequestDate: '2026-10-01T12:00:00Z' }, AHORA);
    const nueva = aResumen({ ...base, RequestId: 'SCI-2', SubmittedDateTime: '2026-10-09T10:00:00Z', RequestDate: '2026-10-09T12:00:00Z' }, AHORA);
    expect(ordenarPendientes([nueva, vieja]).map((s) => s.id)).toEqual(['SCI-1', 'SCI-2']);
    expect(ordenarHistorial([vieja, nueva]).map((s) => s.id)).toEqual(['SCI-2', 'SCI-1']);
  });
});
