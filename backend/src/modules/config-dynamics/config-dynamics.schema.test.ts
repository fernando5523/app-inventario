import { describe, expect, it } from 'vitest';
import { guardarConfigDynamicsSchema } from './config-dynamics.schema';

const base = {
  tenantId: '11111111-2222-3333-4444-555555555555',
  clientId: '66666666-7777-8888-9999-000000000000',
  urlBase: 'https://market-trujillo.operations.dynamics.com',
};

describe('guardarConfigDynamicsSchema', () => {
  it('acepta los tres campos sin secreto: se corrige el tenant sin re-tipear el secreto', () => {
    expect(guardarConfigDynamicsSchema.safeParse(base).success).toBe(true);
  });

  it('acepta el secreto cuando viene', () => {
    expect(guardarConfigDynamicsSchema.safeParse({ ...base, clientSecret: 'Abc8Q~secreto' }).success).toBe(true);
  });

  it('EXIGE https: un secreto no viaja por http', () => {
    const r = guardarConfigDynamicsSchema.safeParse({ ...base, urlBase: 'http://market-trujillo.dynamics.com' });
    expect(r.success).toBe(false);
  });

  it('saca la barra final de la URL: d365Config le agrega "/data" al armar la OData', () => {
    const r = guardarConfigDynamicsSchema.parse({ ...base, urlBase: 'https://market.dynamics.com///' });
    expect(r.urlBase).toBe('https://market.dynamics.com');
  });

  it('rechaza campos vacios', () => {
    expect(guardarConfigDynamicsSchema.safeParse({ ...base, tenantId: '   ' }).success).toBe(false);
    expect(guardarConfigDynamicsSchema.safeParse({ ...base, clientId: '' }).success).toBe(false);
  });

  it('rechaza un secreto vacio: mandarlo vacio no es lo mismo que no mandarlo', () => {
    // Sin esta regla, un campo que el usuario borro sin querer borraria el
    // secreto guardado y Dynamics dejaria de andar sin que nadie sepa por que.
    expect(guardarConfigDynamicsSchema.safeParse({ ...base, clientSecret: '' }).success).toBe(false);
  });

  it('RECHAZA un campo mal escrito en vez de ignorarlo en silencio', () => {
    // "client_secret" en vez de "clientSecret": si se ignorara, la pantalla
    // diria que guardo y Azure seguiria rechazando, sin ninguna pista.
    expect(guardarConfigDynamicsSchema.safeParse({ ...base, client_secret: 'Abc8Q~x' }).success).toBe(false);
  });

  it('acepta dataAreaId opcional', () => {
    expect(guardarConfigDynamicsSchema.parse({ ...base, dataAreaId: 'trv' }).dataAreaId).toBe('trv');
    expect(guardarConfigDynamicsSchema.parse(base).dataAreaId).toBeUndefined();
  });
});
