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
  hojaConteo: { count: vi.fn(), findMany: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
  producto: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  colaborador: { count: vi.fn() },
  asistenciaInventario: { findMany: vi.fn() },
  justificacionAsistencia: { findMany: vi.fn() },
  resultadoInventario: { create: vi.fn() },
  diferenciaItem: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { Conflicto, NoEncontrado, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { abrirRondaExtra, cerrar, cerrarAjuste, iniciarAjuste, resumen } from './rondas.service';

const COORD: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: 1, rol: 'coordinador' };
// El auditor NO pertenece a ninguna tienda (decision del cliente): `sucursalId`
// en null, y aun asi llega a cualquier sucursal.
const AUDITOR: ColaboradorAutenticado = { colaboradorId: 8, sucursalId: null, rol: 'auditor' };

const producto = (codigo: string, categoria: string | null) => ({
  id: Number(codigo),
  codigo,
  descripcion: `Producto ${codigo}`,
  categoria,
});

/** Lo mínimo de un `Prisma.Decimal` que consume `armarMatriz`. */
const decimal = (valor: number) => ({ toNumber: () => valor });

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
 * `hojaConteo.findMany` sirve a CUATRO consultas distintas en este camino
 * (hojasSinFinalizar, hojasSinSincronizar, contadoHastaLaRonda dentro de
 * universoDeLaRonda, el listado final de hojas nuevas, y -- cuando se
 * cierra el conteo -- `armarMatriz` de auditoria.service.ts) -- un solo
 * `mockResolvedValue` serviría a la primera y rompería a las demás. Se
 * distingue por la FORMA del `where`/`select`, mismo criterio que
 * `hojasLibres()` en inventarios.service.test.ts.
 *
 * OJO: `hojasSinFinalizar` filtra `estado: { not: 'finalizada' }` (OBJETO)
 * y `armarMatriz` filtra `estado: 'finalizada'` (STRING) -- confundirlas
 * fue el primer intento de este mock, y hacía que `armarMatriz` recibiera
 * "sin hojas finalizadas" en vez de los datos reales de la ronda.
 */
function mockHojaConteoFindMany(args: {
  sinFinalizar?: Array<{ id: number; numero: string; estado: string; asignadoAId: number | null; zona: string }>;
  sinSincronizar?: Array<{ numero: string; asignadoA: { nombre: string } | null; asignadoA2: { nombre: string } | null }>;
  contadoPorRonda?: Array<{ numeroConteo: number; productos: unknown[] }>;
  hojasNuevas?: unknown[];
  matrizHojasFinalizadas?: unknown[];
}): void {
  prismaMock.hojaConteo.findMany.mockImplementation(async (query: unknown) => {
    const q = query as { where?: Record<string, unknown>; include?: unknown; select?: Record<string, unknown> };
    const whereEstado = q.where?.estado;
    if (typeof whereEstado === 'string') return args.matrizHojasFinalizadas ?? [];
    if (whereEstado !== undefined) return args.sinFinalizar ?? [];
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
  // Sin marcas por defecto: los tests que no son sobre asistencia no tienen que
  // saber que existe, pero `cerrar` la lee siempre al cerrar el conteo.
  prismaMock.asistenciaInventario.findMany.mockResolvedValue([]);
  prismaMock.justificacionAsistencia.findMany.mockResolvedValue([]);
  prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'en_curso', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
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
  prismaMock.colaborador.count.mockResolvedValue(0);
});

describe('resumen: el embudo de una ronda, también para un inventario YA cerrado', () => {
  it('conteo_cerrado NO tira 409: el ciclo terminado igual se puede consultar (pantalla de Ciclo / Auditor)', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'conteo_cerrado', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    prismaMock.hojaConteo.count.mockResolvedValue(1); // la ronda tiene hojas

    await expect(resumen(COORD, 9, 2)).resolves.toMatchObject({ inventarioId: 9, ronda: 2 });
  });

  it('otra sucursal: Prohibido, aunque sea de solo lectura', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 77, estado: 'conteo_cerrado', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    await expect(resumen(COORD, 9, 2)).rejects.toBeInstanceOf(Prohibido);
  });

  it('la ronda no tiene hojas: NoEncontrado, no un embudo vacío que miente', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'conteo_cerrado', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    prismaMock.hojaConteo.count.mockResolvedValue(0);
    await expect(resumen(COORD, 9, 2)).rejects.toBeInstanceOf(NoEncontrado);
  });

  it('REPRODUCE EL CASO DEL CLIENTE: 3 rondas cerradas con conteos completos -> el embudo REAL de una ronda', async () => {
    // El "1 de 10" del bug salía de leer el SQLite LOCAL del que mira; esto
    // sale del SERVER, sobre TODOS los conteos. Ronda 2: 2 ítems, ambos
    // contados; A cuadra (5=5), B no (4≠3) -> 1 cuadrado, 1 a recontar.
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'conteo_cerrado', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    prismaMock.hojaConteo.count.mockResolvedValue(1);
    prismaMock.producto.findMany.mockResolvedValue([producto('A', 'Lácteos'), producto('B', 'Lácteos')]);
    prismaMock.catalogoItem.findMany.mockResolvedValue([itemCatalogo('A', 'Lácteos', 5), itemCatalogo('B', 'Lácteos', 3)]);
    mockHojaConteoFindMany({
      sinFinalizar: [],
      contadoPorRonda: [
        {
          numeroConteo: 2,
          productos: [
            { codigo: 'A', empaques: [{ nombre: 'U', factor: 1 }], conteos: [{ sueltas: 5, empaques: [] }] },
            { codigo: 'B', empaques: [{ nombre: 'U', factor: 1 }], conteos: [{ sueltas: 4, empaques: [] }] },
          ],
        },
      ],
    });

    const r = await resumen(COORD, 9, 2);
    expect(r.total).toBe(2);
    expect(r.contados).toBe(2); // los DOS ítems tienen conteo -- no "1 de 10"
    expect(r.cuadrados).toBe(1); // A: 5 = 5
    expect(r.aRecontar).toBe(1); // B: 4 ≠ 3
    expect(r.sePuedeCerrar).toBe(true); // ninguna hoja sin finalizar
  });
});

describe('cerrar', () => {
  /** rondas.service.ts#inventarioDelActor usa Prohibido, a diferencia de inventarios.service.ts. */
  it('el inventario de otra sucursal es 403 (Prohibido)', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 77, estado: 'en_curso', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
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
   * CERRAR LA ULTIMA RONDA YA NO CIERRA EL CONTEO.
   *
   * Hasta este cambio, esta rama pasaba el inventario a `conteo_cerrado`,
   * escribia `ResultadoInventario` y liberaba `abierto`, todo en la misma
   * transaccion. Ahora el inventario QUEDA `en_curso` esperando al Auditor,
   * que abre otra pasada o inicia el ajuste final (pedido del cliente).
   *
   * Los tests que verificaban aquel cierre NO se borraron ni se aflojaron:
   * estan enteros, con las mismas assertions, en `describe('cerrarAjuste')`,
   * que es la funcion que ahora cierra el conteo. Lo que se prueba ACA es lo
   * contrario -- que `cerrar` no toque nada de eso --, porque el riesgo
   * cambio de lado: antes era cerrar de menos, ahora es cerrar de mas.
   */
  describe('cuando no hay ronda siguiente: el conteo NO cierra, espera al Auditor', () => {
    beforeEach(() => {
      // Un solo producto que CUADRA: itemsARecontar = 0, así que
      // `puedeAbrirRondaSiguiente` corta ahí (todo cuadró).
      prismaMock.producto.findMany.mockResolvedValue([producto('100', 'ABARROTES')]);
      prismaMock.catalogoItem.findMany.mockResolvedValue([{ codigo: '100', stockErp: 5 }]);
      mockHojaConteoFindMany({
        contadoPorRonda: [
          {
            numeroConteo: 1,
            productos: [
              { codigo: '100', empaques: [{ nombre: 'U', factor: 1 }], conteos: [{ sueltas: 5, empaques: [] }] },
            ],
          },
        ],
      });
    });

    it('NO pasa el inventario a conteo_cerrado', async () => {
      await cerrar(COORD, 9, 1);
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });

    /**
     * NO LIBERAR `abierto` ACA ES LA MITAD QUE FALTABA DEL BUG DE 2026-09-10.
     *
     * Aquel bug era que la sucursal quedaba bloqueada durante los dias que
     * tarda la firma del auditor, y se arreglo liberando `abierto` al cerrar
     * el CONTEO en vez de al lacrar. Eso sigue igual: lo hace `cerrarAjuste`,
     * que es lo que cierra el conteo ahora.
     *
     * Liberarlo aca seria pasarse de largo en la direccion opuesta: el
     * inventario todavia se esta decidiendo, y con `abierto` en null el
     * `@@unique([sucursalId, abierto])` deja abrir el del mes que viene
     * ENCIMA de este. Dos inventarios vivos en la misma tienda es el problema
     * que ese indice existe para impedir.
     */
    it('NO libera `abierto`: el inventario sigue ocupando la sucursal hasta que cierre el conteo', async () => {
      await cerrar(COORD, 9, 1);
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
    });

    it('NO escribe ResultadoInventario ni diferencias: eso se congela al cerrar el ajuste', async () => {
      await cerrar(COORD, 9, 1);
      expect(prismaMock.resultadoInventario.create).not.toHaveBeenCalled();
      expect(prismaMock.diferenciaItem.createMany).not.toHaveBeenCalled();
    });

    it('no crea ninguna hoja nueva y devuelve rondaAbierta: null con el motivo', async () => {
      const resultado = await cerrar(COORD, 9, 1);

      expect(resultado.rondaAbierta).toBeNull();
      expect(resultado.motivoSinSiguiente).toContain('cuadraron');
      expect(resultado.hojas).toEqual([]);
      expect(prismaMock.hojaConteo.create).not.toHaveBeenCalled();
    });

    /**
     * `rondaAbierta: null` significa UNA sola cosa ahora: le toca al Auditor.
     * Antes era ambiguo -- podia ser eso o "el conteo cerro" -- y la pantalla
     * no tenia como distinguirlo.
     *
     * OJO CON EL TEXTO, que no es igual en los dos caminos. Al agotar el
     * ciclo, el motivo nombra al Auditor ("Sigue el Auditor: puede abrir otra
     * pasada o iniciar el ajuste final"). Cuando todo cuadro, NO: dice
     * "Todos los ítems cuadraron... no queda nada para recontar" y se queda
     * ahi. Bajo el flujo viejo eso alcanzaba, porque ese mensaje acompañaba
     * un cierre de verdad; ahora el inventario sigue abierto y el texto no lo
     * dice. La pantalla no puede deducir el estado del texto -- por eso este
     * test se apoya en `rondaAbierta`, que si es inequivoco.
     */
    it('los DOS caminos dejan rondaAbierta en null y el inventario sin cerrar', async () => {
      const todoCuadro = await cerrar(COORD, 9, 1);
      expect(todoCuadro.rondaAbierta).toBeNull();
      expect(todoCuadro.motivoSinSiguiente).toContain('cuadraron');
      expect(prismaMock.inventario.update).not.toHaveBeenCalled();
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

/**
 * EL TRAMO DEL AUDITOR. Los tres botones que existen porque cerrar la ultima
 * ronda ya no cierra el conteo.
 */
describe('abrirRondaExtra: el Auditor abre un 4to conteo', () => {
  beforeEach(() => {
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 3 } });
    // El producto NO cuadra: queda algo para recontar.
    prismaMock.producto.findMany.mockResolvedValue([producto('200', 'GALLETAS')]);
    prismaMock.catalogoItem.findMany.mockImplementation(async (query: unknown) => {
      const q = query as { where?: { codigo?: unknown } };
      if (q.where?.codigo && typeof q.where.codigo === 'object') return [itemCatalogo('200', 'GALLETAS', 99)];
      return [{ codigo: '200', stockErp: 5 }];
    });
    mockHojaConteoFindMany({
      contadoPorRonda: [
        {
          numeroConteo: 3,
          productos: [
            { codigo: '200', empaques: [{ nombre: 'U', factor: 1 }], conteos: [{ sueltas: 3, empaques: [] }] },
          ],
        },
      ],
    });
  });

  /**
   * LO QUE ESTE BOTON EXISTE PARA HACER: pasar el limite de 3 rondas. Si
   * mirara `RONDAS_DEL_CICLO` como lo hace `cerrar`, la ronda 4 seria
   * imposible y el pedido del cliente no estaria implementado.
   */
  it('abre la ronda 4 aunque el ciclo automatico sean 3', async () => {
    const r = await abrirRondaExtra(AUDITOR, 9);

    expect(r.ronda).toBe(4);
    const { data } = prismaMock.hojaConteo.create.mock.calls[0]![0] as { data: { numeroConteo: number } };
    expect(data.numeroConteo).toBe(4);
  });

  it('las hojas nuevas nacen SIN asignar: quien recuenta lo decide el Coordinador', async () => {
    await abrirRondaExtra(AUDITOR, 9);
    const { data } = prismaMock.hojaConteo.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data['asignadoAId']).toBeUndefined();
  });

  /**
   * CONTEO CIEGO: la hoja de la ronda extra materializa sus PROPIOS
   * `Producto`, sin stock ni precio y sin ningun `Conteo`. Si trajera el
   * valor anterior, el contador lo confirmaria en vez de contar.
   */
  it('los productos de la ronda extra no llevan stock ni conteos previos', async () => {
    await abrirRondaExtra(AUDITOR, 9);
    const { data } = prismaMock.hojaConteo.create.mock.calls[0]![0] as {
      data: { productos: { create: Array<Record<string, unknown>> } };
    };
    for (const prod of data.productos.create) {
      expect(prod['stockErp']).toBeUndefined();
      expect(prod['precioVenta']).toBeUndefined();
      expect(prod['conteos']).toBeUndefined();
    }
  });

  it('el Coordinador NO puede: el tramo extra lo decide el Auditor', async () => {
    await expect(abrirRondaExtra(COORD, 9)).rejects.toThrow(Prohibido);
  });

  it('con el ajuste ya iniciado, 409: no se vuelve atras', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'ajuste_auditor', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    await expect(abrirRondaExtra(AUDITOR, 9)).rejects.toThrow(Conflicto);
    expect(prismaMock.hojaConteo.create).not.toHaveBeenCalled();
  });

  it('si todo cuadro no abre nada: mandar a contar una hoja vacia no es cero trabajo', async () => {
    prismaMock.catalogoItem.findMany.mockImplementation(async (query: unknown) => {
      const q = query as { where?: { codigo?: unknown } };
      if (q.where?.codigo && typeof q.where.codigo === 'object') return [itemCatalogo('200', 'GALLETAS', 3)];
      return [{ codigo: '200', stockErp: 3 }]; // 3 == contado: cuadra
    });
    await expect(abrirRondaExtra(AUDITOR, 9)).rejects.toThrow(Conflicto);
    expect(prismaMock.hojaConteo.create).not.toHaveBeenCalled();
  });

  it('con hojas sin finalizar en la ultima ronda, 409: alguien todavia esta contando', async () => {
    mockHojaConteoFindMany({
      sinFinalizar: [{ id: 1, numero: '004', estado: 'en_proceso', asignadoAId: 7, zona: 'GALLETAS' }],
    });
    await expect(abrirRondaExtra(AUDITOR, 9)).rejects.toThrow(Conflicto);
    expect(prismaMock.hojaConteo.create).not.toHaveBeenCalled();
  });
});

describe('iniciarAjuste: el boton que arranca el ajuste final', () => {
  beforeEach(() => {
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 3 } });
  });

  it('pasa el inventario a ajuste_auditor', async () => {
    const r = await iniciarAjuste(AUDITOR, 9);

    expect(prismaMock.inventario.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { estado: 'ajuste_auditor' },
    });
    expect(r).toMatchObject({ estado: 'ajuste_auditor', ronda: 3 });
  });

  /**
   * NO LIBERA `abierto`. El inventario sigue siendo el abierto de la
   * sucursal mientras el Auditor trabaja: soltarlo aca dejaria abrir el del
   * mes que viene encima de uno que todavia se esta decidiendo.
   */
  it('NO libera `abierto`: el inventario sigue ocupando la sucursal', async () => {
    await iniciarAjuste(AUDITOR, 9);
    const { data } = prismaMock.inventario.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('abierto');
  });

  it('el Coordinador NO', async () => {
    await expect(iniciarAjuste(COORD, 9)).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.update).not.toHaveBeenCalled();
  });

  it('iniciarlo dos veces, 409', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'ajuste_auditor', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    await expect(iniciarAjuste(AUDITOR, 9)).rejects.toThrow(Conflicto);
  });

  it('con hojas sin finalizar, 409: no se decide el valor final sobre un conteo a medias', async () => {
    mockHojaConteoFindMany({
      sinFinalizar: [{ id: 1, numero: '004', estado: 'en_proceso', asignadoAId: 7, zona: 'GALLETAS' }],
    });
    await expect(iniciarAjuste(AUDITOR, 9)).rejects.toThrow(Conflicto);
    expect(prismaMock.inventario.update).not.toHaveBeenCalled();
  });
});

/**
 * EL CIERRE DEL CONTEO, QUE SE MUDO ACA DESDE `cerrar`.
 *
 * Todos los tests de este bloque estaban en `cerrar > cuando no hay ronda
 * siguiente` y en `cerrar > cuando cierra la ronda 3 con diferencias`. NO se
 * cambio ni una assertion: lo unico que cambio es QUIEN dispara el cierre --
 * antes la ultima ronda, ahora el Auditor al terminar su ajuste. Lo que se
 * congela, en que transaccion y con que reglas es identico, y tiene que
 * seguir siendolo.
 */
describe('cerrarAjuste: el ajuste cierra y con el, el conteo', () => {
  const hojaFinalizadaParaMatriz = {
    numeroConteo: 1,
    zona: 'ABARROTES',
    productos: [
      {
        id: 100,
        codigo: '100',
        descripcion: 'Producto 100',
        empaques: [{ nombre: 'U', factor: 1 }],
        conteos: [{ sueltas: 5, empaques: [] }],
      },
    ],
  };

  beforeEach(() => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'ajuste_auditor', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    prismaMock.catalogoItem.findMany.mockResolvedValue([
      { codigo: '100', descripcion: 'Producto 100', stockErp: 5, precioVenta: null, esEmpresa: false },
    ]);
    prismaMock.colaborador.count.mockResolvedValue(11);
    mockHojaConteoFindMany({ matrizHojasFinalizadas: [hojaFinalizadaParaMatriz] });
  });

  it('pasa el inventario a conteo_cerrado Y libera `abierto` -- bug real 2026-09-10', async () => {
    // `abierto: null` tiene que salir del cierre del CONTEO, no recien al
    // lacrar: la firma del auditor puede tardar dias, y hasta ese fix la
    // sucursal quedaba bloqueada para el mes siguiente todo ese tiempo (ver
    // el comentario de Inventario.abierto en el schema). Lo que cambio con el
    // ajuste final es CUAL operacion cierra el conteo, no que el cierre
    // libere la sucursal.
    await cerrarAjuste(AUDITOR, 9);

    expect(prismaMock.inventario.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { estado: 'conteo_cerrado', abierto: null },
    });
  });

  it('el update va DENTRO de una transacción, no suelto', async () => {
    await cerrarAjuste(AUDITOR, 9);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  /**
   * LA CONDICIÓN QUE HACE LA DIFERENCIA: un 0 que significa "no sabemos" no
   * puede verse igual que un 0 que significa "nadie faltó" (mismo criterio
   * que CatalogoItem.stockErp). Los ajustes del mes no tienen dónde cargarse
   * todavía: el cierre persiste NULL, nunca 0.
   */
  it('persiste los ajustes del mes en NULL, no en 0', async () => {
    await cerrarAjuste(AUDITOR, 9);

    expect(prismaMock.resultadoInventario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ inventarioId: 9, montoNegativos: null }),
    });
  });

  describe('congela la asistencia registrada', () => {
    const DIAS = ['2026-09-01', '2026-09-02', '2026-09-03'].map((d) => new Date(`${d}T00:00:00.000Z`));

    beforeEach(() => {
      prismaMock.asistenciaInventario.findMany.mockResolvedValue([
        ...[7, 9].flatMap((id) => DIAS.map((dia) => ({ colaboradorId: id, dia }))),
        ...DIAS.slice(0, 2).map((dia) => ({ colaboradorId: 11, dia })),
      ]);
    });

    it('cuenta a los que hicieron TODOS los días, no a los que vinieron alguna vez', async () => {
      // El 11 vino 2 de 3: NO entra. `colaboradoresAsistieron` es el divisor
      // del fondo de multas -- contarlo ahí le daría bono a quien además
      // paga multa, y el reparto dejaría de cerrar.
      await cerrarAjuste(AUDITOR, 9);

      expect(prismaMock.resultadoInventario.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ colaboradoresAsistieron: 2 }),
      });
    });

    it('congela los DIAS del inventario: el denominador de todas las multas', async () => {
      // Sin esto, una marca cargada -- o borrada -- en noviembre cambiaría la
      // multa de agosto, de un sueldo que ya se pagó.
      await cerrarAjuste(AUDITOR, 9);

      expect(prismaMock.resultadoInventario.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ diasDelInventario: 3 }),
      });
    });

    it('sin una sola marca, cero días y cero asistentes -- no revienta', async () => {
      prismaMock.asistenciaInventario.findMany.mockResolvedValue([]);
      await cerrarAjuste(AUDITOR, 9);

      expect(prismaMock.resultadoInventario.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ diasDelInventario: 0, colaboradoresAsistieron: 0 }),
      });
    });

    /**
     * EL MOMENTO SE CORRIO, y es a favor de la gente: la asistencia queda
     * firme al cerrar el AJUSTE, no al cerrar la ultima ronda. El inventario
     * sigue en curso mientras el Auditor trabaja, asi que quien fue a la
     * tienda esos dias todavia puede quedar marcado.
     */
    it('lee las marcas al cerrar el ajuste, no antes', async () => {
      await cerrarAjuste(AUDITOR, 9);
      expect(prismaMock.asistenciaInventario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { inventarioId: 9 } }),
      );
    });
  });

  it('los campos SÍ calculables salen de la matriz real, no de un placeholder', async () => {
    await cerrarAjuste(AUDITOR, 9);

    const { data } = prismaMock.resultadoInventario.create.mock.calls[0]![0] as {
      data: {
        itemsTotales: number;
        itemsConDiferencia: number;
        unidadesFaltantes: number;
        unidadesSobrantes: number;
        montoFaltanteBruto: number;
        montoFaltanteEmpresa: number;
        colaboradoresAlcanzados: number;
      };
    };
    // El producto cuadra (conteo 5 = stockErp 5): nada de diferencia.
    expect(data.itemsTotales).toBe(1);
    expect(data.itemsConDiferencia).toBe(0);
    expect(data.unidadesFaltantes).toBe(0);
    expect(data.unidadesSobrantes).toBe(0);
    expect(data.montoFaltanteBruto).toBe(0);
    expect(data.montoFaltanteEmpresa).toBe(0);
    // TODO el personal habilitado de la sucursal (mock: 11), no un valor fijo.
    expect(data.colaboradoresAlcanzados).toBe(11);
    // Solo roles de tienda: el auditor y el administrador no cuentan, ni con
    // un sucursalId viejo en su ficha (decision del cliente).
    expect(prismaMock.colaborador.count).toHaveBeenCalledWith({
      where: { sucursalId: 1, activo: true, rol: { in: ['coordinador', 'conteo'] } },
    });
  });

  it('todo cuadró: no escribe NINGUNA fila de diferencias', async () => {
    await cerrarAjuste(AUDITOR, 9);

    const { data } = prismaMock.diferenciaItem.createMany.mock.calls[0]![0] as { data: unknown[] };
    expect(data).toEqual([]);
  });

  it('el Coordinador NO cierra el ajuste', async () => {
    await expect(cerrarAjuste(COORD, 9)).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.update).not.toHaveBeenCalled();
  });

  it('sin el ajuste iniciado, 409 y no escribe nada', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: 9, sucursalId: 1, estado: 'en_curso', tamanoHoja: 50, umbralMediaUnidadPaquete: decimal(0.5) });
    await expect(cerrarAjuste(AUDITOR, 9)).rejects.toThrow(Conflicto);
    expect(prismaMock.resultadoInventario.create).not.toHaveBeenCalled();
  });

  /**
   * EL CASO REAL: quedan diferencias. El conteo cierra CON faltantes, que es
   * lo que se va a ajustar en el ERP y lo que se le va a descontar a alguien.
   *
   * Las reglas de qué fila entra están probadas sin base en
   * auditoria.calculos.test.ts#diferenciasParaPersistir. Acá se prueba lo
   * único que solo puede fallar contra Prisma: que esas filas se ESCRIBAN, y
   * que se escriban en la misma transacción que el resultado.
   */
  describe('cuando quedan diferencias', () => {
    const hojaConFaltante = {
      numeroConteo: 3,
      zona: 'ABARROTES',
      productos: [
        {
          id: 300,
          codigo: '300',
          descripcion: 'Aceite Primor 900ml',
          empaques: [{ nombre: 'U', factor: 1 }],
          conteos: [{ sueltas: 7, empaques: [] }],
        },
      ],
    };

    beforeEach(() => {
      prismaMock.catalogoItem.findMany.mockResolvedValue([
        // `precioVenta` es Decimal en Prisma y `armarMatriz` le pide
        // `.toNumber()`: un 4 pelado acá pasaría el test y reventaría contra
        // la base real.
        { codigo: '300', descripcion: 'Aceite Primor 900ml', stockErp: 10, precioVenta: decimal(4), esEmpresa: false },
      ]);
      mockHojaConteoFindMany({ matrizHojasFinalizadas: [hojaConFaltante] });
    });

    it('persiste el detalle ítem por ítem, no solo los totales', async () => {
      await cerrarAjuste(AUDITOR, 9);

      expect(prismaMock.diferenciaItem.createMany).toHaveBeenCalledWith({
        data: [
          {
            inventarioId: 9,
            codigo: '300',
            // `clase` la congela `diferenciasParaPersistir`: es la regla con la
            // que se liquidó este ítem (cuadro único / por paquete / empresa).
            // Sin empaque de compra, `unidad`.
            clase: 'unidad',
            descripcion: 'Aceite Primor 900ml',
            stockSistema: 10,
            conteoFinal: 7,
            diferencia: -3,
            resueltoEnConteo: 3,
            precioUnitario: 4,
            montoDiferencia: -12,
          },
        ],
        skipDuplicates: true,
      });
    });

    /**
     * LA INVARIANTE, del lado de la base: el detalle y el total salen de la
     * MISMA matriz y de la MISMA transacción. Si se escribieran en dos
     * momentos distintos podrían discrepar -- y el sello del lacrado los
     * hashea juntos, donde una discrepancia no se detecta: se firma.
     */
    it('el detalle concuerda con los totales del resultado', async () => {
      await cerrarAjuste(AUDITOR, 9);

      const { data: filas } = prismaMock.diferenciaItem.createMany.mock.calls[0]![0] as {
        data: Array<{ diferencia: number }>;
      };
      const { data: resultado } = prismaMock.resultadoInventario.create.mock.calls[0]![0] as {
        data: { itemsConDiferencia: number; unidadesFaltantes: number; unidadesSobrantes: number };
      };

      expect(filas.length).toBe(resultado.itemsConDiferencia);
      expect(filas.filter((f) => f.diferencia < 0).reduce((t, f) => t + -f.diferencia, 0)).toBe(
        resultado.unidadesFaltantes,
      );
      expect(filas.filter((f) => f.diferencia > 0).reduce((t, f) => t + f.diferencia, 0)).toBe(
        resultado.unidadesSobrantes,
      );
    });

    it('las diferencias van en la MISMA transacción que el estado y el resultado', async () => {
      // Si el estado quedara cerrado y las diferencias no se escribieran, el
      // lacrado sellaría un documento vacío sin que nadie se entere. Los tres
      // hechos son uno solo.
      await cerrarAjuste(AUDITOR, 9);

      const [arg] = prismaMock.$transaction.mock.calls[0] as [unknown];
      expect(Array.isArray(arg)).toBe(true);
      expect((arg as unknown[]).length).toBe(3);
    });

    it('si la transacción falla, no queda ni resultado ni diferencias', async () => {
      // `mockRejectedValue`, no `...Once`: con `Once`, si algo revienta ANTES
      // de llegar a $transaction el rechazo queda cargado y se lo come el
      // test siguiente.
      prismaMock.$transaction.mockRejectedValue(new Error('conexión caída'));

      await expect(cerrarAjuste(AUDITOR, 9)).rejects.toThrow('conexión caída');
      // El cierre no llegó a auditarse: no hay un "el ajuste cerró" mintiendo
      // en el registro sobre algo que no pasó.
      const { registrarAuditoria } = await import('../../shared/auditoria');
      expect(registrarAuditoria).not.toHaveBeenCalled();
    });

    /**
     * EL AJUSTE DEL AUDITOR ENTRA EN EL CIERRE. Escribe sobre el `Conteo` de
     * la ultima ronda, que es de donde `armarMatriz` lee: el valor congelado
     * es el ajustado, no el que habia antes. Si no fuera asi, todo el tramo
     * nuevo no serviria para nada.
     */
    it('congela el valor AJUSTADO, que es el que la matriz lee de la ultima ronda', async () => {
      await cerrarAjuste(AUDITOR, 9);

      const { data } = prismaMock.diferenciaItem.createMany.mock.calls[0]![0] as {
        data: Array<{ conteoFinal: number; resueltoEnConteo: number }>;
      };
      expect(data[0]!.conteoFinal).toBe(7);
      expect(data[0]!.resueltoEnConteo).toBe(3);
    });
  });
});
