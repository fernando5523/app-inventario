import { describe, expect, it } from 'vitest';

import { esUrlDeProduccion, leerConfigD365, leerConfigEntra } from './consumo-interno.config';

const ONEBOX = 'https://usnconeboxax1aos.cloud.onebox.dynamics.com/';
const CRED = { D365_TENANT_ID: 't', D365_CLIENT_ID: 'c', D365_CLIENT_SECRET: 's' };

describe('leerConfigD365', () => {
  it('fuera de produccion se niega a apuntar al Dynamics de produccion', () => {
    expect(() => leerConfigD365({ ...CRED, NODE_ENV: 'development', CONSUMO_D365_BASE_URL: 'https://mistr.operations.dynamics.com' })).toThrow(
      /produccion/,
    );
  });

  it('en produccion si lo acepta (es su destino)', () => {
    expect(leerConfigD365({ ...CRED, NODE_ENV: 'production', CONSUMO_D365_BASE_URL: 'https://mistr.operations.dynamics.com' }).baseUrl).toBe(
      'https://mistr.operations.dynamics.com',
    );
  });

  it('una URL ilegible cuenta como produccion: ante la duda no se escribe', () => {
    expect(esUrlDeProduccion('no es una url', {})).toBe(true);
  });

  it('el resource por defecto es la base URL; el onebox lo pisa', () => {
    const base = leerConfigD365({ ...CRED, CONSUMO_D365_BASE_URL: ONEBOX });
    expect(base.resource).toBe('https://usnconeboxax1aos.cloud.onebox.dynamics.com');
    expect(base.dataAreaId).toBe('trv');
    const conSpn = leerConfigD365({ ...CRED, CONSUMO_D365_BASE_URL: ONEBOX, CONSUMO_D365_RESOURCE: 'spn:abc' });
    expect(conSpn.resource).toBe('spn:abc');
  });

  it('la URL nunca se hereda de D365_BASE_URL (la del inventario)', () => {
    expect(() => leerConfigD365({ ...CRED, D365_BASE_URL: ONEBOX })).toThrow(/CONSUMO_D365_BASE_URL/);
  });

  it('sin credenciales avisa cuales faltan', () => {
    expect(() => leerConfigD365({ CONSUMO_D365_BASE_URL: ONEBOX })).toThrow(/CLIENT_SECRET/);
  });
});

describe('leerConfigEntra', () => {
  it('normaliza la lista de aprobadores', () => {
    expect(leerConfigEntra({ CONSUMO_APROBADORES: ' A@x.pe , b@x.pe,, ' }).aprobadores).toEqual(['a@x.pe', 'b@x.pe']);
  });
});
