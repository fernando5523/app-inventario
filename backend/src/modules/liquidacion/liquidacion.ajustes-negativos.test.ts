/**
 * CABLEAR EL EXCEL DE AJUSTES A LA BASE: reemplaza el monto de negativos que
 * se tipeaba a mano (liquidacion.ajustes.ts) por la importación del Excel de
 * Dynamics que ya sabe leer `liquidacion.ajustes-dynamics.ts`.
 *
 * Lo que estos tests protegen:
 *  - preview NUNCA persiste nada, confirmar SIEMPRE lo hace (si el archivo es válido).
 *  - un archivo inválido (columna faltante, no es un .xlsx) rechaza con 400,
 *    sin tocar la base -- no es lo mismo que "0 líneas útiles".
 *  - un archivo válido con 0 líneas útiles deja `montoNegativos: 0` EXPLÍCITO.
 *  - reimportar dejar la importación anterior en vigente:null, NO la borra.
 *  - montoNegativos siempre es la suma de las líneas NO excluidas.
 *  - excluir/incluir una línea recalcula el monto y queda firmado (quién, cuándo, motivo).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  resultadoInventario: { update: vi.fn() },
  importacionAjustesDynamics: { updateMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  lineaAjusteDynamics: { createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

const leerAjustesDynamicsMock = vi.hoisted(() => vi.fn());
vi.mock('./liquidacion.ajustes-dynamics', () => ({ leerAjustesDynamics: leerAjustesDynamicsMock }));

import { Conflicto, NoEncontrado, Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  confirmarAjustesNegativos,
  excluirLineaAjusteNegativo,
  incluirLineaAjusteNegativo,
  listarLineasAjusteNegativo,
  previsualizarAjustesNegativos,
} from './liquidacion.ajustes-negativos';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: 1, rol: 'coordinador' };

const decimal = (v: number) => ({ toNumber: () => v });
const ARCHIVO = Buffer.from('contenido falso del excel');

function mockInventario(parcial: Record<string, unknown> = {}): void {
  prismaMock.inventario.findUnique.mockResolvedValue({
    id: 9,
    estado: 'conteo_cerrado',
    periodoAnio: 2026,
    periodoMes: 8,
    resultado: { id: 3 },
    sucursal: { almacenId: 'MD01_LUZ' },
    ...parcial,
  });
}

const LINEA_VALIDA = {
  fila: 2,
  diario: 'D001',
  descripcion: 'Ajuste',
  almacen: 'MD01_LUZ',
  codigo: '101131',
  nombre2: 'Yogurt fresa',
  cantidad: 3,
  precio: 10,
  importe: 30,
  motivoAjuste: 'Sobrante único por unidad',
  registradoEn: new Date('2026-08-15T00:00:00.000Z'),
  responsable: 'Empleado',
  advertencias: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInventario();
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prismaMock) : arg,
  );
});

describe('previsualizarAjustesNegativos: NUNCA persiste', () => {
  it('el coordinador no accede, ni se toca la base', async () => {
    await expect(previsualizarAjustesNegativos(COORDINADOR, 9, ARCHIVO)).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.findUnique).not.toHaveBeenCalled();
  });

  it('el inventario que no existe es 404', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(previsualizarAjustesNegativos(AUDITOR, 9, ARCHIVO)).rejects.toThrow(NoEncontrado);
  });

  it.each([
    ['en_curso', /conteo sigue abierto/],
    ['liquidado', /ya se cerró/],
    ['lacrado', /ya se cerró/],
  ])('con el inventario en %s, rechaza', async (estado, mensaje) => {
    mockInventario({ estado });
    await expect(previsualizarAjustesNegativos(AUDITOR, 9, ARCHIVO)).rejects.toThrow(mensaje);
  });

  it('sin resultado calculado, rechaza', async () => {
    mockInventario({ resultado: null });
    await expect(previsualizarAjustesNegativos(AUDITOR, 9, ARCHIVO)).rejects.toThrow(/no tiene resultado/);
  });

  it('sucursal sin almacén configurado, rechaza sin poder validar de qué tienda son las líneas', async () => {
    mockInventario({ sucursal: { almacenId: null } });
    await expect(previsualizarAjustesNegativos(AUDITOR, 9, ARCHIVO)).rejects.toThrow(Conflicto);
  });

  it('llama al lector con el almacén y el período de ESE inventario', async () => {
    leerAjustesDynamicsMock.mockResolvedValue({ ok: true, validas: [], rechazadas: [], totalImporte: 0 });
    await previsualizarAjustesNegativos(AUDITOR, 9, ARCHIVO);

    expect(leerAjustesDynamicsMock).toHaveBeenCalledWith(ARCHIVO, {
      almacenEsperado: 'MD01_LUZ',
      periodoAnio: 2026,
      periodoMes: 8,
    });
  });

  it('devuelve el resultado del lector tal cual, sin escribir nada', async () => {
    const resultado = { ok: true as const, validas: [LINEA_VALIDA], rechazadas: [], totalImporte: 30 };
    leerAjustesDynamicsMock.mockResolvedValue(resultado);

    await expect(previsualizarAjustesNegativos(AUDITOR, 9, ARCHIVO)).resolves.toEqual(resultado);
    expect(prismaMock.importacionAjustesDynamics.create).not.toHaveBeenCalled();
    expect(prismaMock.lineaAjusteDynamics.createMany).not.toHaveBeenCalled();
    expect(prismaMock.resultadoInventario.update).not.toHaveBeenCalled();
  });

  it('un archivo inválido también se devuelve tal cual (ok:false), no explota', async () => {
    const resultado = { ok: false as const, motivo: 'columna-faltante' as const, detalle: 'Faltan columnas.' };
    leerAjustesDynamicsMock.mockResolvedValue(resultado);

    await expect(previsualizarAjustesNegativos(AUDITOR, 9, ARCHIVO)).resolves.toEqual(resultado);
  });
});

describe('confirmarAjustesNegativos: acá sí persiste', () => {
  it('el coordinador no accede', async () => {
    await expect(confirmarAjustesNegativos(COORDINADOR, 9, ARCHIVO, 'ajustes.xlsx')).rejects.toThrow(Prohibido);
  });

  it('con el inventario en curso, rechaza antes de leer el archivo', async () => {
    mockInventario({ estado: 'en_curso' });
    await expect(confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes.xlsx')).rejects.toThrow(Conflicto);
    expect(leerAjustesDynamicsMock).not.toHaveBeenCalled();
  });

  it('archivo inválido (ok:false): 400 con el detalle del lector, nada se persiste', async () => {
    leerAjustesDynamicsMock.mockResolvedValue({
      ok: false,
      motivo: 'columna-faltante',
      detalle: 'Faltan estas columnas: Importe.',
    });

    await expect(confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes.xlsx')).rejects.toThrow(SolicitudInvalida);
    await expect(confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes.xlsx')).rejects.toThrow(
      /Faltan estas columnas/,
    );
    expect(prismaMock.importacionAjustesDynamics.create).not.toHaveBeenCalled();
    expect(prismaMock.resultadoInventario.update).not.toHaveBeenCalled();
  });

  describe('archivo válido', () => {
    beforeEach(() => {
      prismaMock.importacionAjustesDynamics.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.importacionAjustesDynamics.create.mockResolvedValue({ id: 42, inventarioId: 9 });
      prismaMock.lineaAjusteDynamics.createMany.mockResolvedValue({ count: 1 });
      prismaMock.resultadoInventario.update.mockResolvedValue({ montoNegativos: decimal(30) });
    });

    it('la importación anterior vigente pasa a vigente:null ANTES de crear la nueva', async () => {
      leerAjustesDynamicsMock.mockResolvedValue({ ok: true, validas: [LINEA_VALIDA], rechazadas: [], totalImporte: 30 });

      await confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes-agosto.xlsx');

      expect(prismaMock.importacionAjustesDynamics.updateMany).toHaveBeenCalledWith({
        where: { inventarioId: 9, vigente: true },
        data: { vigente: null },
      });
      const ordenUpdateMany = prismaMock.importacionAjustesDynamics.updateMany.mock.invocationCallOrder[0]!;
      const ordenCreate = prismaMock.importacionAjustesDynamics.create.mock.invocationCallOrder[0]!;
      expect(ordenUpdateMany).toBeLessThan(ordenCreate);
    });

    it('crea la importación con quién y el nombre del archivo', async () => {
      leerAjustesDynamicsMock.mockResolvedValue({ ok: true, validas: [LINEA_VALIDA], rechazadas: [], totalImporte: 30 });

      await confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes-agosto.xlsx');

      expect(prismaMock.importacionAjustesDynamics.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inventarioId: 9,
            nombreArchivo: 'ajustes-agosto.xlsx',
            importadoPorId: 5,
            vigente: true,
          }),
        }),
      );
    });

    it('persiste SOLO las líneas válidas, nunca las rechazadas', async () => {
      leerAjustesDynamicsMock.mockResolvedValue({
        ok: true,
        validas: [LINEA_VALIDA],
        rechazadas: [{ fila: 5, motivo: 'otra-tienda', crudo: {} }],
        totalImporte: 30,
      });

      await confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes.xlsx');

      expect(prismaMock.lineaAjusteDynamics.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            importacionId: 42,
            fila: 2,
            codigo: '101131',
            importe: 30,
          }),
        ],
      });
    });

    it('0 líneas útiles: NO llama a createMany, pero SÍ deja montoNegativos en 0 explícito', async () => {
      leerAjustesDynamicsMock.mockResolvedValue({ ok: true, validas: [], rechazadas: [], totalImporte: 0 });
      prismaMock.resultadoInventario.update.mockResolvedValue({ montoNegativos: decimal(0) });

      const dto = await confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes-vacio.xlsx');

      expect(prismaMock.lineaAjusteDynamics.createMany).not.toHaveBeenCalled();
      expect(prismaMock.resultadoInventario.update).toHaveBeenCalledWith({
        where: { inventarioId: 9 },
        data: { montoNegativos: 0 },
      });
      expect(dto.montoNegativos).toBe(0);
    });

    it('montoNegativos escrito es la SUMA de importe de las válidas (totalImporte del lector)', async () => {
      leerAjustesDynamicsMock.mockResolvedValue({
        ok: true,
        validas: [LINEA_VALIDA, { ...LINEA_VALIDA, fila: 3, importe: 15 }],
        rechazadas: [],
        totalImporte: 45,
      });
      prismaMock.resultadoInventario.update.mockResolvedValue({ montoNegativos: decimal(45) });

      const dto = await confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes.xlsx');

      expect(prismaMock.resultadoInventario.update).toHaveBeenCalledWith({
        where: { inventarioId: 9 },
        data: { montoNegativos: 45 },
      });
      expect(dto.montoNegativos).toBe(45);
    });

    it('queda en el registro de auditoría', async () => {
      leerAjustesDynamicsMock.mockResolvedValue({ ok: true, validas: [LINEA_VALIDA], rechazadas: [], totalImporte: 30 });

      await confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes.xlsx');

      const { registrarAuditoria } = await import('../../shared/auditoria');
      expect(registrarAuditoria).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 5,
          accion: 'inventario.ajustes_negativos_importados',
          entidadId: 9,
          detalle: expect.objectContaining({ nombreArchivo: 'ajustes.xlsx', montoNegativos: 30 }),
        }),
      );
    });

    it('todo va en la MISMA transacción: si falla, no queda nada a medias', async () => {
      leerAjustesDynamicsMock.mockResolvedValue({ ok: true, validas: [LINEA_VALIDA], rechazadas: [], totalImporte: 30 });
      prismaMock.$transaction.mockRejectedValue(new Error('conexión caída'));

      await expect(confirmarAjustesNegativos(AUDITOR, 9, ARCHIVO, 'ajustes.xlsx')).rejects.toThrow('conexión caída');
      const { registrarAuditoria } = await import('../../shared/auditoria');
      expect(registrarAuditoria).not.toHaveBeenCalled();
    });
  });
});

describe('excluirLineaAjusteNegativo / incluirLineaAjusteNegativo', () => {
  const IMPORTACION_VIGENTE = { id: 42, inventarioId: 9, vigente: true };
  const LINEA_DB = {
    id: 100,
    importacionId: 42,
    fila: 2,
    codigo: '101131',
    descripcion: 'Ajuste',
    importe: decimal(30),
    excluida: false,
    motivoExclusion: null,
    excluidaEn: null,
    excluidaPor: null,
    importacion: IMPORTACION_VIGENTE,
  };

  beforeEach(() => {
    prismaMock.lineaAjusteDynamics.findUnique.mockResolvedValue(LINEA_DB);
    prismaMock.lineaAjusteDynamics.update.mockResolvedValue({
      ...LINEA_DB,
      excluida: true,
      motivoExclusion: 'El área de negativos puso mal el motivo.',
      excluidaEn: new Date('2026-09-11T10:00:00.000Z'),
      excluidaPor: { id: 5, nombre: 'Gilmer' },
    });
    prismaMock.lineaAjusteDynamics.aggregate.mockResolvedValue({ _sum: { importe: decimal(0) } });
    prismaMock.resultadoInventario.update.mockResolvedValue({ montoNegativos: decimal(0) });
  });

  it('excluir: el coordinador no accede', async () => {
    await expect(
      excluirLineaAjusteNegativo(COORDINADOR, 9, 100, 'motivo'),
    ).rejects.toThrow(Prohibido);
  });

  it('excluir: línea inexistente es 404', async () => {
    prismaMock.lineaAjusteDynamics.findUnique.mockResolvedValue(null);
    await expect(excluirLineaAjusteNegativo(AUDITOR, 9, 100, 'motivo')).rejects.toThrow(NoEncontrado);
  });

  it('excluir: línea de OTRO inventario es 404, no se confunde con la de este', async () => {
    prismaMock.lineaAjusteDynamics.findUnique.mockResolvedValue({
      ...LINEA_DB,
      importacion: { ...IMPORTACION_VIGENTE, inventarioId: 123 },
    });
    await expect(excluirLineaAjusteNegativo(AUDITOR, 9, 100, 'motivo')).rejects.toThrow(NoEncontrado);
  });

  it('excluir: línea de una importación reemplazada (no vigente) rechaza', async () => {
    prismaMock.lineaAjusteDynamics.findUnique.mockResolvedValue({
      ...LINEA_DB,
      importacion: { ...IMPORTACION_VIGENTE, vigente: null },
    });
    await expect(excluirLineaAjusteNegativo(AUDITOR, 9, 100, 'motivo')).rejects.toThrow(Conflicto);
  });

  /**
   * VERIFICACIÓN (2026-09-14, pedido del cliente): no se puede tocar la
   * plata de un inventario ya cerrado. Ya lo bloqueaba `inventarioParaImportar`
   * -> `validarEstadoParaAjustar` (liquidacion.ajustes.ts), la misma puerta
   * que preview/confirmar -- este test lo deja PROBADO explícitamente para
   * excluir/incluir, no solo inferido de la cadena de llamadas.
   */
  it.each([
    ['liquidado', excluirLineaAjusteNegativo] as const,
    ['lacrado', excluirLineaAjusteNegativo] as const,
    ['liquidado', incluirLineaAjusteNegativo] as const,
    ['lacrado', incluirLineaAjusteNegativo] as const,
  ])('%s: BLOQUEADO -- no se toca la plata de un inventario ya cerrado', async (estado, accion) => {
    mockInventario({ estado });
    await expect(accion(AUDITOR, 9, 100, 'motivo')).rejects.toThrow(/ya se cerró/);
    expect(prismaMock.lineaAjusteDynamics.update).not.toHaveBeenCalled();
    expect(prismaMock.resultadoInventario.update).not.toHaveBeenCalled();
  });

  it('excluir: marca excluida con quién, cuándo y el motivo, los cuatro juntos', async () => {
    await excluirLineaAjusteNegativo(AUDITOR, 9, 100, 'El área de negativos puso mal el motivo.');

    expect(prismaMock.lineaAjusteDynamics.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 100 },
        data: expect.objectContaining({
          excluida: true,
          excluidaPorId: 5,
          excluidaEn: expect.any(Date),
          motivoExclusion: 'El área de negativos puso mal el motivo.',
        }),
      }),
    );
  });

  it('excluir: recalcula montoNegativos como suma de las NO excluidas de esa importación', async () => {
    prismaMock.lineaAjusteDynamics.aggregate.mockResolvedValue({ _sum: { importe: decimal(15) } });
    prismaMock.resultadoInventario.update.mockResolvedValue({ montoNegativos: decimal(15) });

    const { montoNegativos } = await excluirLineaAjusteNegativo(AUDITOR, 9, 100, 'motivo');

    expect(prismaMock.lineaAjusteDynamics.aggregate).toHaveBeenCalledWith({
      where: { importacionId: 42, excluida: false },
      _sum: { importe: true },
    });
    expect(prismaMock.resultadoInventario.update).toHaveBeenCalledWith({
      where: { inventarioId: 9 },
      data: { montoNegativos: 15 },
    });
    expect(montoNegativos).toBe(15);
  });

  it('excluir: sin líneas restantes, el monto queda en 0 explícito (no null)', async () => {
    prismaMock.lineaAjusteDynamics.aggregate.mockResolvedValue({ _sum: { importe: null } });
    prismaMock.resultadoInventario.update.mockResolvedValue({ montoNegativos: decimal(0) });

    const { montoNegativos } = await excluirLineaAjusteNegativo(AUDITOR, 9, 100, 'motivo');
    expect(montoNegativos).toBe(0);
  });

  it('excluir: queda en el registro de auditoría con el motivo', async () => {
    await excluirLineaAjusteNegativo(AUDITOR, 9, 100, 'El área de negativos puso mal el motivo.');

    const { registrarAuditoria } = await import('../../shared/auditoria');
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'inventario.linea_ajuste_excluida',
        detalle: expect.objectContaining({ lineaId: 100, motivo: 'El área de negativos puso mal el motivo.' }),
      }),
    );
  });

  it('incluir: vuelve a incluir, limpia la firma de exclusión y recalcula', async () => {
    prismaMock.lineaAjusteDynamics.findUnique.mockResolvedValue({ ...LINEA_DB, excluida: true });
    prismaMock.lineaAjusteDynamics.update.mockResolvedValue({ ...LINEA_DB, excluida: false });
    prismaMock.lineaAjusteDynamics.aggregate.mockResolvedValue({ _sum: { importe: decimal(30) } });
    prismaMock.resultadoInventario.update.mockResolvedValue({ montoNegativos: decimal(30) });

    const { montoNegativos } = await incluirLineaAjusteNegativo(AUDITOR, 9, 100, 'Me equivoqué, sí corresponde.');

    expect(prismaMock.lineaAjusteDynamics.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 100 },
        data: expect.objectContaining({
          excluida: false,
          excluidaPorId: null,
          excluidaEn: null,
          motivoExclusion: null,
        }),
      }),
    );
    expect(montoNegativos).toBe(30);

    const { registrarAuditoria } = await import('../../shared/auditoria');
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'inventario.linea_ajuste_incluida',
        detalle: expect.objectContaining({ lineaId: 100, motivo: 'Me equivoqué, sí corresponde.' }),
      }),
    );
  });

  it('incluir: el coordinador no accede', async () => {
    await expect(incluirLineaAjusteNegativo(COORDINADOR, 9, 100, 'motivo')).rejects.toThrow(Prohibido);
  });
});

describe('listarLineasAjusteNegativo: NULL != 0 tambien en el listado', () => {
  it('el coordinador no accede', async () => {
    await expect(listarLineasAjusteNegativo(COORDINADOR, 9)).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.findUnique).not.toHaveBeenCalled();
  });

  it('el inventario que no existe es 404', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(listarLineasAjusteNegativo(AUDITOR, 9)).rejects.toThrow(NoEncontrado);
  });

  it('SIN importación vigente: importacion null, lineas [] -- distinto de "0 líneas"', async () => {
    prismaMock.importacionAjustesDynamics.findFirst.mockResolvedValue(null);
    const resultado = await listarLineasAjusteNegativo(AUDITOR, 9);
    expect(resultado.importacion).toBeNull();
    expect(resultado.lineas).toEqual([]);
    expect(resultado.puedeEditar).toBe(true); // conteo_cerrado, el default de mockInventario()
  });

  it('importación vigente CON 0 líneas útiles: importacion NO es null (el archivo se importó de verdad)', async () => {
    prismaMock.importacionAjustesDynamics.findFirst.mockResolvedValue({
      id: 42,
      nombreArchivo: 'vacio.xlsx',
      importadoEn: new Date('2026-09-14T10:00:00.000Z'),
      importadoPor: { id: 5, nombre: 'Gilmer' },
      lineas: [],
    });
    const resultado = await listarLineasAjusteNegativo(AUDITOR, 9);
    expect(resultado.importacion).toMatchObject({ id: 42, nombreArchivo: 'vacio.xlsx' });
    expect(resultado.lineas).toEqual([]);
  });

  it('devuelve cada línea con su id, fila, si está excluida, quién y cuándo', async () => {
    prismaMock.importacionAjustesDynamics.findFirst.mockResolvedValue({
      id: 42,
      nombreArchivo: 'ajustes.xlsx',
      importadoEn: new Date('2026-09-14T10:00:00.000Z'),
      importadoPor: { id: 5, nombre: 'Gilmer' },
      lineas: [
        {
          id: 100,
          fila: 2,
          codigo: '101131',
          descripcion: 'Ajuste',
          importe: decimal(30),
          excluida: false,
          motivoExclusion: null,
          excluidaEn: null,
          excluidaPor: null,
        },
        {
          id: 101,
          fila: 3,
          codigo: '101132',
          descripcion: 'Ajuste 2',
          importe: decimal(15),
          excluida: true,
          motivoExclusion: 'El área de negativos puso mal el motivo.',
          excluidaEn: new Date('2026-09-14T11:00:00.000Z'),
          excluidaPor: { id: 5, nombre: 'Gilmer' },
        },
      ],
    });

    const resultado = await listarLineasAjusteNegativo(AUDITOR, 9);

    expect(resultado.lineas).toHaveLength(2);
    expect(resultado.lineas[0]).toMatchObject({ id: 100, fila: 2, excluida: false, importe: 30 });
    expect(resultado.lineas[1]).toMatchObject({
      id: 101,
      excluida: true,
      motivoExclusion: 'El área de negativos puso mal el motivo.',
      excluidaPor: { id: 5, nombre: 'Gilmer' },
    });
  });

  it('NO exige conteo_cerrado: se puede LEER aunque el inventario ya esté liquidado o lacrado', async () => {
    mockInventario({ estado: 'liquidado' });
    prismaMock.importacionAjustesDynamics.findFirst.mockResolvedValue(null);
    await expect(listarLineasAjusteNegativo(AUDITOR, 9)).resolves.toEqual({
      importacion: null,
      lineas: [],
      puedeEditar: false,
    });

    mockInventario({ estado: 'lacrado' });
    await expect(listarLineasAjusteNegativo(AUDITOR, 9)).resolves.toEqual({
      importacion: null,
      lineas: [],
      puedeEditar: false,
    });
  });

  it('pide la importación VIGENTE de ESTE inventario', async () => {
    prismaMock.importacionAjustesDynamics.findFirst.mockResolvedValue(null);
    await listarLineasAjusteNegativo(AUDITOR, 9);
    expect(prismaMock.importacionAjustesDynamics.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inventarioId: 9, vigente: true } }),
    );
  });

  /**
   * `puedeEditar` es lo que la PANTALLA usa para bloquear los botones de
   * excluir/incluir ANTES de intentar la llamada -- no reemplaza el bloqueo
   * real (`validarEstadoParaAjustar`, ya probado en el describe de
   * excluir/incluir), es la versión "no dejes ni tocar el botón".
   */
  describe('puedeEditar', () => {
    it.each([
      ['conteo_cerrado', true],
      ['en_curso', true],
      ['liquidado', false],
      ['lacrado', false],
    ])('estado %s -> puedeEditar %s', async (estado, esperado) => {
      mockInventario({ estado });
      prismaMock.importacionAjustesDynamics.findFirst.mockResolvedValue(null);
      const resultado = await listarLineasAjusteNegativo(AUDITOR, 9);
      expect(resultado.puedeEditar).toBe(esperado);
    });
  });
});
