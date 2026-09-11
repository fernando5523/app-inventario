/**
 * TEST DE INTEGRACION DE PUNTA A PUNTA (liquidacion v2): un producto que
 * Dynamics clasificaba como EMPLEADO al cerrar el conteo, y que el Auditor
 * reclasifica como EMPRESA DESPUES de ese cierre (una excepcion nueva en
 * `ClasificacionProducto` que no existia cuando corrio `rondas.service.ts#cerrar`).
 *
 * Cubre el ciclo completo que pidio el cliente: liquidar() tiene que leer la
 * excepcion VIGENTE (no la que habia al cerrar), sacar el faltante de ese
 * producto de la cuenta del personal, congelar la clasificacion en
 * `DiferenciaItem.esEmpresa`, y a partir de esa escritura el reporte a
 * gerencia (liquidacion.reporte-gerencia.ts) tiene que encontrar el item.
 *
 * Sigue el mismo patron de Prisma mockeado que el resto del modulo
 * (liquidacion.cierre.test.ts, liquidacion.reporte-gerencia.test.ts): este
 * proyecto no corre integracion contra una base real en ningun lado, asi que
 * "punta a punta" aca significa las DOS funciones de servicio reales,
 * encadenadas, sobre el mismo estado simulado -- no mocks de mocks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn(), update: vi.fn() },
  colaborador: { findMany: vi.fn() },
  hojaConteo: { findMany: vi.fn() },
  liquidacionColaborador: { createMany: vi.fn() },
  diferenciaItem: { findMany: vi.fn(), updateMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  clasificacionProducto: { findMany: vi.fn() },
  resultadoInventario: { update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { liquidar } from './liquidacion.cierre';
import { obtenerReporteGerencia } from './liquidacion.reporte-gerencia';
import type { ColaboradorAutenticado } from '../../shared/tipos';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };
const decimal = (valor: number) => ({ toNumber: () => valor });

const INVENTARIO_ID = 45;
const CERVEZA = 'CERVEZA-620';
const ARROZ = 'ARROZ-5KG';

describe('flujo punta a punta: reclasificar despues del cierre -> liquidar -> reporte a gerencia', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.inventario.findUnique.mockResolvedValue({
      id: INVENTARIO_ID,
      sucursalId: 1,
      estado: 'conteo_cerrado',
      resultado: {
        // 100 (CERVEZA) + 400 (ARROZ): montoFaltanteBruto YA incluye a los
        // dos, cualquiera sea su clasificacion (rondas.service.ts#cerrar).
        montoFaltanteBruto: decimal(500),
        // Lo carga el Excel de ajustes (min-2) antes de liquidar; 0 EXPLICITO
        // = "alguien miro y no habia" (liquidacion.ajustes.ts). Se lee tal
        // cual, sin tocar.
        montoNegativos: decimal(0),
        // Al CERRAR el conteo, CERVEZA todavia era EMPLEADO para Dynamics --
        // por eso este valor (el viejo, congelado) NO tiene el faltante de
        // CERVEZA adentro. `liquidar()` lo reemplaza por el recalculado.
        montoFaltanteEmpresa: decimal(0),
        colaboradoresAlcanzados: 2,
        colaboradoresAsistieron: 2,
        multaInasistencia: decimal(20),
      },
    });
    prismaMock.colaborador.findMany.mockResolvedValue([
      { id: 1, nombre: 'Ana', rol: 'conteo' },
      { id: 2, nombre: 'Beto', rol: 'conteo' },
    ]);
    prismaMock.hojaConteo.findMany.mockResolvedValue([
      { asignadoAId: 1, asignadoA2Id: null, _count: { conteos: 5 } },
      { asignadoAId: 2, asignadoA2Id: null, _count: { conteos: 5 } },
    ]);

    // Lo que quedo CONGELADO al cerrar el conteo: las diferencias existen,
    // pero la clasificacion de CatalogoItem (Dynamics, de ESE snapshot) decia
    // EMPLEADO para las dos.
    prismaMock.diferenciaItem.findMany.mockResolvedValue([
      { codigo: CERVEZA, diferencia: -10, montoDiferencia: decimal(-100) },
      { codigo: ARROZ, diferencia: -20, montoDiferencia: decimal(-400) },
    ]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([
      { codigo: CERVEZA, esEmpresa: false },
      { codigo: ARROZ, esEmpresa: false },
    ]);

    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : arg,
    );
  });

  it('SIN excepcion del Auditor: el faltante de CERVEZA se descuenta al personal como cualquier otro', async () => {
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);

    const cierre = await liquidar(AUDITOR, INVENTARIO_ID);

    // neto = 500 - 0 - 0 = 500 -> cuota = 500 / 2 = 250.
    expect(cierre.cuotaBase).toBe(250);
    expect(prismaMock.diferenciaItem.updateMany).toHaveBeenCalledWith({
      where: { inventarioId: INVENTARIO_ID, codigo: CERVEZA },
      data: { esEmpresa: false },
    });
  });

  it('el Auditor clasifica CERVEZA como EMPRESA despues del cierre -> sale de la cuenta del personal al liquidar', async () => {
    // La excepcion VIGENTE hoy -- no existia cuando corrio rondas.service.ts#cerrar.
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([{ codigo: CERVEZA, esEmpresa: true }]);

    const cierre = await liquidar(AUDITOR, INVENTARIO_ID);

    // neto = 500 - 0 - 100 (CERVEZA, ahora empresa) = 400 -> cuota = 200.
    expect(cierre.cuotaBase).toBe(200);

    // La clasificacion efectiva queda CONGELADA en DiferenciaItem -- es lo
    // que despues filtra el reporte a gerencia.
    expect(prismaMock.diferenciaItem.updateMany).toHaveBeenCalledWith({
      where: { inventarioId: INVENTARIO_ID, codigo: CERVEZA },
      data: { esEmpresa: true },
    });
    expect(prismaMock.diferenciaItem.updateMany).toHaveBeenCalledWith({
      where: { inventarioId: INVENTARIO_ID, codigo: ARROZ },
      data: { esEmpresa: false },
    });
    expect(prismaMock.resultadoInventario.update).toHaveBeenCalledWith({
      where: { inventarioId: INVENTARIO_ID },
      data: { montoFaltanteEmpresa: 100, montoSobranteEmpleado: 0 },
    });

    // TODO O NADA: la reclasificacion viaja en la MISMA transaccion que la
    // planilla, el estado y el resultado -- nunca puede quedar la
    // clasificacion escrita sin la liquidacion, ni al reves.
    const [operaciones] = prismaMock.$transaction.mock.calls[0] as [unknown[]];
    // liquidacionColaborador.createMany + inventario.update +
    // resultadoInventario.update + 2 updateMany (CERVEZA, ARROZ).
    expect(operaciones.length).toBe(5);

    // CIERRE DEL CICLO: con la escritura ya reflejada en la base (lo que el
    // mock de arriba probo que `liquidar()` pide), el reporte a gerencia --
    // que filtra DiferenciaItem.esEmpresa=true -- ahora SI encuentra a
    // CERVEZA, y sigue sin traer a ARROZ (quedo esEmpresa: false).
    prismaMock.inventario.findUnique.mockResolvedValue({ id: INVENTARIO_ID, estado: 'liquidado' });
    prismaMock.diferenciaItem.findMany.mockResolvedValue([
      { codigo: CERVEZA, descripcion: 'Cerveza 620ml', diferencia: -10, montoDiferencia: decimal(-100) },
    ]);

    const reporte = await obtenerReporteGerencia(AUDITOR, INVENTARIO_ID);

    expect(reporte.faltantes).toEqual([{ codigo: CERVEZA, descripcion: 'Cerveza 620ml', unidades: 10, monto: 100 }]);
    expect(reporte.totalFaltante).toBe(100);
    expect(prismaMock.diferenciaItem.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { inventarioId: INVENTARIO_ID, esEmpresa: true } }),
    );
  });

  it('el reporte a gerencia SIGUE cerrado mientras el inventario no este liquidado -- antes de liquidar la clasificacion no esta congelada', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: INVENTARIO_ID, estado: 'conteo_cerrado' });
    await expect(obtenerReporteGerencia(AUDITOR, INVENTARIO_ID)).rejects.toMatchObject({ status: 409 });
  });
});
