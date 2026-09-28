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

/**
 * LA CADENA: cuatro tiendas, dos con inventario del período.
 *
 * Los números son coherentes entre sí a propósito -- el total es la suma real
 * de las dos filas con inventario -- porque lo que estos tests protegen es que
 * el adaptador NO los toque: los suma el servidor, que es el único que conoce
 * el umbral congelado de cada inventario.
 */
const CADENA = {
  periodo: { anio: 2026, mes: 9 },
  total: {
    tiendas: 4,
    conInventario: 2,
    items: 2964,
    cuadrados: 2951,
    auditables: 2964,
    valorFaltante: 349.6,
    valorSobrante: 12,
    porClase: {
      unidad: { items: 3, unidadesFaltantes: 14, unidadesSobrantes: 2, valorFaltante: 71.4, valorSobrante: 12 },
      paquete: { items: 5, unidadesFaltantes: 52, unidadesSobrantes: 0, valorFaltante: 259, valorSobrante: 0 },
      empresa: { items: 1, unidadesFaltantes: 4, unidadesSobrantes: 0, valorFaltante: 19.2, valorSobrante: 0 },
    },
    // 29 de Luzuriaga + 30,40 de Carhuaz. Sumado por el servidor, no acá.
    valorADescontar: 59.4,
  },
  tiendas: [
    {
      sucursalId: 1,
      sucursal: 'Market Central Luzuriaga',
      inventarioId: 8059,
      estado: 'conteo_cerrado',
      items: 2000,
      auditables: 2000,
      cuadrados: 1994,
      valorFaltante: 300,
      valorSobrante: 12,
      porClase: {
        unidad: { items: 2, unidadesFaltantes: 10, unidadesSobrantes: 2, valorFaltante: 41, valorSobrante: 12 },
        paquete: { items: 4, unidadesFaltantes: 48, unidadesSobrantes: 0, valorFaltante: 259, valorSobrante: 0 },
        empresa: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
      },
      // 41 de faltante del cuadro único menos 12 de sobrante: NO los 41 de
      // "Al personal", que es el bruto.
      valorADescontar: 29,
    },
    {
      sucursalId: 2,
      sucursal: 'Market Carhuaz',
      inventarioId: 8060,
      estado: 'en_curso',
      items: 964,
      auditables: 964,
      cuadrados: 957,
      valorFaltante: 49.6,
      valorSobrante: 0,
      porClase: {
        unidad: { items: 1, unidadesFaltantes: 4, unidadesSobrantes: 0, valorFaltante: 30.4, valorSobrante: 0 },
        paquete: { items: 1, unidadesFaltantes: 4, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
        empresa: { items: 1, unidadesFaltantes: 4, unidadesSobrantes: 0, valorFaltante: 19.2, valorSobrante: 0 },
      },
      valorADescontar: 30.4,
    },
    {
      sucursalId: 3,
      sucursal: 'Market Bolívar',
      inventarioId: null,
      estado: null,
      items: 0,
      auditables: 0,
      cuadrados: 0,
      valorFaltante: 0,
      valorSobrante: 0,
      porClase: {
        unidad: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
        paquete: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
        empresa: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
      },
      valorADescontar: 0,
    },
    {
      sucursalId: 4,
      sucursal: 'Market Sucre',
      inventarioId: null,
      estado: null,
      items: 0,
      auditables: 0,
      cuadrados: 0,
      valorFaltante: 0,
      valorSobrante: 0,
      porClase: {
        unidad: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
        paquete: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
        empresa: { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 },
      },
      valorADescontar: 0,
    },
  ],
};

describe('auditoriaApi.cadena', () => {
  it('sin período no manda query: el mes lo resuelve el servidor y lo devuelve', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(CADENA));
    vi.stubGlobal('fetch', fetchMock);

    const r = await auditoriaApi.cadena();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/auditoria/cadena');
    // Sin `?`: adivinar el mes con el reloj del equipo sería pedir un período
    // y mostrar otro sin que nadie se entere.
    expect(url).not.toContain('?');
    expect(r.periodo).toEqual({ anio: 2026, mes: 9 });
  });

  it('con período lo manda en la query', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(CADENA));
    vi.stubGlobal('fetch', fetchMock);

    await auditoriaApi.cadena({ anio: 2026, mes: 8 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('anio=2026');
    expect(url).toContain('mes=8');
  });

  /**
   * LA TIENDA SIN INVENTARIO TIENE QUE LLEGAR CON `null`, NO CON 0.
   *
   * Es la diferencia entre "esta tienda no abrió su inventario del mes" y
   * "esta tienda contó todo y no falta nada". La pantalla decide con
   * `inventarioId` si muestra el guion o la cifra; si el adaptador lo
   * convirtiera en 0 (o lo perdiera), cuatro tiendas sin contar se
   * reportarían como cuadradas.
   */
  it('una tienda sin inventario del período llega con inventarioId y estado en null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(CADENA)));

    const { tiendas } = await auditoriaApi.cadena();

    const bolivar = tiendas.find((t) => t.sucursalId === 3);
    expect(bolivar?.inventarioId).toBeNull();
    expect(bolivar?.estado).toBeNull();
    // Se lista igual: es la cobertura del mes, no un hueco.
    expect(tiendas).toHaveLength(4);
    expect(bolivar?.sucursal).toBe('Market Bolívar');
  });

  /**
   * EL TOTAL NO SE RECALCULA ACÁ. Viene del servidor, que es el único que
   * conoce el umbral congelado de cada inventario -- y cada tienda tiene el
   * suyo. Sumar las columnas de la tabla sería una segunda copia de la regla
   * que decide a quién se le descuenta la plata.
   */
  it('el total llega tal cual, con sus tres cuadros y las dos cuentas de tiendas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(CADENA)));

    const { total } = await auditoriaApi.cadena();

    expect(total.tiendas).toBe(4);
    expect(total.conInventario).toBe(2);
    expect(total.porClase.unidad.valorFaltante).toBe(71.4);
    expect(total.porClase.paquete.valorFaltante).toBe(259);
    expect(total.porClase.empresa.valorFaltante).toBe(19.2);
  });

  /**
   * EL TOTAL A DESCONTAR LLEGA TAL CUAL, y no es el bruto de "Al personal".
   *
   * Es el neto -- faltante del cuadro único menos su sobrante, menos los ajustes
   * del mes -- calculado por el servidor con la misma función que la
   * liquidación. El adaptador no lo recalcula ni lo compara con las columnas de
   * al lado: si lo derivara acá, sería una segunda copia de la regla que decide
   * cuánta plata sale del sueldo.
   */
  it('el total a descontar de cada tienda llega tal cual, distinto del bruto de "Al personal"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(CADENA)));

    const { tiendas, total } = await auditoriaApi.cadena();

    const luzuriaga = tiendas.find((t) => t.sucursalId === 1);
    // 41 de faltante menos 12 de sobrante. El bruto son 41: no es el mismo número.
    expect(luzuriaga?.valorADescontar).toBe(29);
    expect(luzuriaga?.porClase.unidad.valorFaltante).toBe(41);
    // Una tienda sin inventario del período: 0, con el guion que decide `inventarioId`.
    expect(tiendas.find((t) => t.sucursalId === 3)?.valorADescontar).toBe(0);
    expect(total.valorADescontar).toBe(59.4);
  });

  /**
   * UN NETO NEGATIVO SOBREVIVE AL ADAPTADOR. Pasa cuando sobró más de lo que
   * faltó, y es decisión explícita del cliente que se muestre así (*"si sobra,
   * irá a su favor"*). Un `Math.max(0, …)` puesto de buena fe acá escondería la
   * compensación a favor del personal y la tabla dejaría de cerrar contra la
   * planilla.
   */
  it('un total a descontar NEGATIVO pasa sin recortarse a cero', async () => {
    const conSobrante = {
      ...CADENA,
      total: { ...CADENA.total, valorADescontar: -8.5 },
      tiendas: CADENA.tiendas.map((t) => (t.sucursalId === 1 ? { ...t, valorADescontar: -38.5 } : t)),
    };
    vi.stubGlobal('fetch', vi.fn(async () => json(conSobrante)));

    const { tiendas, total } = await auditoriaApi.cadena();

    expect(tiendas.find((t) => t.sucursalId === 1)?.valorADescontar).toBe(-38.5);
    expect(total.valorADescontar).toBe(-8.5);
  });

  it('un fallo del servidor sube como error: la pantalla lo dice, no inventa una cadena vacía', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'No se pudo calcular la cadena.' }, 500)));

    await expect(auditoriaApi.cadena()).rejects.toThrow();
  });
});

/**
 * EL .xlsx DEL DETALLE DE LA CADENA.
 *
 * Lo que estos tests protegen no es que `fetch` funcione: es que el archivo se
 * pida COMO BINARIO y que el nombre salga del servidor.
 *
 * Los bytes nunca pueden pasar por `.text()`/`JSON.parse` -- decodificarlos
 * como UTF-8 y volver a codificarlos los corrompe, y el .xlsx llega roto sin
 * que nada falle: por eso el doble `mock` de abajo TIRA si alguien los toca.
 *
 * Y el nombre importa igual que los bytes: el cliente recibe varios .xlsx el
 * mismo día y los distingue por ahí. Cuando no se manda período, este lado no
 * sabe cuál resolvió el servidor, así que un nombre armado acá tendría que
 * adivinar el mes que el archivo trae adentro (ver el puerto).
 */

/** La firma ZIP con la que arranca cualquier .xlsx de verdad. */
const BYTES_XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;

/**
 * Una respuesta binaria como la manda el servidor. `json`/`text` tiran a
 * propósito: si el adaptador dejara de pedir `binario`, el test rompe acá en
 * vez de devolver un archivo corrupto en silencio.
 */
function xlsx(bytes: ArrayBuffer, contentDisposition: string | null): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (nombre: string) => (nombre === 'Content-Disposition' ? contentDisposition : null) },
    arrayBuffer: async () => bytes,
    json: async () => {
      throw new Error('el .xlsx no se lee como JSON');
    },
    text: async () => {
      throw new Error('el .xlsx no se lee como texto');
    },
  } as unknown as Response;
}

describe('auditoriaApi.exportarDiferenciasCadena', () => {
  it('sin período no manda query: el mes lo resuelve el servidor, igual que en cadena()', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      xlsx(BYTES_XLSX, 'attachment; filename="diferencias-cadena-2026-09.xlsx"'),
    );
    vi.stubGlobal('fetch', fetchMock);

    await auditoriaApi.exportarDiferenciasCadena();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/auditoria/cadena/diferencias/exportar');
    // Sin `?`: un `?` pelado ya es una query. El período lo decide el servidor.
    expect(url).not.toContain('?');
  });

  it('con período lo manda en la query, con los mismos nombres que cadena()', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      xlsx(BYTES_XLSX, 'attachment; filename="diferencias-cadena-2026-09.xlsx"'),
    );
    vi.stubGlobal('fetch', fetchMock);

    await auditoriaApi.exportarDiferenciasCadena({ anio: 2026, mes: 9 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/auditoria/cadena/diferencias/exportar?');
    expect(url).toContain('anio=2026');
    expect(url).toContain('mes=9');
  });

  /**
   * El `Accept` comodín es la huella de `binario: true` en el pedido, y el
   * único lugar donde se puede ver DESDE AFUERA que el cuerpo no se espera
   * JSON. Que `conNombreDeArchivo` esté puesto se ve en que se leyó el
   * `Content-Disposition`: sin esa opción, `pedir` devuelve el ArrayBuffer
   * pelado y nunca toca los headers de la respuesta.
   */
  it('pide binario (Accept comodín) y lee el Content-Disposition', async () => {
    const leidos: string[] = [];
    const respuesta = {
      ok: true,
      status: 200,
      headers: {
        get: (nombre: string) => {
          leidos.push(nombre);
          return nombre === 'Content-Disposition' ? 'attachment; filename="diferencias-cadena-2026-09.xlsx"' : null;
        },
      },
      arrayBuffer: async () => BYTES_XLSX,
    } as unknown as Response;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respuesta);
    vi.stubGlobal('fetch', fetchMock);

    await auditoriaApi.exportarDiferenciasCadena({ anio: 2026, mes: 9 });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Accept).toBe('*/*');
    expect(leidos).toContain('Content-Disposition');
  });

  it('los bytes y el nombre llegan TAL CUAL: ni un byte tocado, ni un nombre rearmado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => xlsx(BYTES_XLSX, "attachment; filename*=UTF-8''diferencias-cadena-2026-09.xlsx")),
    );

    const archivo = await auditoriaApi.exportarDiferenciasCadena({ anio: 2026, mes: 9 });

    expect(new Uint8Array(archivo.bytes)).toEqual(new Uint8Array(BYTES_XLSX));
    expect(archivo.nombreArchivo).toBe('diferencias-cadena-2026-09.xlsx');
  });

  /**
   * SIN el header, `nombreArchivo` es `null` -- no un nombre inventado que
   * parezca del servidor. Quien llama decide con qué guardarlo, y ve que el
   * nombre no vino.
   */
  it('sin Content-Disposition el nombre es null, no uno fabricado acá', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => xlsx(BYTES_XLSX, null)),
    );

    const archivo = await auditoriaApi.exportarDiferenciasCadena();

    expect(archivo.nombreArchivo).toBeNull();
    expect(new Uint8Array(archivo.bytes)).toEqual(new Uint8Array(BYTES_XLSX));
  });

  it('un fallo del servidor sube como error: no baja un .xlsx vacío que diría "no falta nada"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'No se pudo armar el detalle de la cadena.' }, 500)));

    await expect(auditoriaApi.exportarDiferenciasCadena({ anio: 2026, mes: 9 })).rejects.toThrow();
  });
});
