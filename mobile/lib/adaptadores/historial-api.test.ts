/**
 * Tests del adaptador de histórico contra la forma REAL del servidor.
 *
 * Los cuerpos de abajo no son inventados: son la respuesta que devolvió
 * `GET /api/historial/inventarios` y `/:id` contra http://localhost:3000 el
 * 2026-09-04, con la base sembrada (`npm run prisma:seed-historial`).
 * Copiarlos acá los congela como contrato: si el backend cambia la forma,
 * estos tests rompen antes que la pantalla.
 *
 * Lo que se prueba son las DOS traducciones que justifican que exista un
 * adaptador — aplanar el sello a `folio` y normalizar los montos que no
 * vinieron — no que `fetch` funcione.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import { recordarToken } from './_http';
import { historialApi } from './historial-api';

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

/** Un lacrado tal como lo manda el servidor: el sello viene ENTERO en el listado. */
const LACRADO_DTO = {
  id: 8002,
  sucursalId: 1,
  sucursalNombre: 'Market Central Luzuriaga',
  estado: 'lacrado',
  periodo: '2026-07',
  periodoAnio: 2026,
  periodoMes: 7,
  tamanoHoja: 50,
  snapshotItems: 8000,
  abiertoEn: '2026-07-01T13:00:00.000Z',
  cerradoEn: '2026-07-28T18:00:00.000Z',
  abierto: false,
  resultado: {
    itemsTotales: 8000,
    itemsConDiferencia: 168,
    itemsCuadrados: 7832,
    porcentajeCuadrado: 97.9,
    montoFaltanteBruto: 2410,
    montoFaltanteNeto: 1550,
    cuotaBase: 140.91,
  },
  lacrado: {
    folio: 'INV-2026-07-LUZ-8000-844',
    hash: '844f71b9e2fd10930826375a0876b40264baf36e38d2a1299d0dc9f745fdeab1',
    lacradoEn: '2026-07-29T16:00:00.000Z',
    lacradoPor: { id: 103, nombre: 'Gilmer Quispe' },
    registradoEnErp: false,
  },
  aprobaciones: 2,
};

/** Un conteo cerrado: `resultado: null`. Las cifras se calculan al liquidar. */
const SIN_RESULTADO_DTO = {
  ...LACRADO_DTO,
  id: 8004,
  estado: 'conteo_cerrado',
  periodo: '2026-05',
  periodoMes: 5,
  resultado: null,
  lacrado: null,
  aprobaciones: 1,
};

beforeEach(() => {
  recordarToken('token-de-prueba');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('historialApi.listar', () => {
  it('aplana el sello a `folio`: la lista necesita saber SI hay sello, no el hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, inventarios: [LACRADO_DTO] })));

    const { total, inventarios } = await historialApi.listar();

    expect(total).toBe(1);
    expect(inventarios[0].folio).toBe('INV-2026-07-LUZ-8000-844');
    // El hash y el registro ERP NO se arrastran a una pantalla que no los
    // muestra: el puerto expone `folio: string | null` y nada más.
    expect(inventarios[0]).not.toHaveProperty('lacrado');
    expect(inventarios[0]).not.toHaveProperty('hash');
  });

  it('folio null cuando no hay sello — es la señal de "todavía se puede tocar"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, inventarios: [SIN_RESULTADO_DTO] })));

    const { inventarios } = await historialApi.listar();
    expect(inventarios[0].folio).toBeNull();
  });

  it('mapea abiertoEn: el registro tiene que poder decir cuándo se creó, no solo cuándo cerró', async () => {
    // El backend ya lo manda (historial.service.ts#aListadoDto) — hasta acá
    // se perdía en la traducción del adaptador y ninguna pantalla lo veía.
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, inventarios: [LACRADO_DTO] })));

    const { inventarios } = await historialApi.listar();
    expect(inventarios[0].abiertoEn).toBe('2026-07-01T13:00:00.000Z');
  });

  it('aplana lacradoEn/lacradoPor del sello, sin arrastrar el objeto `lacrado` completo', async () => {
    // Misma traducción que `folio`: la lista necesita CUÁNDO y QUIÉN sin el
    // hash ni el registro ERP — eso lo sigue trayendo solo el detalle.
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, inventarios: [LACRADO_DTO] })));

    const { inventarios } = await historialApi.listar();
    expect(inventarios[0].lacradoEn).toBe('2026-07-29T16:00:00.000Z');
    expect(inventarios[0].lacradoPor).toEqual({ id: 103, nombre: 'Gilmer Quispe' });
    expect(inventarios[0]).not.toHaveProperty('lacrado');
    expect(inventarios[0]).not.toHaveProperty('hash');
  });

  it('lacradoEn/lacradoPor en null cuando no hay sello', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, inventarios: [SIN_RESULTADO_DTO] })));

    const { inventarios } = await historialApi.listar();
    expect(inventarios[0].lacradoEn).toBeNull();
    expect(inventarios[0].lacradoPor).toBeNull();
  });

  it('deja `resultado` en null sin inventar ceros', async () => {
    // "Cero de faltante" y "todavía no se calculó" son cosas distintas, y
    // confundirlas en un inventario es grave: diría que el mes cerró sin
    // diferencias cuando en realidad nadie lo liquidó todavía.
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, inventarios: [SIN_RESULTADO_DTO] })));

    const { inventarios } = await historialApi.listar();
    expect(inventarios[0].resultado).toBeNull();
  });

  it('normaliza a null los montos que el servidor OMITE cuando no está liquidado', async () => {
    const sinLiquidar = {
      ...LACRADO_DTO,
      estado: 'conteo_cerrado',
      lacrado: null,
      // El servidor no manda estas dos claves hasta que hay liquidación.
      resultado: {
        itemsTotales: 8000,
        itemsConDiferencia: 210,
        itemsCuadrados: 7790,
        porcentajeCuadrado: 97.4,
        montoFaltanteBruto: 2890,
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, inventarios: [sinLiquidar] })));

    const { inventarios } = await historialApi.listar();
    // Ausente y null son lo mismo (todavía no se calculó); cero NO lo es.
    expect(inventarios[0].resultado?.montoFaltanteNeto).toBeNull();
    expect(inventarios[0].resultado?.cuotaBase).toBeNull();
    expect(inventarios[0].resultado?.montoFaltanteBruto).toBe(2890);
  });

  it('arma la query solo con los filtros presentes', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ total: 0, inventarios: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await historialApi.listar({ sucursalId: 1, estado: 'lacrado' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('sucursalId=1');
    expect(url).toContain('estado=lacrado');
    expect(url).not.toContain('limite=');
    expect(url).not.toContain('undefined');
  });

  it('manda periodoAnio/periodoMes cuando se filtra por período', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ total: 0, inventarios: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await historialApi.listar({ periodoAnio: 2026, periodoMes: 7 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('periodoAnio=2026');
    expect(url).toContain('periodoMes=7');
  });

  it('manda limite y desplazamiento para "cargar más" — la página siguiente, no la primera de nuevo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ total: 0, inventarios: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await historialApi.listar({ limite: 20, desplazamiento: 20 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('limite=20');
    expect(url).toContain('desplazamiento=20');
  });
});

describe('historialApi.detalle', () => {
  it('unifica `sucursal: {id, nombre}` a la forma plana del listado', async () => {
    // El detalle manda un objeto anidado y el listado dos campos planos. Una
    // sola manera de leer la sucursal en toda la app: la del listado.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...LACRADO_DTO,
          sucursal: { id: 1, nombre: 'Market Central Luzuriaga' },
          cerradoPor: { id: 103, nombre: 'Gilmer Quispe' },
          hojas: [],
          diferencias: 6,
          liquidaciones: 11,
          aprobaciones: [
            { aprobadorId: 103, aprobadorNombre: 'Gilmer Quispe', rolAlAprobar: 'auditor', aprobadoEn: '2026-06-29T10:00:00.000Z', nota: null },
            { aprobadorId: 106, aprobadorNombre: 'Rosa Melgarejo', rolAlAprobar: 'auditor', aprobadoEn: '2026-06-29T14:00:00.000Z', nota: 'Revisado.' },
          ],
        }),
      ),
    );

    const d = await historialApi.detalle(8002);

    expect(d.sucursalId).toBe(1);
    expect(d.sucursalNombre).toBe('Market Central Luzuriaga');
    // Las DOS firmas, con el rol congelado al firmar.
    expect(d.aprobaciones).toHaveLength(2);
    expect(d.aprobaciones.map((a) => a.aprobadorId)).toEqual([103, 106]);
    expect(d.aprobaciones[0].rolAlAprobar).toBe('auditor');
    expect(d.lacrado?.folio).toBe('INV-2026-07-LUZ-8000-844');
  });

  it('nunca deja pasar un `aprobaciones` que no sea array — la pantalla hace .map() sobre eso', async () => {
    // El seed de histórico no guarda hojas para los inventarios viejos
    // (verificado: el 8001 devuelve `hojas: []`). La pantalla lo dice, no
    // se cae.
    vi.stubGlobal(
      'fetch',
      // OJO con `aprobaciones`: acá llega como NÚMERO porque el fixture sale
      // del listado. El adaptador tiene que resistirlo — ver Array.isArray
      // en historial-api.ts.
      vi.fn(async () =>
        json({ ...SIN_RESULTADO_DTO, sucursal: { id: 1, nombre: 'Market Central Luzuriaga' }, cerradoPor: null, diferencias: 0, liquidaciones: 0, lacrado: null }),
      ),
    );

    const d = await historialApi.detalle(8004);
    expect(d.hojas).toEqual([]);
    expect(d.aprobaciones).toEqual([]);
    expect(d.lacrado).toBeNull();
  });
});

describe('historialApi.verificarSello', () => {
  it('pega contra /lacrado/verificacion y pasa intacto=true tal cual, sin secciones', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({
        inventarioId: 8002,
        folio: 'INV-2026-07-LUZ-8000-844',
        lacradoEn: '2026-07-29T16:00:00.000Z',
        verificadoEn: '2026-09-05T10:00:00.000Z',
        intacto: true,
        hashGuardado: '844f71b9',
        hashRecalculado: '844f71b9',
        seccionesAlteradas: [],
        versionDistinta: false,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const v = await historialApi.verificarSello(8002);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/historial/inventarios/8002/lacrado/verificacion');
    expect(v.intacto).toBe(true);
    expect(v.seccionesAlteradas).toEqual([]);
    expect(v.hashGuardado).toBe('844f71b9');
    expect(v.hashRecalculado).toBe('844f71b9');
  });

  it('traduce `liquidaciones` (clave técnica) a `planilla` (lo que el cliente reconoce)', async () => {
    // Se liquida ANTES de lacrar: el sello cubre la planilla, y si esa
    // sección cambió la pantalla tiene que decir "planilla", no la clave
    // interna del contenido canónico.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          inventarioId: 8002,
          folio: 'INV-2026-07-LUZ-8000-844',
          lacradoEn: '2026-07-29T16:00:00.000Z',
          verificadoEn: '2026-09-05T10:00:00.000Z',
          intacto: false,
          hashGuardado: 'aaa',
          hashRecalculado: 'bbb',
          seccionesAlteradas: ['resultado', 'diferencias', 'liquidaciones', 'aprobaciones'],
          versionDistinta: false,
        }),
      ),
    );

    const v = await historialApi.verificarSello(8002);

    expect(v.seccionesAlteradas).toEqual(['resultado', 'diferencias', 'planilla', 'aprobaciones']);
  });

  it('agrupa toda clave de metadata desconocida bajo `datosDelInventario`, deduplicada', async () => {
    // Si cambian sucursalId Y periodoMes Y snapshotItems, son 3 claves
    // técnicas pero UNA sola sección que le importa a quien lee: "algo del
    // encabezado del inventario cambió". Listarlas una por una sería ruido.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          inventarioId: 8002,
          folio: 'INV-2026-07-LUZ-8000-844',
          lacradoEn: '2026-07-29T16:00:00.000Z',
          verificadoEn: '2026-09-05T10:00:00.000Z',
          intacto: false,
          hashGuardado: 'aaa',
          hashRecalculado: 'bbb',
          seccionesAlteradas: ['sucursalId', 'periodoMes', 'snapshotItems'],
          versionDistinta: false,
        }),
      ),
    );

    const v = await historialApi.verificarSello(8002);

    expect(v.seccionesAlteradas).toEqual(['datosDelInventario']);
  });

  it('pasa `versionDistinta` sin mezclarlo con las secciones alteradas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          inventarioId: 8002,
          folio: 'INV-2026-07-LUZ-8000-844',
          lacradoEn: '2026-07-29T16:00:00.000Z',
          verificadoEn: '2026-09-05T10:00:00.000Z',
          intacto: true,
          hashGuardado: 'aaa',
          hashRecalculado: 'aaa',
          seccionesAlteradas: [],
          versionDistinta: true,
        }),
      ),
    );

    const v = await historialApi.verificarSello(8002);

    expect(v.intacto).toBe(true);
    expect(v.versionDistinta).toBe(true);
  });
});

/**
 * Forma REAL de GET /inventarios/:id/diferencias -- verificada leyendo
 * historial.service.ts#listarDiferencias (devuelve
 * {total, limite, desplazamiento, diferencias: [...]}, cada fila con
 * codigo/descripcion/stockSistema/conteoFinal/diferencia/tipo/
 * resueltoEnConteo/precioUnitario/montoDiferencia).
 */
describe('historialApi.diferencias', () => {
  it('ordena por VALOR ABSOLUTO de montoDiferencia descendente -- lo que mas plata mueve arriba', async () => {
    // El backend pagina ordenado por UNIDADES (diferencia asc); acá el
    // criterio es otro -- cuanta plata mueve -- así que el adaptador
    // reordena, no confía en el orden que trae la página.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          total: 3,
          limite: 500,
          desplazamiento: 0,
          diferencias: [
            { codigo: 'A1', descripcion: 'Leche', stockSistema: 40, conteoFinal: 38, diferencia: -2, tipo: 'faltante', resueltoEnConteo: 1, precioUnitario: 5, montoDiferencia: -10 },
            { codigo: 'B2', descripcion: 'Aceite', stockSistema: 10, conteoFinal: 4, diferencia: -6, tipo: 'faltante', resueltoEnConteo: 2, precioUnitario: 25, montoDiferencia: -150 },
            { codigo: 'C3', descripcion: 'Fideos', stockSistema: 5, conteoFinal: 8, diferencia: 3, tipo: 'sobrante', resueltoEnConteo: 3, precioUnitario: 4, montoDiferencia: 12 },
          ],
        }),
      ),
    );

    const diferencias = await historialApi.diferencias(8002);

    expect(diferencias.map((d) => d.codigo)).toEqual(['B2', 'C3', 'A1']);
  });

  it('las diferencias SIN precio (montoDiferencia null) van al final, no rompen el orden', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          total: 2,
          limite: 500,
          desplazamiento: 0,
          diferencias: [
            { codigo: 'X1', descripcion: 'Sin precio', stockSistema: 10, conteoFinal: 8, diferencia: -2, tipo: 'faltante', resueltoEnConteo: 1, precioUnitario: null, montoDiferencia: null },
            { codigo: 'Y2', descripcion: 'Con precio', stockSistema: 10, conteoFinal: 8, diferencia: -2, tipo: 'faltante', resueltoEnConteo: 1, precioUnitario: 3, montoDiferencia: -6 },
          ],
        }),
      ),
    );

    const diferencias = await historialApi.diferencias(8002);

    expect(diferencias.map((d) => d.codigo)).toEqual(['Y2', 'X1']);
    expect(diferencias[1].montoDiferencia).toBeNull();
  });

  it('pide el maximo del backend (limite=500) y pega contra la ruta correcta', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ total: 0, limite: 500, desplazamiento: 0, diferencias: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await historialApi.diferencias(8002);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/historial/inventarios/8002/diferencias');
    expect(url).toContain('limite=500');
  });
});

/**
 * Forma REAL de GET /inventarios/:id/liquidacion -- verificada leyendo
 * historial.service.ts#obtenerLiquidacion.
 */
describe('historialApi.liquidacion', () => {
  const LIQUIDACION_DTO = {
    inventarioId: 8002,
    sucursal: { id: 1, nombre: 'Market Central Luzuriaga' },
    periodo: '2026-07',
    resumen: {
      montoFaltanteNeto: 1550,
      cuotaBase: 140.91,
      faltantes: 1,
      fondoMultas: 20,
      bonoAsistencia: 2,
      residuoCentavos: 0.01,
    },
    asistenciaSinRegistrar: false,
    ajustesSinRegistrar: false,
    planilla: [
      {
        colaboradorId: 30,
        nombre: 'Elena Príncipe',
        nombreActual: 'Elena Príncipe',
        dni: '12345678',
        rol: 'conteo',
        asistio: true,
        cuotaBase: 140.91,
        multaInasistencia: 0,
        bonoAsistencia: 2,
        totalDescuento: 138.91,
      },
      {
        colaboradorId: 31,
        nombre: 'Julio Rivas',
        nombreActual: 'Julio Rivas',
        dni: '87654321',
        rol: 'conteo',
        asistio: false,
        cuotaBase: 140.91,
        multaInasistencia: 20,
        bonoAsistencia: 0,
        totalDescuento: 160.91,
      },
    ],
  };

  it('mapea el resumen y la planilla tal cual, con el total ya calculado por el backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(LIQUIDACION_DTO)));

    const liq = await historialApi.liquidacion(8002);

    expect(liq.resumen?.cuotaBase).toBe(140.91);
    expect(liq.planilla).toHaveLength(2);
    expect(liq.planilla[1].asistio).toBe(false);
    expect(liq.planilla[1].totalDescuento).toBe(160.91);
  });

  it('resumen null cuando falta asistencia o ajustes -- no inventa un resumen con ceros', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ...LIQUIDACION_DTO, resumen: null, asistenciaSinRegistrar: true, planilla: [] })),
    );

    const liq = await historialApi.liquidacion(8002);

    expect(liq.resumen).toBeNull();
    expect(liq.asistenciaSinRegistrar).toBe(true);
  });
});
