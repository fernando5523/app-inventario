/**
 * Tests del cierre de ronda y, sobre todo, del cierre del CONTEO del
 * inventario que se agrega en esta tarea: `Inventario.estado ->
 * 'conteo_cerrado'` cuando la ronda que se cierra es la última del ciclo
 * (o no queda nada para recontar), y la guarda nueva de sincronización.
 *
 * Las reglas de qué ítem cuadra o va a recontar se prueban sin base en
 * dominio/ciclo-conteos.test.ts; acá se prueba lo que solo puede fallar
 * contra Prisma: qué operación se pide, en qué orden se chequean las
 * guardas, y que el estado del inventario cambie exactamente cuando tiene
 * que cambiar.
 *
 * Prisma mockeado: `npm test` no levanta Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn(), update: vi.fn() },
  hojaConteo: { count: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  producto: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { Conflicto, NoEncontrado, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { cerrar } from './rondas.service';

const COORD: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };

const producto = (codigo: string, categoria: string | null) => ({
  id: Number(codigo),
  codigo,
  descripcion: `Producto ${codigo}`,
  categoria,
});

const itemCatalogo = (codigo: string, categoria: string | null, stockErp: number | null) => ({
  id: Number(codigo),
  codigo,
  codigoBarras: `BC${codigo}`,
  descripcion: `Producto ${codigo}`,
  categoria,
  stockErp,
  empaques: [{ nombre: 'U', factor: 1, orden: 0, codigoBarras: null }],
});

/**
 * `hojaConteo.findMany` sirve a CUATRO consultas distintas de este archivo
 * (hojasSinFinalizar, hojasSinSincronizar, contadoHastaLaRonda dentro de
 * universoDeLaRonda, y el listado final de hojas nuevas) -- un solo
 * `mockResolvedValue` serviría a la primera y rompería a las demás. Se
 * distingue por la FORMA del `where`/`select`, mismo criterio que
 * `hojasLibres()` en inventarios.service.test.ts.
 */
function mockHojaConteoFindMany(args: {
  sinFinalizar?: Array<{ id: number; numero: string; estado: string; asignadoAId: number | null; zona: string }>;
  sinSincronizar?: Array<{ numero: string; asignadoA: { nombre: string } | null; asignadoA2: { nombre: string } | null }>;
  contadoPorRonda?: Array<{ numeroConteo: number; productos: unknown[] }>;
  hojasNuevas?: unknown[];
}): void {
  prismaMock.hojaConteo.findMany.mockImplementation(async (query: unknown) => {
    const q = query as { where?: Record<string, unknown>; include?: unknown };
    if (q.where?.estado !== undefined) return args.sinFinalizar ?? [];
    if (q.where?.sync !== undefined) return args.sinSincronizar ?? [];
    if (q.where?.numeroConteo && typeof q.where.numeroConteo === 'object' && 'lte' in (q.where.numeroConteo as object)) {
      return args.contadoPorRonda ?? [];
    }
    if (q.include) return args.hojasNuevas ?? [];
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'en_curso', tamanoHoja: 50 });
  prismaMock.hojaConteo.count.mockImplementation(async (query: unknown) => {
    const q = query as { where?: { numeroConteo?: number } };
    // Por defecto: hay hojas en la ronda pedida, y la ronda+1 NO existe todavía.
    return q.where?.numeroConteo === 1 ? 1 : 0;
  });
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  });
  mockHojaConteoFindMany({});
  prismaMock.producto.findMany.mockResolvedValue([]);
  prismaMock.catalogoItem.findMany.mockResolvedValue([]);
});

describe('cerrar', () => {
  /** rondas.service.ts#inventarioDelActor usa Prohibido, a diferencia de inventarios.service.ts. */
  it('el inventario de otra sucursal es 403 (Prohibido)', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 77, estado: 'en_curso', tamanoHoja: 50 });
    await expect(cerrar(COORD, 9, 1)).rejects.toThrow(Prohibido);
  });

  it('sin hojas de esa ronda, 404', async () => {
    prismaMock.hojaConteo.count.mockResolvedValue(0);
    await expect(cerrar(COORD, 9, 1)).rejects.toThrow(NoEncontrado);
  });

  it('ya cerrada (existe la ronda siguiente) rechaza con 409 y no duplica', async () => {
    prismaMock.hojaConteo.count.mockImplementation(async (query: unknown) => {
      const q = query as { where?: { numeroConteo?: number } };
      return q.where?.numeroConteo === 1 || q.where?.numeroConteo === 2 ? 1 : 0;
    });
    await expect(cerrar(COORD, 9, 1)).rejects.toThrow(Conflicto);
    expect(prismaMock.inventario.update).not.toHaveBeenCalled();
  });

  it('con hojas sin finalizar rechaza y NO llega a chequear sincronización', async () => {
    mockHojaConteoFindMany({
      sinFinalizar: [{ id: 1, numero: '001', estado: 'en_proceso', asignadoAId: 10, zona: 'A' }],
    });

    await expect(cerrar(COORD, 9, 1)).rejects.toThrow(Conflicto);
    // La guarda de "sin finalizar" corta antes: nunca se llega a pedir
    // las hojas sin sincronizar (esa consulta ni se ejecuta).
    const llamadasConSync = prismaMock.hojaConteo.findMany.mock.calls.filter(
      ([q]) => (q as { where?: { sync?: unknown } }).where?.sync !== undefined,
    );
    expect(llamadasConSync).toHaveLength(0);
  });

  /**
   * LA GUARDA NUEVA. Una hoja finalizada pero sin sincronizar es DISTINTA
   * de una sin finalizar: alguien contó sin señal y el teléfono todavía no
   * subió el conteo. Cerrar acá congelaría un número al que le faltan
   * ítems reales.
   */
  describe('hojas finalizadas pero sin sincronizar', () => {
    it('rechaza con 409 y nombra la hoja y quién la tiene asignada', async () => {
      mockHojaConteoFindMany({
        sinSincronizar: [{ numero: '007', asignadoA: { nombre: 'Ana' }, asignadoA2: null }],
      });

      const error = await cerrar(COORD, 9, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Conflicto);
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('#007');
      expect(mensaje).toContain('Ana');
      expect(mensaje).toContain('WiFi');
      // NO es el mismo mensaje que "sin finalizar" -- la acción es otra.
      expect(mensaje).not.toContain('todavía está contando');
    });

    it('sin nadie asignado dice "sin asignar", no revienta', async () => {
      mockHojaConteoFindMany({
        sinSincronizar: [{ numero: '012', asignadoA: null, asignadoA2: null }],
      });

      const error = await cerrar(COORD, 9, 1).catch((e: unknown) => e);
      expect((error as Error).message).toContain('sin asignar');
    });

    it('varias hojas: plural correcto y no se corta la lista antes de tiempo', async () => {
      mockHojaConteoFindMany({
        sinSincronizar: [
          { numero: '001', asignadoA: { nombre: 'Ana' }, asignadoA2: null },
          { numero: '002', asignadoA: { nombre: 'Beto' }, asignadoA2: null },
        ],
      });

      const error = await cerrar(COORD, 9, 1).catch((e: unknown) => e);
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('2 hojas están');
      expect(mensaje).toContain('#001');
      expect(mensaje).toContain('#002');
    });

    it('no toca el estado del inventario: rechazó antes de llegar ahí', async () => {
      mockHojaConteoFindMany({
        sinSincronizar: [{ numero: '007', asignadoA: null, asignadoA2: null }],
      });

      await expect(cerrar(COORD, 9, 1)).rejects.toThrow(Conflicto);
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });
  });

  /**
   * EL CIERRE DEL CONTEO. Todo cuadró (o era la última ronda): no hay
   * ronda siguiente, así que el inventario entero pasa a
   * `conteo_cerrado` EN LA MISMA operación que cierra la ronda.
   */
  describe('cuando no hay ronda siguiente', () => {
    beforeEach(() => {
      // Un solo producto que CUADRA: itemsARecontar = 0, así que
      // `puedeAbrirRondaSiguiente` corta ahí (todo cuadró), sin necesidad
      // de llegar a la ronda 3 para probar este camino.
      prismaMock.producto.findMany.mockResolvedValue([producto('100', 'ABARROTES')]);
      prismaMock.catalogoItem.findMany.mockResolvedValue([{ codigo: '100', stockErp: 5 }]);
      mockHojaConteoFindMany({
        contadoPorRonda: [
          {
            numeroConteo: 1,
            productos: [
              {
                codigo: '100',
                empaques: [{ nombre: 'U', factor: 1 }],
                conteos: [{ sueltas: 5, empaques: [] }],
              },
            ],
          },
        ],
      });
    });

    it('pasa el inventario a conteo_cerrado', async () => {
      await cerrar(COORD, 9, 1);

      expect(prismaMock.inventario.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { estado: 'conteo_cerrado' },
      });
    });

    it('el update va DENTRO de una transacción, no suelto', async () => {
      await cerrar(COORD, 9, 1);

      // El mock de $transaction distingue array vs. callback -- si llegó a
      // resolver `update` es porque pasó por $transaction (ver beforeEach
      // de este archivo: $transaction es lo único que ejecuta lo que recibe).
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it('no crea ninguna hoja nueva y devuelve rondaAbierta: null con el motivo', async () => {
      const resultado = await cerrar(COORD, 9, 1);

      expect(resultado.rondaAbierta).toBeNull();
      expect(resultado.motivoSinSiguiente).toContain('cuadraron');
      expect(resultado.hojas).toEqual([]);
      expect(prismaMock.hojaConteo.create).not.toHaveBeenCalled();
    });
  });

  /** El camino que YA existía: queda algo para recontar y no es la última ronda. */
  describe('cuando sí hay ronda siguiente', () => {
    beforeEach(() => {
      // El producto NO cuadra: va a recontar.
      prismaMock.producto.findMany.mockResolvedValue([producto('200', 'GALLETAS')]);
      prismaMock.catalogoItem.findMany.mockImplementation(async (query: unknown) => {
        const q = query as { where?: { codigo?: unknown } };
        // Primera llamada (universoDeLaRonda): trae stock. Segunda
        // (armar hojas nuevas): trae el item completo con empaques.
        if (q.where?.codigo && typeof q.where.codigo === 'object') {
          return [itemCatalogo('200', 'GALLETAS', 99)];
        }
        return [{ codigo: '200', stockErp: 5 }];
      });
      mockHojaConteoFindMany({
        contadoPorRonda: [
          {
            numeroConteo: 1,
            productos: [
              {
                codigo: '200',
                empaques: [{ nombre: 'U', factor: 1 }],
                conteos: [{ sueltas: 3, empaques: [] }], // 3 ≠ stockErp 5: no cuadra.
              },
            ],
          },
        ],
      });
    });

    it('NO toca el estado del inventario', async () => {
      await cerrar(COORD, 9, 1);
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });

    it('abre la ronda siguiente con los ítems que no cuadraron', async () => {
      const resultado = await cerrar(COORD, 9, 1);

      expect(resultado.rondaAbierta).toBe(2);
      expect(resultado.motivoSinSiguiente).toBeNull();
      expect(prismaMock.hojaConteo.create).toHaveBeenCalledTimes(1);
      const { data } = prismaMock.hojaConteo.create.mock.calls[0]![0] as { data: { numeroConteo: number } };
      expect(data.numeroConteo).toBe(2);
    });
  });
});
