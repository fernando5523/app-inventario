/**
 * EL LOTE POR ENCIMA DE LA CORRECCIÓN DE A UNO.
 *
 * Lo que estos tests protegen:
 *  - TODO lo que se escribe pasa por `hojas.service.ts#corregirConteo`: no hay
 *    una segunda vía que aplique la regla por su cuenta;
 *  - la vista previa NUNCA escribe;
 *  - un inventario que no admite corrección rechaza SUS filas con el mensaje
 *    del servidor, y las filas de las otras tiendas se aplican igual -- nunca
 *    un rechazo global sin detalle;
 *  - un producto sin conteo previo, un código que no está en esa ronda y un
 *    archivo que quedó viejo se informan uno por uno;
 *  - una fila que falla al escribir no corta el lote.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findMany: vi.fn() },
  producto: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

const corregirConteoMock = vi.hoisted(() => vi.fn());
vi.mock('../hojas/hojas.service', () => ({ corregirConteo: corregirConteoMock }));

const leerCorreccionesMock = vi.hoisted(() => vi.fn());
vi.mock('./correcciones.formato', async (original) => ({
  ...(await original<typeof import('./correcciones.formato')>()),
  leerCorrecciones: leerCorreccionesMock,
}));

import { Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { confirmarCorrecciones, previsualizarCorrecciones } from './correcciones.service';

/**
 * `lista[0]` con el chequeo que exige `noUncheckedIndexedAccess`: si la lista
 * vino vacía, el test falla ACÁ -- diciendo que no había ninguna fila -- en vez
 * de dos líneas después con un "cannot read properties of undefined".
 */
function primera<T>(filas: readonly T[]): T {
  expect(filas.length).toBeGreaterThan(0);
  return filas[0] as T;
}

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 4, rol: 'coordinador' };
const CONTADOR: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 4, rol: 'conteo' };
const ARCHIVO = Buffer.from('xlsx falso');

/** Una fila ya leída del archivo, lista para resolverse contra la base. */
const filaLeida = (p: Partial<Record<string, unknown>> = {}) => ({
  fila: 2,
  inventarioId: 8090,
  ronda: 1,
  codigo: '0051',
  contado: 10,
  nuevoValor: 12,
  motivo: 'Se contó mal la caja',
  tienda: null,
  ...p,
});

function mockLectura(p: Partial<{ aCorregir: unknown[]; sinCambio: unknown[]; rechazadas: unknown[] }> = {}): void {
  leerCorreccionesMock.mockResolvedValue({
    ok: true,
    aCorregir: p.aCorregir ?? [filaLeida()],
    sinCambio: p.sinCambio ?? [],
    rechazadas: p.rechazadas ?? [],
  });
}

function mockInventarios(filas: Array<Record<string, unknown>> = []): void {
  prismaMock.inventario.findMany.mockResolvedValue(
    filas.length > 0
      ? filas
      : [{ id: 8090, sucursalId: 4, estado: 'en_curso', periodoAnio: 2026, periodoMes: 9, sucursal: { nombre: 'Market Sucre' } }],
  );
}

/** Un producto con conteo cargado: 10 unidades sueltas. */
function mockProductos(filas?: Array<Record<string, unknown>>): void {
  prismaMock.producto.findMany.mockResolvedValue(
    filas ?? [
      {
        id: 501,
        codigo: '0051',
        hojaId: 77,
        hoja: { numeroConteo: 1, numero: '001' },
        empaques: [],
        conteos: [{ sueltas: 10, empaques: [] }],
      },
    ],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLectura();
  mockInventarios();
  mockProductos();
  corregirConteoMock.mockResolvedValue({ total: 12, totalAnterior: 10, salioDeLaRonda: null });
});

describe('quién puede usar el lote', () => {
  it('el rol conteo no, y el mensaje dice de quién es', async () => {
    await expect(previsualizarCorrecciones(CONTADOR, ARCHIVO)).rejects.toThrow(Prohibido);
    await expect(previsualizarCorrecciones(CONTADOR, ARCHIVO)).rejects.toThrow(/Coordinador|Auditor/);
  });

  it('el auditor sí', async () => {
    await expect(previsualizarCorrecciones(AUDITOR, ARCHIVO)).resolves.toBeDefined();
  });
});

describe('la vista previa', () => {
  it('NUNCA escribe: no llama a corregirConteo', async () => {
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(corregirConteoMock).not.toHaveBeenCalled();
    expect(vista.resumen.aCorregir).toBe(1);
  });

  it('resuelve la fila contra la base y dice a qué hoja y producto apunta', async () => {
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(primera(vista.aCorregir)).toMatchObject({
      fila: 2,
      inventarioId: 8090,
      sucursal: 'Market Sucre',
      ronda: 1,
      hoja: '001',
      codigo: '0051',
      hojaId: 77,
      productoId: 501,
      contadoActual: 10,
      nuevoValor: 12,
    });
  });

  /** Un archivo que ni se pudo leer es 400, no una lista vacía. */
  it('un archivo ilegible rechaza con 400 y su detalle', async () => {
    leerCorreccionesMock.mockResolvedValue({ ok: false, motivo: 'columna-faltante', detalle: 'Faltan estas columnas: Ronda.' });
    await expect(previsualizarCorrecciones(AUDITOR, ARCHIVO)).rejects.toThrow(SolicitudInvalida);
    await expect(previsualizarCorrecciones(AUDITOR, ARCHIVO)).rejects.toThrow(/Faltan estas columnas/);
  });

  it('el resumen cuenta las tres listas, y las advertencias aparte', async () => {
    mockLectura({
      sinCambio: [
        { fila: 3, inventarioId: 8090, ronda: 1, codigo: '0052', contado: 5, advertencias: ['motivo-sin-cambio'] },
        { fila: 4, inventarioId: 8090, ronda: 1, codigo: '0053', contado: 7, advertencias: [] },
      ],
    });
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(vista.resumen).toEqual({ aCorregir: 1, sinCambio: 2, rechazadas: 0, conAdvertencia: 1 });
  });
});

describe('las filas que no se pueden corregir', () => {
  /**
   * El caso real del período: Luzuriaga está en `ajuste_auditor` y Sucre
   * `en_curso`. Las filas de Luzuriaga se rechazan UNA POR UNA y las de Sucre
   * se aplican -- nunca un 409 que tire el archivo entero.
   */
  it('un inventario en ajuste final rechaza SUS filas y las otras tiendas siguen', async () => {
    mockLectura({ aCorregir: [filaLeida(), filaLeida({ fila: 3, inventarioId: 8078, codigo: '0099' })] });
    mockInventarios([
      { id: 8090, sucursalId: 4, estado: 'en_curso', periodoAnio: 2026, periodoMes: 9, sucursal: { nombre: 'Market Sucre' } },
      { id: 8078, sucursalId: 1, estado: 'ajuste_auditor', periodoAnio: 2026, periodoMes: 9, sucursal: { nombre: 'Market Luzuriaga' } },
    ]);
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(vista.aCorregir).toHaveLength(1);
    expect(primera(vista.aCorregir).inventarioId).toBe(8090);
    expect(vista.rechazadas).toHaveLength(1);
    expect(primera(vista.rechazadas)).toMatchObject({ fila: 3, motivo: 'inventario-no-corrige' });
    // El mensaje del servidor TAL CUAL, con la tienda adelante para ubicarla.
    expect(primera(vista.rechazadas).detalle).toContain('Market Luzuriaga');
    expect(primera(vista.rechazadas).detalle).toContain('ajuste final');
  });

  it('un inventario de otra sucursal, para el coordinador, es sin-permiso', async () => {
    mockInventarios([
      { id: 8090, sucursalId: 99, estado: 'en_curso', periodoAnio: 2026, periodoMes: 9, sucursal: { nombre: 'Market Otra' } },
    ]);
    const vista = await previsualizarCorrecciones(COORDINADOR, ARCHIVO);
    expect(primera(vista.rechazadas).motivo).toBe('sin-permiso');
  });

  it('un inventario que no existe se dice, no se ignora', async () => {
    prismaMock.inventario.findMany.mockResolvedValue([]);
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(primera(vista.rechazadas)).toMatchObject({ motivo: 'inventario-inexistente' });
  });

  /** La misma regla que corta la corrección de a uno: sin conteo previo no es corregir. */
  it('un producto sin conteo previo se rechaza con esa razón', async () => {
    mockProductos([{ id: 501, codigo: '0051', hojaId: 77, hoja: { numeroConteo: 1, numero: '001' }, empaques: [], conteos: [] }]);
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(primera(vista.rechazadas)).toMatchObject({ motivo: 'sin-conteo-previo' });
    expect(primera(vista.rechazadas).detalle).toContain('góndola');
  });

  it('un código que no está en esa ronda se rechaza nombrando la ronda', async () => {
    mockProductos([]);
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(primera(vista.rechazadas)).toMatchObject({ motivo: 'producto-inexistente' });
    expect(primera(vista.rechazadas).detalle).toContain('ronda 1');
  });

  /**
   * EL ARCHIVO QUEDÓ VIEJO: alguien corrigió ese conteo entre exportar e
   * importar. Aplicarlo pisaría su trabajo sin que se entere.
   */
  it('rechaza la fila cuando el valor de la base ya no es el del archivo', async () => {
    mockProductos([
      { id: 501, codigo: '0051', hojaId: 77, hoja: { numeroConteo: 1, numero: '001' }, empaques: [], conteos: [{ sueltas: 11, empaques: [] }] },
    ]);
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(primera(vista.rechazadas)).toMatchObject({ motivo: 'valor-desactualizado' });
    // Los dos números a la vista para poder decidir.
    expect(primera(vista.rechazadas).detalle).toContain('10');
    expect(primera(vista.rechazadas).detalle).toContain('11');
    expect(corregirConteoMock).not.toHaveBeenCalled();
  });

  /** El id manda y el nombre se verifica: si no concuerdan, no se adivina. */
  it('rechaza la fila si el nombre de la tienda no concuerda con el inventario', async () => {
    mockLectura({ aCorregir: [filaLeida({ tienda: 'Market Carhuaz' })] });
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(primera(vista.rechazadas)).toMatchObject({ motivo: 'tienda-no-coincide' });
  });

  it('el mismo código en dos hojas de la misma ronda es ambiguo, no se elige una', async () => {
    mockProductos([
      { id: 501, codigo: '0051', hojaId: 77, hoja: { numeroConteo: 1, numero: '001' }, empaques: [], conteos: [{ sueltas: 10, empaques: [] }] },
      { id: 502, codigo: '0051', hojaId: 78, hoja: { numeroConteo: 1, numero: '002' }, empaques: [], conteos: [{ sueltas: 10, empaques: [] }] },
    ]);
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(primera(vista.rechazadas)).toMatchObject({ motivo: 'producto-ambiguo' });
  });
});

describe('confirmar', () => {
  /** LA REGLA QUE NO SE DUPLICA: todo lo que se escribe entra por `corregirConteo`. */
  it('aplica cada fila por corregirConteo, con el valor en unidades y el motivo', async () => {
    const dto = await confirmarCorrecciones(AUDITOR, ARCHIVO, 'conteos.xlsx');
    expect(corregirConteoMock).toHaveBeenCalledTimes(1);
    expect(corregirConteoMock).toHaveBeenCalledWith(AUDITOR, 77, 501, {
      empaques: [],
      sueltas: 12,
      motivo: 'Se contó mal la caja',
    });
    expect(primera(dto.aplicadas)).toMatchObject({ fila: 2, codigo: '0051', valorAnterior: 10, valorNuevo: 12 });
    expect(dto.resumen.aplicadas).toBe(1);
  });

  it('informa cuando la corrección sacó el ítem de la ronda siguiente', async () => {
    corregirConteoMock.mockResolvedValue({ total: 12, totalAnterior: 10, salioDeLaRonda: { ronda: 2, hoja: '003' } });
    const dto = await confirmarCorrecciones(AUDITOR, ARCHIVO, 'conteos.xlsx');
    expect(primera(dto.aplicadas).salioDeLaRondaSiguiente).toBe(true);
  });

  /**
   * UNA FILA QUE FALLA NO CORTA EL LOTE: cortar dejaría el resto sin aplicar y
   * sin explicar, que es lo contrario de lo que se pidió.
   */
  it('una fila que falla al escribir se reporta y el resto se aplica', async () => {
    mockLectura({ aCorregir: [filaLeida(), filaLeida({ fila: 3, codigo: '0052' })] });
    mockProductos([
      { id: 501, codigo: '0051', hojaId: 77, hoja: { numeroConteo: 1, numero: '001' }, empaques: [], conteos: [{ sueltas: 10, empaques: [] }] },
      { id: 502, codigo: '0052', hojaId: 77, hoja: { numeroConteo: 1, numero: '001' }, empaques: [], conteos: [{ sueltas: 10, empaques: [] }] },
    ]);
    corregirConteoMock
      .mockRejectedValueOnce(new Error('El ajuste final de este inventario ya esta iniciado.'))
      .mockResolvedValueOnce({ total: 12, totalAnterior: 10, salioDeLaRonda: null });

    const dto = await confirmarCorrecciones(AUDITOR, ARCHIVO, 'conteos.xlsx');
    expect(dto.resumen.aplicadas).toBe(1);
    expect(dto.resumen.fallidas).toBe(1);
    expect(primera(dto.rechazadas)).toMatchObject({ fila: 2, motivo: 'fallo-al-aplicar' });
    // El mensaje del servidor, tal cual.
    expect(primera(dto.rechazadas).detalle).toContain('ajuste final');
  });

  it('las filas sin cambio no se escriben, y se siguen informando', async () => {
    mockLectura({
      aCorregir: [],
      sinCambio: [{ fila: 2, inventarioId: 8090, ronda: 1, codigo: '0051', contado: 10, advertencias: [] }],
    });
    const dto = await confirmarCorrecciones(AUDITOR, ARCHIVO, 'conteos.xlsx');
    expect(corregirConteoMock).not.toHaveBeenCalled();
    expect(dto.sinCambio).toHaveLength(1);
    expect(dto.resumen.aplicadas).toBe(0);
  });

  /** Las listas van ordenadas por fila del Excel: así se siguen con el archivo al lado. */
  it('devuelve todo ordenado por número de fila', async () => {
    mockLectura({
      aCorregir: [filaLeida({ fila: 5, codigo: '0052' }), filaLeida({ fila: 2 })],
      rechazadas: [{ fila: 9, motivo: 'motivo-faltante', detalle: 'x', codigo: '0053', inventarioId: 8090, ronda: 1 }],
    });
    mockProductos([
      { id: 501, codigo: '0051', hojaId: 77, hoja: { numeroConteo: 1, numero: '001' }, empaques: [], conteos: [{ sueltas: 10, empaques: [] }] },
      { id: 502, codigo: '0052', hojaId: 77, hoja: { numeroConteo: 1, numero: '001' }, empaques: [], conteos: [{ sueltas: 10, empaques: [] }] },
    ]);
    const vista = await previsualizarCorrecciones(AUDITOR, ARCHIVO);
    expect(vista.aCorregir.map((f) => f.fila)).toEqual([2, 5]);
  });
});
