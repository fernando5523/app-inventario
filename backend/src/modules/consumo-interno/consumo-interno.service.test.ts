import { describe, expect, it } from 'vitest';

import type { IdentidadAprobador } from './consumo-interno.auth';
import { ClienteD365Consumo } from './consumo-interno.d365';
import type { LineaD365, SolicitudD365 } from './consumo-interno.dominio';
import { decidirLinea, decidirPendientes, listarPendientes } from './consumo-interno.service';
import { Conflicto } from '../../shared/errores';

const APROBADORA: IdentidadAprobador = { cuenta: 'elizabeth@empresa.pe', nombre: 'Elizabeth', origen: 'entra' };

/** Un Dynamics en memoria: las lineas cambian de estado con cada DecideLine, como el real. */
function dynamicsFalso(opciones: { fallaEnLinea?: number } = {}) {
  const cabecera: SolicitudD365 = { RequestId: 'SCI-9', Status: 'Submitted', SubmittedDateTime: '2026-10-09T10:00:00Z', LineCount: 3 };
  const lineas: LineaD365[] = [1, 2, 3].map((n) => ({ RequestId: 'SCI-9', LineNumber: n, ItemNumber: `I${n}`, LineStatus: 'Pending' }));
  const llamadas: Array<Record<string, unknown>> = [];

  const cliente = new ClienteD365Consumo(() => ({
    tenantId: 't',
    clientId: 'c',
    clientSecret: 's',
    baseUrl: 'https://onebox',
    resource: 'spn:x',
    dataAreaId: 'trv',
  }));
  cliente.listar = (async (coleccion: string) =>
    coleccion.endsWith('Lines') ? lineas.map((l) => ({ ...l })) : [{ ...cabecera }]) as ClienteD365Consumo['listar'];
  cliente.accion = (async (ruta: string, cuerpo: Record<string, unknown>) => {
    llamadas.push({ ruta, ...cuerpo });
    if (cuerpo._lineNumber === opciones.fallaEnLinea) throw new Conflicto('Dynamics no pudo guardar la decision.');
    const fila = lineas.find((l) => l.LineNumber === cuerpo._lineNumber)!;
    fila.LineStatus = cuerpo._approve ? 'Approved' : 'Rejected';
    if (lineas.every((l) => l.LineStatus !== 'Pending')) cabecera.Status = lineas.some((l) => l.LineStatus === 'Approved') ? 'Posted' : 'Rejected';
    return null;
  }) as ClienteD365Consumo['accion'];
  return { cliente, llamadas, cabecera };
}

describe('decidirLinea', () => {
  it('manda la identidad del token, no la del cliente, y devuelve la solicitud actualizada', async () => {
    const { cliente, llamadas } = dynamicsFalso();
    const r = await decidirLinea('SCI-9', 2, { aprobar: false, comentario: ' no corresponde ' }, APROBADORA, cliente);
    expect(llamadas[0]).toMatchObject({
      ruta: "TRUInventConsumptionRequests(dataAreaId='trv',RequestId='SCI-9')/Microsoft.Dynamics.DataEntities.DecideLine",
      _lineNumber: 2,
      _approve: false,
      _comment: 'no corresponde',
      _approverAccount: 'elizabeth@empresa.pe',
      _approverName: 'Elizabeth',
    });
    expect(r.lineas.find((l) => l.linea === 2)?.decision).toBe('rechazada');
  });

  it('una linea ya decidida da 409 sin ir a Dynamics', async () => {
    const { cliente, llamadas } = dynamicsFalso();
    await decidirLinea('SCI-9', 1, { aprobar: true }, APROBADORA, cliente);
    await expect(decidirLinea('SCI-9', 1, { aprobar: true }, APROBADORA, cliente)).rejects.toMatchObject({ status: 409 });
    expect(llamadas).toHaveLength(1);
  });
});

describe('decidirPendientes', () => {
  it('decide todas en orden y la ultima deja la solicitud registrada', async () => {
    const { cliente, llamadas } = dynamicsFalso();
    const r = await decidirPendientes('SCI-9', { aprobar: true }, APROBADORA, cliente);
    expect(llamadas.map((l) => l._lineNumber)).toEqual([1, 2, 3]);
    expect(r).toMatchObject({ decididas: 3, error: null });
    expect(r.solicitud.estado).toBe('registrada');
  });

  it('se para en la primera que falla y dice cuantas quedaron decididas', async () => {
    const { cliente } = dynamicsFalso({ fallaEnLinea: 2 });
    const r = await decidirPendientes('SCI-9', { aprobar: true }, APROBADORA, cliente);
    expect(r.decididas).toBe(1);
    expect(r.error).toMatch(/no pudo guardar/);
    expect(r.solicitud.estado).toBe('pendiente');
  });

  it('una solicitud que ya no esta pendiente da 409', async () => {
    const { cliente, cabecera } = dynamicsFalso();
    cabecera.Status = 'Posted';
    await expect(decidirPendientes('SCI-9', { aprobar: true }, APROBADORA, cliente)).rejects.toMatchObject({ status: 409 });
  });
});

describe('listarPendientes', () => {
  it('cuenta las demoradas para el recordatorio', async () => {
    const { cliente } = dynamicsFalso();
    const r = await listarPendientes(cliente, new Date('2026-10-10T11:00:00Z'));
    expect(r).toMatchObject({ demoradas: 1 });
  });
});

describe('ClienteD365Consumo.accion', () => {
  it('manda cross-company=true y devuelve el error de negocio de Dynamics tal cual (409)', async () => {
    const pedidos: string[] = [];
    const fetchFalso = (async (url: string | URL | Request) => {
      const u = String(url);
      pedidos.push(u);
      if (u.includes('oauth2/token')) return new Response(JSON.stringify({ access_token: 'x', token_type: 'Bearer', expires_on: '9999999999' }));
      return new Response(
        JSON.stringify({ error: { message: 'An error has occurred.', innererror: { message: 'La línea 1.00 de la solicitud SCI-000051 ya está Aprobada: no se puede volver a decidir.' } } }),
        { status: 400 },
      );
    }) as typeof fetch;
    const cliente = new ClienteD365Consumo(
      () => ({ tenantId: 't', clientId: 'c', clientSecret: 's', baseUrl: 'https://onebox', resource: 'spn:x', dataAreaId: 'trv' }),
      fetchFalso,
    );
    await expect(cliente.accion('TRUInventConsumptionRequests(x)/Microsoft.Dynamics.DataEntities.DecideLine', {})).rejects.toMatchObject({
      status: 409,
      message: 'La línea 1.00 de la solicitud SCI-000051 ya está Aprobada: no se puede volver a decidir.',
    });
    expect(pedidos[1]).toBe('https://onebox/data/TRUInventConsumptionRequests(x)/Microsoft.Dynamics.DataEntities.DecideLine?cross-company=true');
  });
});
