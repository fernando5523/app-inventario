/**
 * Lo que estos tests protegen es DE DÓNDE SALEN LOS MONTOS del panel de
 * auditoría.
 *
 * El reparto entre cuadros (únicos / por paquete / empresa) NO se puede
 * calcular desde el teléfono: depende del umbral congelado en el inventario,
 * que no viaja en ninguna respuesta. Si algún día alguien "optimiza" esto
 * derivándolo de la matriz, el panel va a mostrar un reparto distinto del que
 * usa la liquidación — y esa diferencia son soles descontados de un sueldo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import { recordarToken } from './_http';
import { auditoriaApi } from './auditoria-api';

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

/** El escenario 8059, con los números reales medidos contra el backend vivo. */
const RESUMEN = {
  inventarioId: 8059,
  estado: 'en_curso',
  embudo: { itemsTotales: 7 },
  zonas: [],
  resumen: {
    items: 7,
    cuadrados: 0,
    conFalta: 3,
    deEmpresa: 0,
    sinDatoErp: 4,
    sinContar: 0,
    auditables: 3,
    porcentajeCuadrado: 0,
    porcentajeAuditable: 42.9,
    unidadesFaltantes: 46,
    unidadesSobrantes: 0,
    valorFaltante: 460,
    valorSobrante: 0,
    valorFaltanteDescontable: 20,
    sinPrecio: 0,
    porClase: {
      unidad: { items: 1, unidadesFaltantes: 2, unidadesSobrantes: 0, valorFaltante: 20, valorSobrante: 0 },
      paquete: { items: 2, unidadesFaltantes: 44, unidadesSobrantes: 0, valorFaltante: 440, valorSobrante: 0 },
      empresa: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
    },
  },
};

beforeEach(() => {
  recordarToken('token-de-prueba');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auditoriaApi.resumen', () => {
  it('pega contra /resumen y devuelve el resumen desenvuelto', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(RESUMEN));
    vi.stubGlobal('fetch', fetchMock);

    const r = await auditoriaApi.resumen(8059);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/auditoria/inventarios/8059/resumen');
    expect(r.valorFaltante).toBe(460);
    expect(r.valorFaltanteDescontable).toBe(20);
  });

  /**
   * EL NÚMERO QUE FALTABA EN LA PANTALLA. Con 44 de 46 unidades yéndose al
   * cuadro de paquetes, el bruto (460) y lo que de verdad se descuenta (20)
   * son dos cosas MUY distintas, y el panel mostraba solo el primero.
   */
  it('el bruto y el descontable son distintos, y los dos llegan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(RESUMEN)));

    const r = await auditoriaApi.resumen(8059);

    expect(r.valorFaltante).not.toBe(r.valorFaltanteDescontable);
    // Lo descontable es exactamente el cuadro de únicos: de ahí y de ningún otro lado.
    expect(r.valorFaltanteDescontable).toBe(r.porClase.unidad.valorFaltante);
  });

  it('los tres cuadros llegan enteros, con sus ítems y sus unidades', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(RESUMEN)));

    const { porClase } = await auditoriaApi.resumen(8059);

    expect(porClase.unidad).toMatchObject({ items: 1, unidadesFaltantes: 2, valorFaltante: 20 });
    expect(porClase.paquete).toMatchObject({ items: 2, unidadesFaltantes: 44, valorFaltante: 440 });
    expect(porClase.empresa.items).toBe(0);
  });

  /** Los tres cuadros suman el total: es lo que impide que un ítem se cuente dos veces o se pierda. */
  it('la suma de los tres cuadros da el faltante bruto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(RESUMEN)));

    const { porClase, valorFaltante, unidadesFaltantes } = await auditoriaApi.resumen(8059);

    const suma = porClase.unidad.valorFaltante + porClase.paquete.valorFaltante + porClase.empresa.valorFaltante;
    expect(suma).toBe(valorFaltante);
    const unidades =
      porClase.unidad.unidadesFaltantes + porClase.paquete.unidadesFaltantes + porClase.empresa.unidadesFaltantes;
    expect(unidades).toBe(unidadesFaltantes);
  });

  it('un fallo del servidor sube como error: la pantalla muestra "—", no un cero inventado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'No se pudo calcular el resumen.' }, 500)));

    await expect(auditoriaApi.resumen(8059)).rejects.toThrow();
  });
});
