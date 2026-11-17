/**
 * EL CONTRATO DE `GET /api/auditoria/cadena/conteos`: una fila por producto de
 * todas las tiendas del periodo, con el conteo QUE MANDA y la hoja donde
 * corregirlo.
 *
 * Lo que se fija acá es lo que la pantalla "Corregir lo contado" va a creer:
 *
 *   1. LA FILA APUNTA A LA RONDA QUE MANDA, no a la 1. Es EL caso del endpoint:
 *      en Luzuriaga la ronda 1 tiene los 985 productos y la ronda 4 tiene 6, y
 *      para esos 6 el conteo, la hoja, el producto y los empaques son los de la
 *      ronda 4. Apuntar a la ronda 1 da un 404 al corregir
 *      (`hojas.service.ts#corregirConteo` exige que el producto sea de esa hoja)
 *      y, antes de eso, muestra una resta que no da su propia diferencia.
 *   2. LA FILA CIERRA CONSIGO MISMA: `conteo - stockErp === diferencia`, con el
 *      stock de la ronda del conteo y no el de la ronda 1.
 *   3. LA CATEGORIA ES LA DEL PRODUCTO, no la `zona` de la hoja -- que es
 *      sintetica y ya causo un bug.
 *   4. `sePuedeCorregir` RESUELVE LA REGLA, para que el cliente no tenga media
 *      copia: hace falta un conteo que corregir Y el inventario `en_curso`.
 *   5. UNA TIENDA SIN INVENTARIO NO APORTA FILAS pero SI se cuenta en
 *      `cobertura`: no se le inventa un producto, y tampoco se la esconde.
 *
 * 1 a 4 se prueban SIN BASE sobre `filaDeConteoDeCadena`, que es pura. 5 y la
 * paginacion se prueban contra el service con Prisma mockeado, que es el unico
 * lugar donde se puede ver el recorrido de las tiendas.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';

const prismaMock = vi.hoisted(() => ({
  sucursal: { findMany: vi.fn() },
  inventario: { findMany: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  stockRonda: { findMany: vi.fn(async () => []) },
  hojaConteo: { findMany: vi.fn(), groupBy: vi.fn(async () => []) },
  clasificacionProducto: { findMany: vi.fn(async () => []) },
  diferenciaItem: { findMany: vi.fn(async () => []) },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import { filaDeConteoDeCadena, type ConteoUbicado, type ItemAuditoria } from './auditoria.calculos';
import { conteosDeLaCadena } from './auditoria.service';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };

/** La query ya pasada por zod: `limite`/`desplazamiento` tienen default. */
const QUERY = { anio: 2026, mes: 9, limite: 100, desplazamiento: 0 } as const;

// ---------------------------------------------------------------------------
// La fila, sin base
// ---------------------------------------------------------------------------

function item(parcial: Partial<ItemAuditoria> & { codigo: string }): ItemAuditoria {
  return {
    productoId: 1,
    descripcion: `Producto ${parcial.codigo}`,
    zona: 'ZONA SINTETICA DE LA HOJA',
    hoja: '001',
    precioVenta: 10,
    stockErp: 10,
    clase: 'unidad',
    claseForzada: null,
    empaqueCompra: null,
    empaqueCompraSimbolo: null,
    empaqueCompraCorregido: null,
    conteos: [10],
    stockPorRonda: [],
    esEmpresa: false,
    ...parcial,
  };
}

function ubicacion(parcial: Partial<ConteoUbicado> & { numeroConteo: number }): ConteoUbicado {
  return {
    hojaId: 1000 + parcial.numeroConteo,
    hojaNumero: `00${parcial.numeroConteo}`,
    productoId: 2000 + parcial.numeroConteo,
    empaques: [{ nombre: `Emp.${parcial.numeroConteo}`, factor: parcial.numeroConteo }],
    ...parcial,
  };
}

const LUZURIAGA = {
  sucursalId: 1,
  sucursal: 'Market Luzuriaga',
  inventarioId: 8078,
  estado: 'en_curso' as const,
};

const FICHA = { codigoBarras: '7750000000013', categoria: 'GALLETAS' };

describe('la fila apunta a la ronda que manda, no a la ronda 1', () => {
  /**
   * EL CASO REAL DE LUZURIAGA, con sus cuatro rondas: el item se conto en la 1
   * (10), volvio en la 2 (11) y quedo fijado en la 4 (13). La ronda 3 no lo
   * incluyo, y ese hueco es `null` a proposito -- la POSICION es la ronda.
   */
  const recontado = item({ codigo: '0051', conteos: [10, 11, null, 13], stockPorRonda: [10, 12, null, 12] });
  const ubicaciones = new Map<number, ConteoUbicado>([
    [1, ubicacion({ numeroConteo: 1, hojaId: 7001, hojaNumero: '001', productoId: 501 })],
    [2, ubicacion({ numeroConteo: 2, hojaId: 7002, hojaNumero: '021', productoId: 502 })],
    [4, ubicacion({ numeroConteo: 4, hojaId: 7004, hojaNumero: '029', productoId: 504 })],
  ]);
  const fila = filaDeConteoDeCadena(LUZURIAGA, recontado, FICHA, ubicaciones);

  it('toma la hoja, el producto y la ronda de la ULTIMA pasada en la que aparece', () => {
    expect(fila.numeroConteo).toBe(4);
    expect(fila.hojaId).toBe(7004);
    expect(fila.hoja).toBe('029');
    expect(fila.productoId).toBe(504);
  });

  it('y NO los de la ronda 1, que es lo que daria un 404 al corregir', () => {
    expect(fila.hojaId).not.toBe(7001);
    expect(fila.productoId).not.toBe(501);
  });

  it('los empaques son los del producto de ESA hoja', () => {
    // El cuerpo de la correccion manda `empaqueNombre` y el servidor lo resuelve
    // contra los empaques de ESE producto: los de la ronda 1 harian rechazar un
    // empaque que existe.
    expect(fila.empaques).toEqual([{ nombre: 'Emp.4', factor: 4 }]);
  });

  it('el conteo es el de la ronda 4, y el stock tambien', () => {
    expect(fila.conteo).toBe(13);
    expect(fila.stockErp).toBe(12);
    expect(fila.rondaDelStock).toBe(4);
  });

  /** LA PROPIEDAD QUE TIENE QUE CERRAR EN LA PROPIA FILA. */
  it('conteo - stockErp da la diferencia que la fila misma escribe', () => {
    expect(fila.diferencia).toBe(1);
    expect(fila.conteo! - fila.stockErp!).toBe(fila.diferencia);
  });

  /**
   * CON EL STOCK DE LA RONDA 1 LA FILA NO CERRARIA, y este test lo demuestra en
   * numeros: 13 - 10 daria 3, y la fila dice 1.
   */
  it('con el stock de la ronda 1 la resta daria otra cosa', () => {
    expect(recontado.stockErp).toBe(10);
    expect(fila.conteo! - recontado.stockErp!).toBe(3);
    expect(fila.diferencia).not.toBe(3);
  });
});

describe('cuando la ronda del conteo no bajo stock propio', () => {
  /** Contado en la 2, pero la 2 no trajo stock: se mide con el de la 1 y se avisa. */
  const fila = filaDeConteoDeCadena(
    LUZURIAGA,
    item({ codigo: '0052', conteos: [10, 7], stockPorRonda: [10] }),
    FICHA,
    new Map([[2, ubicacion({ numeroConteo: 2, hojaId: 7002, productoId: 502 })]]),
  );

  it('lo dice en vez de esconderlo: "faltan 3" contra dos varas distintas no es lo mismo', () => {
    expect(fila.cayoALaRonda1).toBe(true);
    expect(fila.numeroConteo).toBe(2);
    expect(fila.rondaDelStock).toBe(1);
  });

  it('y la fila sigue cerrando consigo misma', () => {
    expect(fila.conteo).toBe(7);
    expect(fila.stockErp).toBe(10);
    expect(fila.diferencia).toBe(-3);
  });
});

describe('un producto que ninguna hoja finalizada incluye', () => {
  const fila = filaDeConteoDeCadena(LUZURIAGA, item({ codigo: '0099', conteos: [] }), FICHA, new Map());

  it('viaja igual: un catalogo al que se le esconden los sin contar se lee mas chico', () => {
    expect(fila.codigo).toBe('0099');
    expect(fila.conteo).toBeNull();
    expect(fila.diferencia).toBeNull();
  });

  it('sin hoja ni producto a los que apuntar -- null, no 0', () => {
    expect(fila.hojaId).toBeNull();
    expect(fila.hoja).toBeNull();
    expect(fila.productoId).toBeNull();
    expect(fila.numeroConteo).toBeNull();
    expect(fila.empaques).toEqual([]);
  });

  it('y no se puede corregir: no hay conteo que corregir', () => {
    expect(fila.sePuedeCorregir).toBe(false);
  });
});

describe('sePuedeCorregir resuelve la regla del servidor', () => {
  const contado = item({ codigo: '0051', conteos: [7] });
  const unaRonda = new Map([[1, ubicacion({ numeroConteo: 1 })]]);
  const con = (estado: 'en_curso' | 'ajuste_auditor' | 'conteo_cerrado' | 'liquidado' | 'lacrado'): boolean =>
    filaDeConteoDeCadena({ ...LUZURIAGA, estado }, contado, FICHA, unaRonda).sePuedeCorregir;

  it('en_curso con conteo: si', () => {
    expect(con('en_curso')).toBe(true);
  });

  /**
   * LA VENTANA SE CIERRA EN `ajuste_auditor` y no antes: es exactamente
   * `ajuste.permisos.ts#validarCorreccion`. Desde ahi los valores los cambia el
   * Auditor en SU pantalla, y una correccion por esta via los pisaria.
   */
  it('ajuste_auditor: no, aunque haya conteo', () => {
    expect(con('ajuste_auditor')).toBe(false);
  });

  it('y nada de lo que viene despues tampoco', () => {
    expect(con('conteo_cerrado')).toBe(false);
    expect(con('liquidado')).toBe(false);
    expect(con('lacrado')).toBe(false);
  });

  it('el estado viaja igual en la fila, para que el cliente pueda decir por que', () => {
    const enAjuste = filaDeConteoDeCadena({ ...LUZURIAGA, estado: 'ajuste_auditor' }, contado, FICHA, unaRonda);
    expect(enAjuste.estado).toBe('ajuste_auditor');
    expect(enAjuste.hojaId).not.toBeNull();
  });
});

describe('la categoria es la del producto, no la zona de la hoja', () => {
  it('sale de la ficha del catalogo y no de `item.zona`', () => {
    const fila = filaDeConteoDeCadena(
      LUZURIAGA,
      item({ codigo: '0051', zona: 'ZONA SINTETICA DE LA HOJA' }),
      { codigoBarras: '7750000000013', categoria: 'FIDEOS Y PASTAS' },
      new Map([[1, ubicacion({ numeroConteo: 1 })]]),
    );
    expect(fila.categoria).toBe('FIDEOS Y PASTAS');
    expect(fila.codigoBarras).toBe('7750000000013');
    expect(Object.values(fila)).not.toContain('ZONA SINTETICA DE LA HOJA');
  });

  it('un producto sin categoria en el ERP llega en null, sin inventarle una', () => {
    const fila = filaDeConteoDeCadena(
      LUZURIAGA,
      item({ codigo: '0051' }),
      { codigoBarras: '7750000000013', categoria: null },
      new Map([[1, ubicacion({ numeroConteo: 1 })]]),
    );
    expect(fila.categoria).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El endpoint, con Prisma mockeado
// ---------------------------------------------------------------------------

function inventario(id: number, sucursalId: number, estado = 'en_curso') {
  return { id, sucursalId, estado, tipo: 'mensual', umbralMediaUnidadPaquete: { toNumber: () => 0.5 } };
}

function catalogo(codigo: string, categoria: string | null = 'GALLETAS') {
  return {
    codigo,
    codigoBarras: `775${codigo}`,
    descripcion: `Producto ${codigo}`,
    categoria,
    stockErp: 10,
    precioVenta: { toNumber: () => 10 },
    esEmpresa: false,
    clase: 'unidad',
    empaqueCompra: null,
    empaqueCompraSimbolo: null,
  };
}

/** Una hoja finalizada de la ronda `numeroConteo` que conto estos codigos. */
function hoja(
  id: number,
  numero: string,
  numeroConteo: number,
  contado: Array<{ codigo: string; sueltas: number; productoId: number }>,
) {
  return {
    id,
    numeroConteo,
    zona: 'ZONA DE LA HOJA',
    numero,
    productos: contado.map((c) => ({
      id: c.productoId,
      codigo: c.codigo,
      descripcion: `Producto ${c.codigo}`,
      empaques: [],
      conteos: [{ sueltas: c.sueltas, empaques: [] }],
    })),
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.stockRonda.findMany.mockResolvedValue([]);
  prismaMock.hojaConteo.groupBy.mockResolvedValue([]);
  prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
});

describe('un periodo con tiendas en distintos estados', () => {
  beforeEach(() => {
    sembrar(
      [
        { id: 1, nombre: 'Market Luzuriaga' },
        { id: 2, nombre: 'Market Carhuaz' },
        { id: 3, nombre: 'Market Sucre' },
      ],
      [inventario(8078, 1, 'en_curso'), inventario(8088, 2, 'ajuste_auditor')],
      {
        8078: { catalogo: [catalogo('0051')], hojas: [hoja(7001, '001', 1, [{ codigo: '0051', sueltas: 7, productoId: 501 }])] },
        8088: { catalogo: [catalogo('0061')], hojas: [hoja(7101, '001', 1, [{ codigo: '0061', sueltas: 9, productoId: 601 }])] },
      },
    );
  });

  it('las dos tiendas con inventario aportan sus filas; la tercera ninguna', () => {
    return conteosDeLaCadena(AUDITOR, QUERY).then((r) => {
      expect(r.total).toBe(2);
      expect(r.conteos.map((f) => f.sucursal)).toEqual(['Market Luzuriaga', 'Market Carhuaz']);
      expect(r.conteos.some((f) => f.sucursalId === 3)).toBe(false);
    });
  });

  /**
   * LA TIENDA SIN INVENTARIO NO SE ESCONDE: no aporta filas porque no tiene
   * productos, y eso se dice en `cobertura`. Sin ese bloque, una cadena de tres
   * tiendas con dos arrancadas se leeria como una cadena de dos.
   */
  it('la cobertura cuenta las tres y dice cuantas no arrancaron', async () => {
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    expect(r.cobertura).toEqual({ tiendas: 3, conInventario: 2, sinInventario: 1 });
  });

  it('la de ajuste final viaja con su estado y marcada como no corregible', async () => {
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    const carhuaz = r.conteos.find((f) => f.sucursalId === 2)!;
    expect(carhuaz.estado).toBe('ajuste_auditor');
    expect(carhuaz.sePuedeCorregir).toBe(false);
    // Y la de en_curso si: la fila dice que se puede, no el cliente.
    expect(r.conteos.find((f) => f.sucursalId === 1)!.sePuedeCorregir).toBe(true);
  });

  it('cada fila trae la hoja y el producto de su propia tienda', async () => {
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    expect(r.conteos.find((f) => f.sucursalId === 1)).toMatchObject({ hojaId: 7001, productoId: 501, conteo: 7 });
    expect(r.conteos.find((f) => f.sucursalId === 2)).toMatchObject({ hojaId: 7101, productoId: 601, conteo: 9 });
  });

  it('el periodo viaja en la respuesta', async () => {
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    expect(r.periodo).toEqual({ anio: 2026, mes: 9 });
  });

  /** `?sucursalId=` acota el trabajo, no solo el resultado. */
  it('con sucursalId solo se arma esa tienda', async () => {
    const r = await conteosDeLaCadena(AUDITOR, { ...QUERY, sucursalId: 2 });
    expect(r.total).toBe(1);
    expect(r.conteos[0]!.sucursalId).toBe(2);
    // El catalogo de la otra tienda no se pidio: ese es el ahorro.
    const pedidos = prismaMock.catalogoItem.findMany.mock.calls.map((c) => (c[0] as { where: { inventarioId: number } }).where.inventarioId);
    expect(pedidos).toEqual([8088]);
  });

  /** La cobertura es del PERIODO, no del filtro: con una tienda sigue diciendo tres. */
  it('la cobertura no cambia al filtrar por tienda', async () => {
    const r = await conteosDeLaCadena(AUDITOR, { ...QUERY, sucursalId: 2 });
    expect(r.cobertura).toEqual({ tiendas: 3, conInventario: 2, sinInventario: 1 });
  });
});

describe('un producto recontado en varias rondas, de punta a punta', () => {
  /**
   * EL CASO QUE DEFINE EL ENDPOINT, armado como en Luzuriaga: la ronda 1 cubre
   * los dos productos, la 2 recuenta uno solo. La fila de ese uno tiene que
   * apuntar a la hoja de la ronda 2.
   */
  beforeEach(() => {
    sembrar(
      [{ id: 1, nombre: 'Market Luzuriaga' }],
      [inventario(8078, 1, 'en_curso')],
      {
        8078: {
          catalogo: [catalogo('0051'), catalogo('0052')],
          hojas: [
            hoja(7001, '001', 1, [
              { codigo: '0051', sueltas: 7, productoId: 501 },
              { codigo: '0052', sueltas: 10, productoId: 502 },
            ]),
            hoja(7021, '021', 2, [{ codigo: '0051', sueltas: 9, productoId: 901 }]),
          ],
        },
      },
    );
  });

  it('el recontado apunta a la hoja de la ronda 2 y muestra su conteo', async () => {
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    const recontado = r.conteos.find((f) => f.codigo === '0051')!;
    expect(recontado.numeroConteo).toBe(2);
    expect(recontado.hojaId).toBe(7021);
    expect(recontado.hoja).toBe('021');
    expect(recontado.productoId).toBe(901);
    expect(recontado.conteo).toBe(9);
    expect(recontado.diferencia).toBe(-1); // 9 - 10
  });

  it('el que cuadro en la ronda 1 se queda en la ronda 1', async () => {
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    const cuadrado = r.conteos.find((f) => f.codigo === '0052')!;
    expect(cuadrado.numeroConteo).toBe(1);
    expect(cuadrado.hojaId).toBe(7001);
    expect(cuadrado.productoId).toBe(502);
    expect(cuadrado.diferencia).toBe(0);
  });

  it('los dos productos del catalogo viajan, no solo el recontado', async () => {
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    expect(r.total).toBe(2);
    expect(r.conteos.map((f) => f.codigo)).toEqual(['0051', '0052']);
  });
});

describe('un periodo vacio', () => {
  it('sin ningun inventario: cero filas, y la cobertura lo dice', async () => {
    sembrar([{ id: 1, nombre: 'Market Luzuriaga' }, { id: 2, nombre: 'Market Carhuaz' }], [], {});
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    expect(r.total).toBe(0);
    expect(r.conteos).toEqual([]);
    expect(r.cobertura).toEqual({ tiendas: 2, conInventario: 0, sinInventario: 2 });
    // No se arma ninguna matriz: no hay inventario que armar.
    expect(prismaMock.catalogoItem.findMany).not.toHaveBeenCalled();
  });

  it('sin ninguna tienda activa tampoco truena', async () => {
    sembrar([], [], {});
    const r = await conteosDeLaCadena(AUDITOR, QUERY);
    expect(r.total).toBe(0);
    expect(r.cobertura).toEqual({ tiendas: 0, conInventario: 0, sinInventario: 0 });
  });
});

describe('paginacion y filtros', () => {
  beforeEach(() => {
    const codigos = ['0051', '0052', '0053', '0054', '0055'];
    sembrar(
      [{ id: 1, nombre: 'Market Luzuriaga' }],
      [inventario(8078, 1, 'en_curso')],
      {
        8078: {
          catalogo: [
            catalogo('0051', 'GALLETAS'),
            catalogo('0052', 'GALLETAS'),
            catalogo('0053', 'FIDEOS Y PASTAS'),
            catalogo('0054', null),
            catalogo('0055', 'GALLETAS'),
          ],
          hojas: [
            hoja(
              7001,
              '001',
              1,
              codigos.map((codigo, i) => ({ codigo, sueltas: 10, productoId: 500 + i })),
            ),
          ],
        },
      },
    );
  });

  /** EL TOTAL ES EL DEL FILTRO ENTERO, no el de la pagina. */
  it('la pagina recorta pero el total no', async () => {
    const r = await conteosDeLaCadena(AUDITOR, { ...QUERY, limite: 2, desplazamiento: 0 });
    expect(r.conteos).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.limite).toBe(2);
    expect(r.desplazamiento).toBe(0);
  });

  /**
   * EL ORDEN TIENE QUE SER ESTABLE o la paginacion miente: la pagina 2 no puede
   * repetir ni saltear lo que mostro la 1.
   */
  it('las paginas no se pisan ni dejan huecos', async () => {
    const p1 = await conteosDeLaCadena(AUDITOR, { ...QUERY, limite: 2, desplazamiento: 0 });
    const p2 = await conteosDeLaCadena(AUDITOR, { ...QUERY, limite: 2, desplazamiento: 2 });
    const p3 = await conteosDeLaCadena(AUDITOR, { ...QUERY, limite: 2, desplazamiento: 4 });
    const vistos = [...p1.conteos, ...p2.conteos, ...p3.conteos].map((f) => f.codigo);
    expect(vistos).toEqual(['0051', '0052', '0053', '0054', '0055']);
    expect(new Set(vistos).size).toBe(5);
  });

  it('filtra por la categoria real del producto', async () => {
    const r = await conteosDeLaCadena(AUDITOR, { ...QUERY, categoria: 'FIDEOS Y PASTAS' });
    expect(r.conteos.map((f) => f.codigo)).toEqual(['0053']);
    expect(r.total).toBe(1);
  });

  it('la busqueda pega contra codigo, descripcion y codigo de barras', async () => {
    const porCodigo = await conteosDeLaCadena(AUDITOR, { ...QUERY, busqueda: '0053' });
    expect(porCodigo.conteos.map((f) => f.codigo)).toEqual(['0053']);

    const porBarras = await conteosDeLaCadena(AUDITOR, { ...QUERY, busqueda: '7750054' });
    expect(porBarras.conteos.map((f) => f.codigo)).toEqual(['0054']);

    const porDescripcion = await conteosDeLaCadena(AUDITOR, { ...QUERY, busqueda: 'producto 0055' });
    expect(porDescripcion.conteos.map((f) => f.codigo)).toEqual(['0055']);
  });

  it('un desplazamiento mas alla del total devuelve una pagina vacia, no un error', async () => {
    const r = await conteosDeLaCadena(AUDITOR, { ...QUERY, limite: 2, desplazamiento: 99 });
    expect(r.conteos).toEqual([]);
    expect(r.total).toBe(5);
  });
});

/**
 * EL COSTO EN CONSULTAS, FIJADO CON UN TEST. Esta ruta existe para reemplazar
 * 39 pedidos HTTP: el dia que alguien resuelva un campo nuevo con una consulta
 * por fila, la pantalla vuelve a tardar lo que tardaba y nadie se entera
 * mirando el diff. Acá se entera.
 */
describe('el costo no crece con las filas, solo con las tiendas', () => {
  /** Cuantas consultas hizo cada tabla en la ultima llamada. */
  function consultas(): { catalogo: number; hojas: number; stock: number; sucursales: number; inventarios: number } {
    return {
      catalogo: prismaMock.catalogoItem.findMany.mock.calls.length,
      hojas: prismaMock.hojaConteo.findMany.mock.calls.length,
      stock: prismaMock.stockRonda.findMany.mock.calls.length,
      sucursales: prismaMock.sucursal.findMany.mock.calls.length,
      inventarios: prismaMock.inventario.findMany.mock.calls.length,
    };
  }

  it('una tienda con 1 fila y una con 50 cuestan lo mismo', async () => {
    const unaFila = [{ codigo: '0051', sueltas: 10, productoId: 501 }];
    const cincuenta = Array.from({ length: 50 }, (_, i) => ({
      codigo: `01${String(i).padStart(2, '0')}`,
      sueltas: 10,
      productoId: 600 + i,
    }));

    sembrar([{ id: 1, nombre: 'A' }], [inventario(8078, 1)], {
      8078: { catalogo: [catalogo('0051')], hojas: [hoja(7001, '001', 1, unaFila)] },
    });
    await conteosDeLaCadena(AUDITOR, QUERY);
    const conUna = consultas();

    vi.clearAllMocks();
    prismaMock.stockRonda.findMany.mockResolvedValue([]);
    sembrar([{ id: 1, nombre: 'A' }], [inventario(8078, 1)], {
      8078: { catalogo: cincuenta.map((c) => catalogo(c.codigo)), hojas: [hoja(7001, '001', 1, cincuenta)] },
    });
    const r = await conteosDeLaCadena(AUDITOR, QUERY);

    expect(r.total).toBe(50);
    expect(consultas()).toEqual(conUna);
  });

  /**
   * TRES POR TIENDA CON INVENTARIO (catalogo, hojas, stock por ronda) MAS DOS
   * FIJAS (las tiendas activas y los inventarios del periodo). Con once tiendas
   * son 35 consultas locales en una conexion, en lugar de 39 viajes por la red.
   */
  it('son 2 fijas + 3 por tienda con inventario', async () => {
    sembrar(
      [
        { id: 1, nombre: 'A' },
        { id: 2, nombre: 'B' },
        { id: 3, nombre: 'C sin inventario' },
      ],
      [inventario(8078, 1), inventario(8088, 2)],
      {
        8078: { catalogo: [catalogo('0051')], hojas: [hoja(7001, '001', 1, [{ codigo: '0051', sueltas: 1, productoId: 501 }])] },
        8088: { catalogo: [catalogo('0061')], hojas: [hoja(7101, '001', 1, [{ codigo: '0061', sueltas: 1, productoId: 601 }])] },
      },
    );
    await conteosDeLaCadena(AUDITOR, QUERY);

    expect(consultas()).toEqual({ sucursales: 1, inventarios: 1, catalogo: 2, hojas: 2, stock: 2 });
  });

  /**
   * Y NO SE PIDE LA CLASIFICACION VIGENTE, que es una consulta menos por tienda:
   * esta fila no expone `clase` ni `esEmpresa`, y la diferencia no depende de
   * ninguno de los dos. `/cadena` si la necesita, porque reparte plata por
   * cuadro.
   */
  it('no pide la clasificacion vigente: esta fila no la usa', async () => {
    sembrar([{ id: 1, nombre: 'A' }], [inventario(8078, 1)], {
      8078: { catalogo: [catalogo('0051')], hojas: [hoja(7001, '001', 1, [{ codigo: '0051', sueltas: 1, productoId: 501 }])] },
    });
    await conteosDeLaCadena(AUDITOR, QUERY);
    expect(prismaMock.clasificacionProducto.findMany).not.toHaveBeenCalled();
  });
});

describe('quien puede pedir los conteos de la cadena', () => {
  it('el coordinador no: es el MISMO recorte que /cadena', async () => {
    sembrar([{ id: 1, nombre: 'Market Luzuriaga' }], [inventario(8078, 1)], { 8078: { catalogo: [], hojas: [] } });
    await expect(conteosDeLaCadena(COORDINADOR, QUERY)).rejects.toThrow(Prohibido);
    // El corte es ANTES de tocar la base: no se arma ninguna matriz para
    // despues tirarla.
    expect(prismaMock.sucursal.findMany).not.toHaveBeenCalled();
  });

  it('el auditor si', async () => {
    sembrar([{ id: 1, nombre: 'Market Luzuriaga' }], [inventario(8078, 1)], { 8078: { catalogo: [], hojas: [] } });
    await expect(conteosDeLaCadena(AUDITOR, QUERY)).resolves.toMatchObject({ total: 0 });
  });
});
