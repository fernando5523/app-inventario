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
  aplicarClasificacionVigente,
  clasificacionManualVigente,
  datosParaReclasificar,
  esEmpresaEfectivo,
  operacionesDeEscrituraClasificacion,
  reclasificarAlLiquidar,
  resolverMontosDeClasificacion,
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

/**
 * REGRESION del bug reportado por min-3 con numeros (2026-09-14): con bruto
 * 130, negativos 40 (Excel), un sobrante de empleado de 50 y una cerveza de
 * faltante 30 -- antes de esta funcion, la vista previa (antes de liquidar)
 * mostraba 90 y el encabezado post-liquidar mostraba 60, mientras la
 * planilla usaba el correcto, 10. `resolverMontosDeClasificacion` es la
 * UNICA fuente que consumen historial, la pantalla de liquidacion (antes y
 * despues) y liquidar() -- estos tests fijan los montos que le entran a la
 * formula (`historial.calculos.ts#calcularResumenLiquidacion` hace el resto,
 * y ya esta probado por separado).
 */
describe('resolverMontosDeClasificacion', () => {
  beforeEach(() => vi.clearAllMocks());

  const CERVEZA = 'CERVEZA';
  const OTRO = 'OTRO-SOBRANTE';

  function mockearDatosDelInventario(): void {
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([
      { codigo: CERVEZA, diferencia: -1, montoDiferencia: { toNumber: () => -30 } },
      { codigo: OTRO, diferencia: 1, montoDiferencia: { toNumber: () => 50 } },
    ] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([
      { codigo: CERVEZA, esEmpresa: false }, // EMPLEADO en Dynamics al cerrar
      { codigo: OTRO, esEmpresa: false },
    ] as never);
  }

  it('ANTES de liquidar (conteo_cerrado), CON la cerveza clasificada como empresa: 30 de empresa, 50 de sobrante', async () => {
    mockearDatosDelInventario();
    vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([{ codigo: CERVEZA, esEmpresa: true }] as never);

    const montos = await resolverMontosDeClasificacion(45, 'conteo_cerrado', {
      montoFaltanteEmpresa: 0, // el congelado al cerrar (Dynamics, sin la cerveza) -- NO se usa en este regimen
      montoSobranteEmpleado: null,
    });

    expect(montos.montoFaltanteEmpresa).toBe(30);
    expect(montos.montoSobranteEmpleado).toBe(50);
    // El regimen VIGENTE si trae el mapa (lo necesita liquidar() para
    // escribir DiferenciaItem.esEmpresa).
    expect(montos.esEmpresaPorCodigo?.get(CERVEZA)).toBe(true);
  });

  it('ANTES de liquidar, SIN clasificar la cerveza: la empresa da 0 (sigue en la cuenta del personal)', async () => {
    mockearDatosDelInventario();
    vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([]);

    const montos = await resolverMontosDeClasificacion(45, 'conteo_cerrado', {
      montoFaltanteEmpresa: 0,
      montoSobranteEmpleado: null,
    });

    expect(montos.montoFaltanteEmpresa).toBe(0);
    expect(montos.montoSobranteEmpleado).toBe(50);
  });

  it('DESPUES de liquidar (liquidado): CONGELADO -- ignora la clasificacion vigente, ni toca Prisma', async () => {
    const montos = await resolverMontosDeClasificacion(45, 'liquidado', {
      montoFaltanteEmpresa: 30,
      montoSobranteEmpleado: 50,
    });

    expect(montos).toEqual({ montoFaltanteEmpresa: 30, montoSobranteEmpleado: 50, esEmpresaPorCodigo: null });
    expect(prisma.diferenciaItem.findMany).not.toHaveBeenCalled();
    expect(prisma.clasificacionProducto.findMany).not.toHaveBeenCalled();
  });

  it('lacrado: mismo regimen congelado que liquidado', async () => {
    const montos = await resolverMontosDeClasificacion(45, 'lacrado', {
      montoFaltanteEmpresa: 30,
      montoSobranteEmpleado: 50,
    });
    expect(montos).toEqual({ montoFaltanteEmpresa: 30, montoSobranteEmpleado: 50, esEmpresaPorCodigo: null });
  });

  it('inventario YA liquidado antes de esta regla (montoSobranteEmpleado NULL en la base): da 0, no null ni error', async () => {
    const montos = await resolverMontosDeClasificacion(9, 'liquidado', {
      montoFaltanteEmpresa: 10,
      montoSobranteEmpleado: null,
    });
    expect(montos).toEqual({ montoFaltanteEmpresa: 10, montoSobranteEmpleado: 0, esEmpresaPorCodigo: null });
  });
});

/**
 * REGRESION reportada por min-4 (2026-09-14): la matriz de auditoria leia
 * `CatalogoItem.esEmpresa` (Dynamics) directo, sin la excepcion del Auditor
 * -- una cerveza clasificada como empresa seguia apareciendo como faltante
 * del empleado en la matriz mientras la liquidacion ya la sacaba. Misma
 * fuente que `resolverMontosDeClasificacion`, aplicada por item.
 */
describe('aplicarClasificacionVigente', () => {
  beforeEach(() => vi.clearAllMocks());

  const CERVEZA = { codigo: 'CERVEZA', esEmpresa: false }; // Dynamics: EMPLEADO
  const ARROZ = { codigo: 'ARROZ', esEmpresa: false };

  it('VIGENTE (conteo_cerrado): aplica ClasificacionProducto por encima de Dynamics', async () => {
    vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }] as never);

    const resultado = await aplicarClasificacionVigente(45, 'conteo_cerrado', [CERVEZA, ARROZ]);

    expect(resultado.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
    expect(resultado.find((i) => i.codigo === 'ARROZ')?.esEmpresa).toBe(false);
    expect(prisma.diferenciaItem.findMany).not.toHaveBeenCalled();
  });

  it('VIGENTE sin ninguna excepcion: queda igual a Dynamics', async () => {
    vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([]);

    const resultado = await aplicarClasificacionVigente(45, 'conteo_cerrado', [CERVEZA]);

    expect(resultado[0]!.esEmpresa).toBe(false);
  });

  it('CONGELADO (liquidado): lee DiferenciaItem.esEmpresa, ignora la clasificacion vigente', async () => {
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }] as never);

    const resultado = await aplicarClasificacionVigente(45, 'liquidado', [CERVEZA, ARROZ]);

    expect(resultado.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
    // ARROZ no tiene fila en DiferenciaItem (por ej. si cuadro, diferencia 0)
    // -- conserva el valor de Dynamics, que no cambia el veredicto para un
    // item cuadrado (auditoria.calculos.ts#veredicto revisa cuadrado antes).
    expect(resultado.find((i) => i.codigo === 'ARROZ')?.esEmpresa).toBe(false);
    expect(prisma.clasificacionProducto.findMany).not.toHaveBeenCalled();
  });

  it('lacrado: mismo regimen congelado que liquidado', async () => {
    vi.mocked(prisma.diferenciaItem.findMany).mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }] as never);

    const resultado = await aplicarClasificacionVigente(45, 'lacrado', [CERVEZA]);

    expect(resultado[0]!.esEmpresa).toBe(true);
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
