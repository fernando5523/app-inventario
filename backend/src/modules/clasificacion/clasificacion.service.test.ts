/**
 * Clasificacion de productos: la excepcion PERMANENTE del Auditor a la
 * clasificacion empresa/empleado de Dynamics, por codigo (caso real: las
 * cervezas, que en D365 figuran como del empleado pero por orden de gerencia
 * las asume la empresa por robo).
 *
 * Prisma mockeado (no toca la tabla nueva -- la migracion puede no estar
 * aplicada todavia): lo que se prueba es la LOGICA, no el SQL.
 *   - la busqueda sale del catalogo (codigo distinct, ultimo snapshot);
 *   - Dynamics (responsable) y la decision del Auditor son DOS datos separados;
 *   - clasificar deja quien/cuando; desclasificar borra la fila pero el rastro
 *     queda en RegistroAuditoria.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', () => ({
  prisma: {
    catalogoItem: { findMany: vi.fn(), groupBy: vi.fn() },
    clasificacionProducto: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { buscar, clasificar, desclasificar } from './clasificacion.service';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const QUERY_BASE = { limite: 50, desplazamiento: 0 } as const;

function itemCatalogo(over: Record<string, unknown> = {}) {
  return {
    codigo: 'CERV-001',
    descripcion: 'Cerveza Pilsen 620ml',
    categoria: 'CERVEZAS',
    responsable: 'empleado',
    ...over,
  };
}

function filaClasificacion(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    codigo: 'CERV-001',
    esEmpresa: true,
    nota: 'Robo: la asume la empresa',
    clasificadoPorId: 103,
    clasificadoEn: new Date('2026-09-11T12:00:00.000Z'),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.catalogoItem.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([] as never);
  vi.mocked(registrarAuditoria).mockResolvedValue(undefined);
});

describe('buscar: el catalogo con lo de Dynamics y lo del Auditor, por separado', () => {
  it('cada producto trae responsable (Dynamics) Y clasificacion (Auditor), ninguno pisa al otro', async () => {
    vi.mocked(prisma.catalogoItem.groupBy).mockResolvedValue([{ codigo: 'CERV-001' }] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([itemCatalogo({ responsable: 'empleado' })] as never);
    vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([filaClasificacion({ esEmpresa: true })] as never);

    const { productos } = await buscar(AUDITOR, { ...QUERY_BASE });

    expect(productos).toHaveLength(1);
    // Dynamics dice "empleado"...
    expect(productos[0]!.responsableDynamics).toBe('empleado');
    // ...y el Auditor decidio "empresa". Los DOS datos conviven.
    expect(productos[0]!.clasificacion).toMatchObject({
      codigo: 'CERV-001',
      esEmpresa: true,
      nota: 'Robo: la asume la empresa',
      clasificadoPorId: 103,
      clasificadoEn: '2026-09-11T12:00:00.000Z',
    });
  });

  it('el universo sale del catalogo: codigo distinct, el snapshot MAS reciente de cada uno', async () => {
    await buscar(AUDITOR, { ...QUERY_BASE });
    const args = vi.mocked(prisma.catalogoItem.findMany).mock.calls[0]![0];
    expect(args?.distinct).toEqual(['codigo']);
    // codigo primero (lo exige DISTINCT ON); inventarioId desc = el ultimo snapshot.
    expect(args?.orderBy).toEqual([{ codigo: 'asc' }, { inventarioId: 'desc' }]);
  });

  it('pagina: total = conteo distinct; limite y desplazamiento se devuelven tal cual', async () => {
    vi.mocked(prisma.catalogoItem.groupBy).mockResolvedValue([{ codigo: 'a' }, { codigo: 'b' }, { codigo: 'c' }] as never);
    const res = await buscar(AUDITOR, { limite: 10, desplazamiento: 20 });
    expect(res.total).toBe(3);
    expect(res.limite).toBe(10);
    expect(res.desplazamiento).toBe(20);
    const args = vi.mocked(prisma.catalogoItem.findMany).mock.calls[0]![0];
    expect(args?.take).toBe(10);
    expect(args?.skip).toBe(20);
  });

  it('q busca en codigo, descripcion Y categoria, insensible a mayusculas', async () => {
    await buscar(AUDITOR, { ...QUERY_BASE, q: 'cerv' });
    const args = vi.mocked(prisma.catalogoItem.findMany).mock.calls[0]![0];
    expect(args?.where).toEqual({
      OR: [
        { codigo: { contains: 'cerv', mode: 'insensitive' } },
        { descripcion: { contains: 'cerv', mode: 'insensitive' } },
        { categoria: { contains: 'cerv', mode: 'insensitive' } },
      ],
    });
  });

  it('soloClasificados restringe a los codigos que YA tienen clasificacion', async () => {
    vi.mocked(prisma.clasificacionProducto.findMany).mockImplementation((async (a: { select?: { codigo?: boolean } }) => {
      if (a?.select?.codigo) return [{ codigo: 'CERV-001' }, { codigo: 'CERV-002' }];
      return [];
    }) as never);
    await buscar(AUDITOR, { ...QUERY_BASE, soloClasificados: true });
    const args = vi.mocked(prisma.catalogoItem.findMany).mock.calls[0]![0];
    expect(args?.where).toEqual({ codigo: { in: ['CERV-001', 'CERV-002'] } });
  });

  it('un producto sin clasificacion del Auditor queda con clasificacion null', async () => {
    vi.mocked(prisma.catalogoItem.groupBy).mockResolvedValue([{ codigo: 'X' }] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([itemCatalogo({ codigo: 'X', responsable: 'empresa' })] as never);
    vi.mocked(prisma.clasificacionProducto.findMany).mockResolvedValue([] as never);
    const { productos } = await buscar(AUDITOR, { ...QUERY_BASE });
    expect(productos[0]!.responsableDynamics).toBe('empresa');
    expect(productos[0]!.clasificacion).toBeNull();
  });
});

describe('clasificar: upsert por codigo, con quien y cuando', () => {
  it('codigo nuevo: upsert con clasificadoPorId/clasificadoEn y auditoria "creada"', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(filaClasificacion() as never);

    const dto = await clasificar(AUDITOR, 'CERV-001', { esEmpresa: true, nota: 'Robo: la asume la empresa' });

    const args = vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0];
    expect(args.where).toEqual({ codigo: 'CERV-001' });
    expect(args.create).toMatchObject({ codigo: 'CERV-001', esEmpresa: true, nota: 'Robo: la asume la empresa', clasificadoPorId: 103 });
    expect(args.create.clasificadoEn).toBeInstanceOf(Date);
    expect(args.update).toMatchObject({ esEmpresa: true, clasificadoPorId: 103 });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 103,
        accion: 'clasificacion.creada',
        entidad: 'clasificacion_producto',
        detalle: expect.objectContaining({ codigo: 'CERV-001', esEmpresa: true }),
      }),
    );
    expect(dto).toMatchObject({ codigo: 'CERV-001', esEmpresa: true });
  });

  it('reclasifica uno existente: auditoria "actualizada" con el valor ANTERIOR', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ esEmpresa: false, nota: 'era del empleado' }) as never,
    );
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(filaClasificacion({ esEmpresa: true }) as never);

    await clasificar(AUDITOR, 'CERV-001', { esEmpresa: true });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'clasificacion.actualizada',
        detalle: expect.objectContaining({
          codigo: 'CERV-001',
          esEmpresa: true,
          anterior: { esEmpresa: false, nota: 'era del empleado' },
        }),
      }),
    );
  });
});

describe('desclasificar: borra la fila, no la historia', () => {
  it('borra la fila y deja rastro en auditoria con el valor anterior', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ id: 7, esEmpresa: true, nota: 'la asumia la empresa' }) as never,
    );
    vi.mocked(prisma.clasificacionProducto.delete).mockResolvedValue(filaClasificacion() as never);

    await desclasificar(AUDITOR, 'CERV-001');

    expect(prisma.clasificacionProducto.delete).toHaveBeenCalledWith({ where: { codigo: 'CERV-001' } });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 103,
        accion: 'clasificacion.eliminada',
        entidad: 'clasificacion_producto',
        entidadId: 7,
        detalle: expect.objectContaining({
          codigo: 'CERV-001',
          anterior: { esEmpresa: true, nota: 'la asumia la empresa' },
        }),
      }),
    );
  });

  it('desclasificar un codigo sin clasificacion: 404, no borra nada ni audita', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    await expect(desclasificar(AUDITOR, 'NOPE')).rejects.toMatchObject({ status: 404 });
    expect(prisma.clasificacionProducto.delete).not.toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('solo el Auditor (cinturon del service, ademas del middleware de la ruta)', () => {
  it('un no-auditor no puede buscar, ni clasificar, ni desclasificar', async () => {
    const coord: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };
    await expect(buscar(coord, { ...QUERY_BASE })).rejects.toMatchObject({ status: 403 });
    await expect(clasificar(coord, 'X', { esEmpresa: true })).rejects.toMatchObject({ status: 403 });
    await expect(desclasificar(coord, 'X')).rejects.toMatchObject({ status: 403 });
  });
});
