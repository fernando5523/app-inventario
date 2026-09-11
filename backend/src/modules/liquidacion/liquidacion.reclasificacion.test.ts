import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({
  prisma: {
    diferenciaItem: { findMany: vi.fn(), updateMany: vi.fn() },
    catalogoItem: { findMany: vi.fn() },
    clasificacionProducto: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../config/database';
import {
  clasificacionManualVigente,
  datosParaReclasificar,
  esEmpresaEfectivo,
  operacionesDeEscrituraClasificacion,
  reclasificarAlLiquidar,
  type FilaDiferenciaParaReclasificar,
} from './liquidacion.reclasificacion';

describe('esEmpresaEfectivo', () => {
  it('sin excepcion del Auditor, manda Dynamics (catalogo)', () => {
    expect(esEmpresaEfectivo('IT-1', true, new Map())).toBe(true);
    expect(esEmpresaEfectivo('IT-1', false, new Map())).toBe(false);
  });

  it('con excepcion, manda el Auditor -- en cualquiera de los dos sentidos', () => {
    expect(esEmpresaEfectivo('IT-1', false, new Map([['IT-1', true]]))).toBe(true);
    expect(esEmpresaEfectivo('IT-1', true, new Map([['IT-1', false]]))).toBe(false);
  });
});

describe('reclasificarAlLiquidar', () => {
  it('faltante de empresa: SUMA una sola vez -- no se descuenta dos veces (correccion sobre el diseno original)', () => {
    // montoFaltanteBruto (rondas.service.ts) YA incluye este faltante; lo que
    // esta funcion devuelve es el monto A RESTAR aparte, no una resta interna.
    const filas: FilaDiferenciaParaReclasificar[] = [
      { codigo: 'CERVEZA', diferencia: -10, montoDiferencia: -100, esEmpresaCatalogo: true },
      { codigo: 'ARROZ', diferencia: -2, montoDiferencia: -20, esEmpresaCatalogo: false },
    ];
    const r = reclasificarAlLiquidar(filas, new Map());
    expect(r.montoFaltanteEmpresa).toBe(100);
    // El de empleado (ARROZ) no entra al monto de empresa.
    expect(r.esEmpresaPorCodigo.get('ARROZ')).toBe(false);
  });

  it('sobrante que compensa: solo de items NO empresa, a favor del empleado', () => {
    const filas: FilaDiferenciaParaReclasificar[] = [
      { codigo: 'YOGUR', diferencia: 5, montoDiferencia: 50, esEmpresaCatalogo: false },
      { codigo: 'CERVEZA', diferencia: 3, montoDiferencia: 30, esEmpresaCatalogo: true },
    ];
    const r = reclasificarAlLiquidar(filas, new Map());
    // Solo el sobrante de YOGUR (no empresa) compensa; el de CERVEZA (empresa) no.
    expect(r.montoSobranteEmpleado).toBe(50);
  });

  it('la reclasificacion manual del Auditor mueve un item de faltante-descontable a faltante-empresa', () => {
    const filas: FilaDiferenciaParaReclasificar[] = [
      { codigo: 'CERVEZA', diferencia: -10, montoDiferencia: -100, esEmpresaCatalogo: false },
    ];
    const sinExcepcion = reclasificarAlLiquidar(filas, new Map());
    expect(sinExcepcion.montoFaltanteEmpresa).toBe(0);

    const conExcepcion = reclasificarAlLiquidar(filas, new Map([['CERVEZA', true]]));
    expect(conExcepcion.montoFaltanteEmpresa).toBe(100);
    expect(conExcepcion.esEmpresaPorCodigo.get('CERVEZA')).toBe(true);
  });

  it('items sin precio (montoDiferencia null) SI se clasifican, pero no aportan a los montos', () => {
    const filas: FilaDiferenciaParaReclasificar[] = [
      { codigo: 'SIN-PRECIO', diferencia: -3, montoDiferencia: null, esEmpresaCatalogo: true },
    ];
    const r = reclasificarAlLiquidar(filas, new Map());
    expect(r.montoFaltanteEmpresa).toBe(0);
    expect(r.esEmpresaPorCodigo.get('SIN-PRECIO')).toBe(true);
  });

  it('sin filas, todo en cero y el mapa vacio', () => {
    const r = reclasificarAlLiquidar([], new Map());
    expect(r.montoFaltanteEmpresa).toBe(0);
    expect(r.montoSobranteEmpleado).toBe(0);
    expect(r.esEmpresaPorCodigo.size).toBe(0);
  });
});

describe('datosParaReclasificar (Prisma mockeado)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cruza DiferenciaItem con el CatalogoItem de ESE inventario por codigo', async () => {
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([
      { codigo: 'A1', diferencia: -5, montoDiferencia: { toNumber: () => -50 } },
      { codigo: 'A2', diferencia: 2, montoDiferencia: null },
    ] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([
      { codigo: 'A1', esEmpresa: true },
      { codigo: 'A2', esEmpresa: false },
    ] as never);

    const filas = await datosParaReclasificar(7);

    expect(filas).toEqual([
      { codigo: 'A1', diferencia: -5, montoDiferencia: -50, esEmpresaCatalogo: true },
      { codigo: 'A2', diferencia: 2, montoDiferencia: null, esEmpresaCatalogo: false },
    ]);
  });

  it('sin fila de catalogo para un codigo (no deberia pasar), no le regala una exclusion: default false', async () => {
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([
      { codigo: 'HUERFANO', diferencia: -1, montoDiferencia: { toNumber: () => -10 } },
    ] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([] as never);

    const filas = await datosParaReclasificar(7);
    expect(filas[0]!.esEmpresaCatalogo).toBe(false);
  });
});

describe('clasificacionManualVigente (Prisma mockeado)', () => {
  it('arma el mapa codigo -> esEmpresa desde ClasificacionProducto', async () => {
    vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([
      { codigo: 'CERVEZA', esEmpresa: true },
      { codigo: 'GALLETA', esEmpresa: false },
    ] as never);

    const mapa = await clasificacionManualVigente();
    expect(mapa.get('CERVEZA')).toBe(true);
    expect(mapa.get('GALLETA')).toBe(false);
    expect(mapa.has('SIN-CLASIFICAR')).toBe(false);
  });
});

describe('operacionesDeEscrituraClasificacion', () => {
  it('arma una operacion de escritura por codigo, para sumar al $transaction de liquidar()', () => {
    const ops = operacionesDeEscrituraClasificacion(
      7,
      new Map([
        ['A1', true],
        ['A2', false],
      ]),
    );
    expect(ops).toHaveLength(2);
    expect(prisma.diferenciaItem.updateMany).toHaveBeenCalledWith({
      where: { inventarioId: 7, codigo: 'A1' },
      data: { esEmpresa: true },
    });
    expect(prisma.diferenciaItem.updateMany).toHaveBeenCalledWith({
      where: { inventarioId: 7, codigo: 'A2' },
      data: { esEmpresa: false },
    });
  });
});
