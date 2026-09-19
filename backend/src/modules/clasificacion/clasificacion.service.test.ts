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
    // La clase derivada por el snapshot y el empaque de compra: referencia
    // para el Auditor, nunca algo que esta pantalla escriba.
    clase: 'unidad',
    empaqueCompra: 12,
    empaqueCompraSimbolo: 'Emp.12',
    ...over,
  };
}

function filaClasificacion(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    codigo: 'CERV-001',
    esEmpresa: true,
    clase: 'empresa',
    empaqueCompraCorregido: null,
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

  /**
   * El empaque de compra viaja en la busqueda porque es EL DENOMINADOR del
   * umbral por paquete: elegir "paquete" sin verlo es elegir a ciegas.
   */
  it('trae el empaque de compra y la clase derivada por el snapshot', async () => {
    vi.mocked(prisma.catalogoItem.groupBy).mockResolvedValue([{ codigo: 'X' }] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([
      itemCatalogo({ codigo: 'X', clase: 'paquete', empaqueCompra: 24, empaqueCompraSimbolo: 'Emp.24' }),
    ] as never);

    const { productos } = await buscar(AUDITOR, { ...QUERY_BASE });

    expect(productos[0]).toMatchObject({ claseDynamics: 'paquete', empaqueCompra: 24, empaqueCompraSimbolo: 'Emp.24' });
  });

  /** NULL no es 1: sin empaque de compra el umbral no se puede aplicar, y la pantalla tiene que poder decirlo. */
  it('un item sin empaque de compra viaja con null, nunca con 1', async () => {
    vi.mocked(prisma.catalogoItem.groupBy).mockResolvedValue([{ codigo: 'X' }] as never);
    vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue([
      itemCatalogo({ codigo: 'X', empaqueCompra: null, empaqueCompraSimbolo: null }),
    ] as never);

    const { productos } = await buscar(AUDITOR, { ...QUERY_BASE });

    expect(productos[0]!.empaqueCompra).toBeNull();
    expect(productos[0]!.empaqueCompraSimbolo).toBeNull();
  });
});

describe('clasificar: upsert por codigo, con quien y cuando', () => {
  it('codigo nuevo: upsert con clasificadoPorId/clasificadoEn y auditoria "creada"', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(filaClasificacion() as never);

    const dto = await clasificar(AUDITOR, 'CERV-001', { clase: 'empresa', nota: 'Robo: la asume la empresa' });

    const args = vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0];
    expect(args.where).toEqual({ codigo: 'CERV-001' });
    expect(args.create).toMatchObject({
      codigo: 'CERV-001',
      clase: 'empresa',
      esEmpresa: true,
      nota: 'Robo: la asume la empresa',
      clasificadoPorId: 103,
    });
    expect(args.create.clasificadoEn).toBeInstanceOf(Date);
    expect(args.update).toMatchObject({ clase: 'empresa', esEmpresa: true, clasificadoPorId: 103 });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 103,
        accion: 'clasificacion.creada',
        entidad: 'clasificacion_producto',
        detalle: expect.objectContaining({ codigo: 'CERV-001', clase: 'empresa', esEmpresa: true }),
      }),
    );
    expect(dto).toMatchObject({ codigo: 'CERV-001', clase: 'empresa', esEmpresa: true });
  });

  /**
   * LA INVARIANTE, en las tres vias: `clase == 'empresa'` <=> `esEmpresa`.
   * `esEmpresa` NO llega del cuerpo -- se deriva -- asi que no hay forma de
   * escribir una sin la otra. Si esto se afloja, la liquidacion termina
   * mirando una columna distinta de la que miro la auditoria.
   */
  it.each([
    ['empresa', true],
    ['paquete', false],
    ['unidad', false],
  ] as const)('clase %s escribe esEmpresa %s en las DOS columnas', async (clase, esEmpresa) => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(filaClasificacion({ clase, esEmpresa }) as never);

    await clasificar(AUDITOR, 'CERV-001', { clase });

    const args = vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0];
    expect(args.create).toMatchObject({ clase, esEmpresa });
    expect(args.update).toMatchObject({ clase, esEmpresa });
  });

  it('reclasifica uno existente: auditoria "actualizada" con el valor ANTERIOR', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ clase: 'unidad', esEmpresa: false, nota: 'era del empleado' }) as never,
    );
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(
      filaClasificacion({ clase: 'paquete', esEmpresa: false }) as never,
    );

    await clasificar(AUDITOR, 'CERV-001', { clase: 'paquete' });

    // "paso de unidad a paquete" es la unica respuesta posible, seis meses
    // despues, a por que un faltante se descuenta distinto.
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'clasificacion.actualizada',
        detalle: expect.objectContaining({
          codigo: 'CERV-001',
          clase: 'paquete',
          esEmpresa: false,
          anterior: { clase: 'unidad', esEmpresa: false, empaqueCompraCorregido: null, nota: 'era del empleado' },
        }),
      }),
    );
  });

  /**
   * INVARIANTE 2: una excepcion VIEJA tiene `clase = NULL` y no se
   * reinterpreta. Al reclasificarla, la auditoria registra ese null tal cual
   * estaba -- rellenarlo con un valor seria inventar una decision que el
   * Auditor nunca tomo.
   */
  it('una excepcion vieja (clase NULL) queda registrada como null en el valor anterior', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ clase: null, esEmpresa: true, nota: 'vieja' }) as never,
    );
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(filaClasificacion({ clase: 'empresa' }) as never);

    await clasificar(AUDITOR, 'CERV-001', { clase: 'empresa' });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        detalle: expect.objectContaining({
          anterior: { clase: null, esEmpresa: true, empaqueCompraCorregido: null, nota: 'vieja' },
        }),
      }),
    );
  });

  it('la clase de una excepcion vieja viaja como null en el DTO, sin rellenarse', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(
      filaClasificacion({ clase: null, esEmpresa: true }) as never,
    );

    const dto = await clasificar(AUDITOR, 'CERV-001', { clase: 'empresa' });

    expect(dto.clase).toBeNull();
  });
});

/**
 * EL AUDITOR CORRIGE EL EMPAQUE DE COMPRA -- el caso medido: D365 tiene los
 * DORITOS con `PurchaseUnitSymbol = "U"` (se compra suelto) cuando vienen en
 * display. Con el empaque corregido la regla los clasifica sola, que es la
 * frase de Gilmer: "asi evitamos estar corrigiendo 1:1".
 *
 * CORREGIR EL EMPAQUE NO ES CORREGIR EL STOCK: el stock del ERP no se edita
 * desde ningun lado. Y esto tampoco pisa `CatalogoItem.empaqueCompra`, que es
 * el snapshot congelado -- se guarda AL LADO para que los dos numeros tengan
 * historia.
 */
describe('clasificar: el empaque de compra corregido', () => {
  it('lo escribe en la fila, junto a la clase', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(
      filaClasificacion({ clase: 'paquete', esEmpresa: false, empaqueCompraCorregido: 12 }) as never,
    );

    const dto = await clasificar(AUDITOR, '105621', { clase: 'paquete', empaqueCompraCorregido: 12 });

    const args = vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0];
    expect(args.create).toMatchObject({ clase: 'paquete', empaqueCompraCorregido: 12 });
    expect(args.update).toMatchObject({ clase: 'paquete', empaqueCompraCorregido: 12 });
    expect(dto.empaqueCompraCorregido).toBe(12);
  });

  /** Es un PUT: el cuerpo declara la excepcion entera, omitirlo borra la correccion. */
  it('sin el campo, la correccion queda en null: manda el del snapshot', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(filaClasificacion() as never);

    await clasificar(AUDITOR, 'CERV-001', { clase: 'empresa' });

    expect(vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0].create).toMatchObject({
      empaqueCompraCorregido: null,
    });
  });

  it('un null explicito tambien borra la correccion: deshacer es alcanzable', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ empaqueCompraCorregido: 12 }) as never,
    );
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(
      filaClasificacion({ empaqueCompraCorregido: null }) as never,
    );

    await clasificar(AUDITOR, '105621', { clase: 'paquete', empaqueCompraCorregido: null });

    expect(vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0].update).toMatchObject({
      empaqueCompraCorregido: null,
    });
  });

  /** Un cambio de empaque mueve plata de un cuadro al otro: va con su valor anterior. */
  it('queda en la auditoria con el antes y el despues', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ clase: 'paquete', empaqueCompraCorregido: null }) as never,
    );
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(
      filaClasificacion({ clase: 'paquete', empaqueCompraCorregido: 12 }) as never,
    );

    await clasificar(AUDITOR, '105621', { clase: 'paquete', empaqueCompraCorregido: 12 });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        detalle: expect.objectContaining({
          empaqueCompraCorregido: 12,
          anterior: expect.objectContaining({ empaqueCompraCorregido: null }),
        }),
      }),
    );
  });
});

describe('desclasificar: borra la fila, no la historia', () => {
  it('borra la fila y deja rastro en auditoria con el valor anterior', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ id: 7, clase: 'empresa', esEmpresa: true, nota: 'la asumia la empresa' }) as never,
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
          anterior: { clase: 'empresa', esEmpresa: true, empaqueCompraCorregido: null, nota: 'la asumia la empresa' },
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
    await expect(clasificar(coord, 'X', { clase: 'empresa' })).rejects.toMatchObject({ status: 403 });
    await expect(desclasificar(coord, 'X')).rejects.toMatchObject({ status: 403 });
  });
});

/**
 * CORREGIR SOLO EL EMPAQUE, SIN FORZAR NINGUN CUADRO.
 *
 * Es el caso MAS COMUN y era el unico imposible: `clase` era obligatoria, asi
 * que para guardar un empaque corregido habia que forzar ademas un cuadro --
 * y el cuadro forzado PISA lo derivado, con lo cual la correccion quedaba
 * escrita y sin efecto. El hallazgo salio del emulador (producto 100009).
 */
describe('clasificar: sin forzar cuadro', () => {
  it('guarda solo el empaque corregido, con clase null', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(
      filaClasificacion({ clase: null, esEmpresa: false, empaqueCompraCorregido: 12 }) as never,
    );

    const dto = await clasificar(AUDITOR, '105621', { empaqueCompraCorregido: 12 });

    const args = vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0];
    expect(args.create).toMatchObject({ clase: null, esEmpresa: false, empaqueCompraCorregido: 12 });
    expect(dto.clase).toBeNull();
  });

  /** La invariante 1 se sostiene igual: sin cuadro forzado no hay excepcion de empresa. */
  it('sin clase, esEmpresa queda en false', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(filaClasificacion({ clase: null }) as never);

    await clasificar(AUDITOR, '105621', { clase: null, empaqueCompraCorregido: 24 });

    expect(vi.mocked(prisma.clasificacionProducto.upsert).mock.calls[0]![0].create).toMatchObject({ esEmpresa: false });
  });

  it('y se puede volver a forzar un cuadro despues, sobre la misma fila', async () => {
    vi.mocked(prisma.clasificacionProducto.findUnique).mockResolvedValue(
      filaClasificacion({ clase: null, esEmpresa: false, empaqueCompraCorregido: 12 }) as never,
    );
    vi.mocked(prisma.clasificacionProducto.upsert).mockResolvedValue(
      filaClasificacion({ clase: 'empresa', esEmpresa: true, empaqueCompraCorregido: 12 }) as never,
    );

    await clasificar(AUDITOR, '105621', { clase: 'empresa', empaqueCompraCorregido: 12 });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        detalle: expect.objectContaining({ clase: 'empresa', anterior: expect.objectContaining({ clase: null }) }),
      }),
    );
  });
});
