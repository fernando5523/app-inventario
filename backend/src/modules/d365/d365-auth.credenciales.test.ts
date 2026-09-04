/**
 * EL test que hubiera atrapado el bug.
 *
 * `credencialesEfectivas()` implementaba bien la precedencia "la base le gana
 * al .env" y tenía todo para funcionar. El problema era otro:
 * `d365-auth.service.ts` no la llamaba — leía `d365Config` (el `.env`)
 * directo. La pantalla mostraba las credenciales de la base, la prueba de
 * conexión decía "origen: base", y el traído del catálogo usaba el archivo.
 *
 * Un test de `credencialesEfectivas()` sola pasaba igual. Lo que faltaba es
 * esto: verificar que el servicio que PIDE EL TOKEN use lo que esa función
 * devuelve. Por eso el test mira el `fetch` — la URL y el body que salen a
 * Azure AD son la única evidencia de qué credenciales se usaron de verdad.
 *
 * `esVigente` (lógica pura, sin red) se prueba aparte en d365-auth.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const credencialesMock = vi.hoisted(() => vi.fn());
vi.mock('../config-dynamics/config-dynamics.service', () => ({
  credencialesEfectivas: credencialesMock,
}));

import { D365AuthService } from './d365-auth.service';

const DE_LA_BASE = {
  tenantId: 'tenant-de-la-base',
  clientId: 'client-de-la-base',
  clientSecret: 'secreto-de-la-base',
  baseUrl: 'https://de-la-base.operations.dynamics.com',
  dataAreaId: 'trv',
  origen: 'base' as const,
};

function respuestaDeAzure() {
  return {
    ok: true,
    json: async () => ({
      access_token: 'token-nuevo',
      token_type: 'Bearer',
      // Azure manda `expires_on` como epoch en SEGUNDOS, string.
      expires_on: String(Math.floor(Date.now() / 1000) + 3600),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  credencialesMock.mockResolvedValue(DE_LA_BASE);
  vi.stubGlobal('fetch', vi.fn(async () => respuestaDeAzure()));
});

describe('D365AuthService usa las credenciales EFECTIVAS, no el .env', () => {
  it('pide el token con lo que devuelve credencialesEfectivas', async () => {
    // Instancia nueva: el singleton exportado puede traer cache de otro test.
    const auth = new D365AuthService();

    await auth.generarToken();

    const [url, opciones] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];

    // El tenant viaja en la URL del endpoint de Azure AD.
    expect(url).toContain('tenant-de-la-base');
    // Y el resto en el body form-urlencoded.
    const body = String(opciones.body);
    expect(body).toContain('client_id=client-de-la-base');
    expect(body).toContain('client_secret=secreto-de-la-base');
    expect(body).toContain('grant_type=client_credentials');
    // `resource` es la propia baseUrl de D365, no un scope v2.0.
    expect(decodeURIComponent(body)).toContain('resource=https://de-la-base.operations.dynamics.com');
  });

  it('la URL de OData sale de la misma fuente que el token', async () => {
    const auth = new D365AuthService();

    expect(await auth.getODataBaseUrl()).toBe('https://de-la-base.operations.dynamics.com/data');
    expect(await auth.getDataAreaId()).toBe('trv');
  });

  /**
   * Sin credenciales en NINGÚN lado se falla antes de tocar la red. Pedirle
   * un token a Azure con strings vacíos devuelve un 401 que después se
   * diagnostica como "Dynamics rechaza las credenciales" — cuando en
   * realidad no había ninguna que mandar.
   */
  it('sin credenciales tira 400 y NO llama a Azure', async () => {
    credencialesMock.mockResolvedValue({ ...DE_LA_BASE, origen: 'ninguno', clientSecret: '' });
    const auth = new D365AuthService();

    await expect(auth.generarToken()).rejects.toThrow(/no configurado/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  /**
   * El cache existe para no consultar la base en cada página de una bajada de
   * 16 lotes. Que exista es lo que hace viable leer de la base; sin él, este
   * cambio habría metido un query por request.
   */
  it('cachea las credenciales: dos llamadas seguidas consultan una sola vez', async () => {
    const auth = new D365AuthService();

    await auth.getODataBaseUrl();
    await auth.getODataBaseUrl();
    await auth.getDataAreaId();

    expect(credencialesMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Si Dynamics rechaza el token, una causa posible es que las credenciales
   * cambiaron. Reintentar con las mismas cacheadas sería pedir el mismo 401.
   */
  it('renovarToken tira el cache de credenciales, no solo el del token', async () => {
    const auth = new D365AuthService();

    await auth.getTokenValido();
    expect(credencialesMock).toHaveBeenCalledTimes(1);

    await auth.renovarToken();
    expect(credencialesMock).toHaveBeenCalledTimes(2);
  });
});
