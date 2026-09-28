/**
 * `GET /api/auditoria/cadena/diferencias/exportar` DE PUNTA A PUNTA DEL SERVICE,
 * con Prisma mockeado (no hay Postgres en `npm test`, mismo estilo que
 * auditoria.service.test.ts).
 *
 * Lo que este archivo prueba es lo que NO se puede probar sin recorrer tiendas:
 *
 *   1. LAS DIEZ TIENDAS ENTRAN EN UNA SOLA HOJA, con la columna `Sucursal`
 *      distinta por fila y ordenadas por nombre. Una tabla dinamica lee UNA
 *      tabla contigua, no diez hojas -- esa columna es lo que hace util al
 *      consolidado.
 *   2. UNA TIENDA SIN INVENTARIO NO APORTA FILAS. No es esconderla: la cobertura
 *      del periodo la reporta la tabla con su fila en cero; este archivo es el
 *      detalle de las diferencias, y quien no arranco no tiene ninguna.
 *   3. UN INVENTARIO ANULADO QUEDA AFUERA, con la MISMA clausula que la tabla.
 *   4. LA TABLA Y EL ARCHIVO ELIGEN EL MISMO INVENTARIO Y CIERRAN AL CENTAVO.
 *      Es la razon de existir de `inventariosDelPeriodo`: si se separaran, el
 *      Auditor bajaria el detalle para explicar una cifra de la tabla y el
 *      detalle no sumaria esa cifra -- el peor resultado posible de este
 *      endpoint, peor que no tenerlo.
 *   5. EL PERIODO SIN `anio`/`mes` SALE DEL RELOJ DEL SERVIDOR, igual que en la
 *      tabla, y el nombre del archivo lo dice (el front no conoce ese mes).
 */

import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';

const prismaMock = vi.hoisted(() => ({
  sucursal: { findMany: vi.fn() },
  inventario: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  hojaConteo: { findMany: vi.fn() },
  clasificacionProducto: { findMany: vi.fn() },
  diferenciaItem: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { cadena, exportarDiferenciasDeLaCadena } from './auditoria.service';
import { ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA } from './auditoria.exportar-diferencias';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };

const LUZURIAGA = { id: 1, nombre: 'Market Luzuriaga' };
const CARHUAZ = { id: 2, nombre: 'Market Carhuaz' };
const SUCRE = { id: 4, nombre: 'Market Sucre' };

/** Una fila de `Inventario` como la devuelve Prisma (umbral es `Decimal`). */
function inventario(id: number, sucursalId: number, tipo = 'mensual', estado = 'ajuste_auditor') {
  return { id, sucursalId, estado, tipo, umbralMediaUnidadPaquete: { toNumber: () => 0.5 } };
}

/** Una fila de `CatalogoItem` del snapshot (precio es `Decimal`). */
function catalogo(parcial: {
  codigo: string;
  stockErp: number | null;
  precioVenta?: number | null;
  esEmpresa?: boolean;
  clase?: 'unidad' | 'paquete' | 'empresa';
  empaqueCompra?: number | null;
  empaqueCompraSimbolo?: string | null;
}) {
  const precio = parcial.precioVenta === undefined ? 10 : parcial.precioVenta;
  return {
    codigo: parcial.codigo,
    descripcion: `Producto ${parcial.codigo}`,
    stockErp: parcial.stockErp,
    precioVenta: precio === null ? null : { toNumber: () => precio },
    esEmpresa: parcial.esEmpresa ?? false,
    clase: parcial.clase ?? (parcial.esEmpresa === true ? 'empresa' : 'unidad'),
    empaqueCompra: parcial.empaqueCompra ?? null,
    empaqueCompraSimbolo: parcial.empaqueCompraSimbolo ?? null,
  };
}

/** Una hoja FINALIZADA de la ronda 1 que conto estos codigos en sueltas. */
function hoja(numero: string, zona: string, contado: Array<{ codigo: string; sueltas: number }>) {
  return {
    numeroConteo: 1,
    zona,
    numero,
    productos: contado.map((c, i) => ({
      id: 100 + i,
      codigo: c.codigo,
      descripcion: `Producto ${c.codigo}`,
      empaques: [],
      conteos: [{ sueltas: c.sueltas, empaques: [] }],
    })),
  };
}

/**
 * Deja la base "sembrada": que tiendas hay, que inventarios, y que catalogo y
 * que hojas tiene cada inventario. `porInventario` se resuelve por el
 * `where.inventarioId` de cada consulta, que es como `armarMatriz` las hace.
 */
function sembrar(
  sucursales: Array<{ id: number; nombre: string }>,
  inventarios: ReturnType<typeof inventario>[],
  porInventario: Record<number, { catalogo: ReturnType<typeof catalogo>[]; hojas: ReturnType<typeof hoja>[] }>,
): void {
  prismaMock.sucursal.findMany.mockResolvedValue(sucursales);
  prismaMock.inventario.findMany.mockResolvedValue(inventarios);
  prismaMock.catalogoItem.findMany.mockImplementation(
    async ({ where }: { where: { inventarioId: number } }) => porInventario[where.inventarioId]?.catalogo ?? [],
  );
  prismaMock.hojaConteo.findMany.mockImplementation(
    async ({ where }: { where: { inventarioId: number } }) => porInventario[where.inventarioId]?.hojas ?? [],
  );
}

async function leer(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const libro = new ExcelJS.Workbook();
  // `as any`: ver el comentario en auditoria.exportar-diferencias.test.ts.
  await libro.xlsx.load(buffer as any);
  const hojaLeida = libro.worksheets[0];
  if (!hojaLeida) throw new Error('El libro no tiene ninguna hoja.');
  return hojaLeida;
}

function columna(hoja: ExcelJS.Worksheet, encabezado: (typeof ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA)[number]): unknown[] {
  const indice = ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA.indexOf(encabezado) + 1;
  const valores: unknown[] = [];
  for (let n = 2; n <= hoja.rowCount; n++) valores.push(hoja.getRow(n).getCell(indice).value);
  return valores;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sin excepciones del Auditor por defecto: la clasificacion es la del snapshot.
  prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
  prismaMock.diferenciaItem.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// LAS TIENDAS EN UNA SOLA HOJA
// ---------------------------------------------------------------------------

describe('dos tiendas y una que no arranco', () => {
  beforeEach(() => {
    sembrar(
      // En orden de NOMBRE, como las devuelve la consulta del export.
      [CARHUAZ, LUZURIAGA, SUCRE],
      [inventario(8078, LUZURIAGA.id), inventario(8080, CARHUAZ.id)],
      {
        8078: {
          catalogo: [catalogo({ codigo: 'L-2', stockErp: 10 }), catalogo({ codigo: 'L-1', stockErp: 20 })],
          hojas: [hoja('003', 'ABARROTES', [{ codigo: 'L-1', sueltas: 17 }, { codigo: 'L-2', sueltas: 12 }])],
        },
        8080: {
          catalogo: [catalogo({ codigo: 'C-1', stockErp: 5, precioVenta: 2.5 })],
          hojas: [hoja('001', 'LACTEOS', [{ codigo: 'C-1', sueltas: 3 }])],
        },
      },
    );
  });

  it('las filas de las dos tiendas van en UNA hoja, con la columna Sucursal distinta', async () => {
    const { buffer } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    const hojaLeida = await leer(buffer);

    expect(hojaLeida.name).toBe('Diferencias');
    expect(hojaLeida.rowCount).toBe(4); // encabezado + 3 productos con diferencia
    // Carhuaz antes de Luzuriaga: por nombre. Y adentro de Luzuriaga, por codigo.
    expect(columna(hojaLeida, 'Sucursal')).toEqual(['Market Carhuaz', 'Market Luzuriaga', 'Market Luzuriaga']);
    expect(columna(hojaLeida, 'Código')).toEqual(['C-1', 'L-1', 'L-2']);
  });

  /**
   * POR NOMBRE Y NO POR ID -- el unico lugar donde este endpoint difiere de
   * `/cadena` a proposito: en un archivo de diez tiendas las filas de una misma
   * tienda tienen que quedar juntas y en un orden legible (mismo criterio que
   * `exportarDiferenciasConsolidado`). La tabla conserva su orden de pantalla.
   */
  it('pide las tiendas ordenadas por NOMBRE, y solo las activas', async () => {
    await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    const args = prismaMock.sucursal.findMany.mock.calls[0]![0] as {
      where: { activa: boolean };
      orderBy: { nombre: string };
    };
    expect(args.orderBy).toEqual({ nombre: 'asc' });
    expect(args.where).toEqual({ activa: true });
  });

  it('la tienda sin inventario no aporta ninguna fila', async () => {
    const { buffer } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    expect(columna(await leer(buffer), 'Sucursal')).not.toContain('Market Sucre');
  });

  it('cada fila dice de que inventario y de que periodo es', async () => {
    const { buffer, nombreArchivo } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    const hojaLeida = await leer(buffer);
    expect(columna(hojaLeida, 'Inventario')).toEqual([8080, 8078, 8078]);
    expect(columna(hojaLeida, 'Año')).toEqual([2026, 2026, 2026]);
    expect(columna(hojaLeida, 'Mes')).toEqual([9, 9, 9]);
    expect(nombreArchivo).toBe('diferencias-cadena-2026-09.xlsx');
  });

  /**
   * LA INVARIANTE DEL ENDPOINT: el archivo respalda la tabla. Se comparan las
   * DOS salidas sobre las MISMAS consultas -- si `inventariosDelPeriodo` dejara
   * de estar compartido, o si el detalle repartiera distinto, esto falla.
   */
  it('la suma de Monto por tienda cierra contra la tabla de /cadena', async () => {
    const tabla = await cadena(AUDITOR, { anio: 2026, mes: 9 });
    const { buffer } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    const hojaLeida = await leer(buffer);

    const sucursales = columna(hojaLeida, 'Sucursal');
    const cuadros = columna(hojaLeida, 'Cuadro');
    const tipos = columna(hojaLeida, 'Tipo');
    const montos = columna(hojaLeida, 'Monto') as number[];

    for (const fila of tabla.tiendas) {
      const alPersonal = montos.reduce(
        (total, monto, i) =>
          sucursales[i] === fila.sucursal && cuadros[i] === 'Al personal' && tipos[i] === 'Faltante'
            ? total + monto
            : total,
        0,
      );
      expect(-alPersonal).toBeCloseTo(fila.porClase.unidad.valorFaltante, 2);
    }
    // Y el archivo no se quedo vacio, que haria pasar la comparacion de arriba
    // sin probar nada: las dos tiendas con inventario tienen plata.
    expect(tabla.total.porClase.unidad.valorFaltante).toBeGreaterThan(0);
  });

  it('la tabla y el archivo eligen el MISMO inventario para cada tienda', async () => {
    const tabla = await cadena(AUDITOR, { anio: 2026, mes: 9 });
    const { buffer } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    const hojaLeida = await leer(buffer);

    const sucursales = columna(hojaLeida, 'Sucursal');
    const inventarios = columna(hojaLeida, 'Inventario');
    for (const [i, sucursal] of sucursales.entries()) {
      const enLaTabla = tabla.tiendas.find((t) => t.sucursal === sucursal);
      expect(inventarios[i]).toBe(enLaTabla?.inventarioId);
    }
  });
});

// ---------------------------------------------------------------------------
// LA SELECCION DE INVENTARIOS, COMPARTIDA CON LA TABLA
// ---------------------------------------------------------------------------

describe('que inventario del periodo se lee', () => {
  /**
   * EL ANULADO NO SE AUDITA: no produce resultado. El corte esta en la CLAUSULA
   * de la consulta y no en un filtro posterior, asi que es la clausula lo que se
   * verifica -- y tiene que ser LA MISMA que la de la tabla, porque las dos
   * salen de `inventariosDelPeriodo`.
   */
  it('el WHERE excluye los anulados, y es el mismo que usa /cadena', async () => {
    sembrar([LUZURIAGA], [], {});
    await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    const whereDelExport = prismaMock.inventario.findMany.mock.calls[0]![0]!.where;

    prismaMock.inventario.findMany.mockClear();
    await cadena(AUDITOR, { anio: 2026, mes: 9 });
    const whereDeLaTabla = prismaMock.inventario.findMany.mock.calls[0]![0]!.where;

    expect(whereDelExport).toEqual({ periodoAnio: 2026, periodoMes: 9, estado: { not: 'anulado' } });
    expect(whereDelExport).toEqual(whereDeLaTabla);
  });

  /**
   * MANDA EL MENSUAL. Una tienda puede tener el mensual y el anual del mismo
   * periodo (la unique del schema es `[sucursalId, anio, mes, tipo]`), y el
   * archivo tiene que traer el detalle del MISMO que muestra la tabla.
   *
   * EL ANUAL VA PRIMERO EN LA LISTA a proposito: si la regla fuera "gana el
   * ultimo que se recorre" -- o sea, sin la guarda del tipo -- el archivo
   * traeria el anual y esto fallaria. Con el mensual primero, las dos
   * implementaciones dan lo mismo y el test no distinguiria nada.
   */
  it('con el mensual y el anual del mismo periodo, manda el MENSUAL en los dos', async () => {
    sembrar(
      [LUZURIAGA],
      [inventario(8090, LUZURIAGA.id, 'anual'), inventario(8091, LUZURIAGA.id, 'mensual')],
      {
        8090: {
          catalogo: [catalogo({ codigo: 'ANUAL', stockErp: 10 })],
          hojas: [hoja('001', 'ANUAL', [{ codigo: 'ANUAL', sueltas: 8 }])],
        },
        8091: {
          catalogo: [catalogo({ codigo: 'MENSUAL', stockErp: 10 })],
          hojas: [hoja('001', 'MENSUAL', [{ codigo: 'MENSUAL', sueltas: 8 }])],
        },
      },
    );

    const { buffer } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    const hojaLeida = await leer(buffer);
    expect(columna(hojaLeida, 'Código')).toEqual(['MENSUAL']);
    expect(columna(hojaLeida, 'Inventario')).toEqual([8091]);

    const tabla = await cadena(AUDITOR, { anio: 2026, mes: 9 });
    expect(tabla.tiendas[0]?.inventarioId).toBe(8091);
  });

  /**
   * SIN `anio`/`mes` MANDA EL RELOJ DEL SERVIDOR, igual que al TOMAR el snapshot
   * y que en la tabla: las dos puntas tienen que estar de acuerdo en qué mes es.
   * Y el nombre del archivo sale de ahi porque el front no conoce ese mes.
   */
  it('sin periodo en la query lo resuelve el servidor, y el nombre del archivo lo dice', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 10, 0, 0)); // julio de 2026
    sembrar([LUZURIAGA], [], {});

    const { nombreArchivo } = await exportarDiferenciasDeLaCadena(AUDITOR, {});

    expect(prismaMock.inventario.findMany.mock.calls[0]![0]!.where).toMatchObject({
      periodoAnio: 2026,
      periodoMes: 7,
    });
    expect(nombreArchivo).toBe('diferencias-cadena-2026-07.xlsx');
  });
});

// ---------------------------------------------------------------------------
// LOS BORDES
// ---------------------------------------------------------------------------

describe('un periodo sin nada', () => {
  it('devuelve un .xlsx valido con solo el encabezado, no un error', async () => {
    sembrar([LUZURIAGA, CARHUAZ], [], {});
    const { buffer } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2020, mes: 1 });
    const hojaLeida = await leer(buffer);
    expect(hojaLeida.rowCount).toBe(1);
    expect((hojaLeida.getRow(1).values as unknown[]).slice(1)).toEqual([...ENCABEZADOS_EXPORT_DIFERENCIAS_CADENA]);
  });

  it('una tienda con inventario pero sin ninguna diferencia tampoco aporta filas', async () => {
    sembrar([LUZURIAGA], [inventario(8078, LUZURIAGA.id)], {
      8078: {
        // Uno cuadrado, uno sin stock del ERP y uno que nadie conto: NINGUNO
        // aporta fila. La regla de cabecera de auditoria.calculos.ts por esta via.
        catalogo: [
          catalogo({ codigo: 'CUADRA', stockErp: 10 }),
          catalogo({ codigo: 'SIN-ERP', stockErp: null }),
          catalogo({ codigo: 'SIN-CONTAR', stockErp: 10 }),
        ],
        hojas: [hoja('001', 'A', [{ codigo: 'CUADRA', sueltas: 10 }, { codigo: 'SIN-ERP', sueltas: 42 }])],
      },
    });

    const { buffer } = await exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 });
    expect((await leer(buffer)).rowCount).toBe(1);
  });
});

describe('quien puede bajar el archivo', () => {
  /**
   * EL MISMO PERMISO QUE LA TABLA (`validarAccesoALaCadena`), y el corte ANTES
   * de tocar Prisma: negar despues de armar diez matrices seria hacer todo el
   * trabajo para tirarlo.
   */
  it('el coordinador no: 403 antes de consultar nada', async () => {
    await expect(exportarDiferenciasDeLaCadena(COORDINADOR, { anio: 2026, mes: 9 })).rejects.toThrow(Prohibido);
    expect(prismaMock.inventario.findMany).not.toHaveBeenCalled();
    expect(prismaMock.sucursal.findMany).not.toHaveBeenCalled();
  });

  it('el auditor si: audita la cadena entera', async () => {
    sembrar([LUZURIAGA], [], {});
    await expect(exportarDiferenciasDeLaCadena(AUDITOR, { anio: 2026, mes: 9 })).resolves.toMatchObject({
      nombreArchivo: 'diferencias-cadena-2026-09.xlsx',
    });
  });
});
