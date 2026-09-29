/**
 * LA DESCARGA DE STOCK DE UN RECONTEO, sin red y sin base.
 *
 * Lo que fijan estos casos es lo que se puede romper en silencio:
 *
 *   · la ronda 1 se rechaza CON su explicacion, no con un 400 generico;
 *   · el conjunto sale de la comparacion de la RONDA ANTERIOR contra el stock
 *     DE LA RONDA ANTERIOR -- no de las hojas de la ronda que se pide (que
 *     todavia no existen) ni del stock nuevo;
 *   · un item que el ERP no devuelve queda en `null` y NUNCA en 0;
 *   · volver a llamarlo reemplaza la ronda entera, con un solo `tomadoEn`;
 *   · una ronda sin nada que arrastrar contesta 0 y no toca Dynamics;
 *   · un error de Dynamics sube con su status -- no se aplana ni se traga.
 *
 * Prisma y el cliente de D365 se mockean; el dominio (`ciclo-conteos.ts`) y el
 * calculo de unidades (`hojas.calculos.ts`) corren de verdad: son justamente
 * las reglas que no pueden divergir del cierre de ronda.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', () => ({
  prisma: {
    inventario: { findUnique: vi.fn() },
    producto: { findMany: vi.fn() },
    catalogoItem: { findMany: vi.fn() },
    hojaConteo: { findMany: vi.fn() },
    stockRonda: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./d365-auth.service', () => ({ d365AuthService: { isConfigured: vi.fn().mockResolvedValue(true) } }));
vi.mock('./d365-catalogo.service', () => ({ stockDeCodigos: vi.fn() }));

import { prisma } from '../../config/database';
import { ErrorHttp } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { d365AuthService } from './d365-auth.service';
import { stockDeCodigos } from './d365-catalogo.service';
import * as progreso from './d365.progreso';
import { bajarStockDeLaRonda, codigosQueArrastraLaRonda, progresoDeLaDescarga } from './d365.stock-ronda.service';

const COORDINADOR: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };

/** El inventario de la casa: Luzuriaga, almacen real, ronda 1 ya cerrada. */
const INVENTARIO = {
  id: 8078,
  sucursalId: 1,
  estado: 'en_curso',
  ultimaRondaCerrada: 1,
  sucursal: { nombre: 'Market Luzuriaga', almacenId: 'MD01_LUZ' },
};

/**
 * Una hoja con sus productos y conteos, en la forma que devuelve el `findMany`
 * de `contadoHastaLaRonda`. `sueltas` alcanza: sin lineas de empaque,
 * `totalUnidades` devuelve las sueltas tal cual.
 */
function hoja(numeroConteo: number, filas: Array<{ codigo: string; sueltas: number | null }>) {
  return {
    numeroConteo,
    productos: filas.map((f) => ({
      codigo: f.codigo,
      empaques: [{ nombre: 'U', factor: 1 }],
      conteos: f.sueltas === null ? [] : [{ sueltas: f.sueltas, empaques: [] }],
    })),
  };
}

/**
 * LA RONDA 1 DE LA CASA. Cuatro items, stock del snapshot, contados asi:
 *
 *     100150  stock  7  contado  7   -> cuadra, NO arrastra
 *     113967  stock 10  contado  9   -> falta 1, arrastra
 *     100936  stock 19  contado 21   -> sobran 2, arrastra
 *     108591  stock  1  sin contar   -> nunca se conto, arrastra
 */
const CATALOGO = [
  { codigo: '100150', stockErp: 7 },
  { codigo: '113967', stockErp: 10 },
  { codigo: '100936', stockErp: 19 },
  { codigo: '108591', stockErp: 1 },
];
const HOJAS_RONDA_1 = [
  hoja(1, [
    { codigo: '100150', sueltas: 7 },
    { codigo: '113967', sueltas: 9 },
    { codigo: '100936', sueltas: 21 },
    { codigo: '108591', sueltas: null },
  ]),
];
const ARRASTRAN_A_LA_2 = ['113967', '100936', '108591'];

beforeEach(() => {
  vi.clearAllMocks();
  progreso.limpiar();
  vi.mocked(d365AuthService.isConfigured).mockResolvedValue(true);
  vi.mocked(prisma.inventario.findUnique).mockResolvedValue(INVENTARIO as never);
  vi.mocked(prisma.catalogoItem.findMany).mockResolvedValue(CATALOGO as never);
  vi.mocked(prisma.hojaConteo.findMany).mockResolvedValue(HOJAS_RONDA_1 as never);
  vi.mocked(prisma.producto.findMany).mockResolvedValue(
    CATALOGO.map((c, i) => ({ id: i + 1, codigo: c.codigo })) as never,
  );
  // Sin filas de stock por ronda: el caso de los inventarios que ya estaban en
  // la base antes de este cambio. Todo cae a la ronda 1 (el snapshot).
  vi.mocked(prisma.stockRonda.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.stockRonda.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.stockRonda.createMany).mockResolvedValue({ count: 0 } as never);
  // La transaccion corre el callback con el mismo cliente mockeado: lo que se
  // verifica es QUE SE BORRE Y SE INSERTE dentro, no el aislamiento de Postgres.
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
});

describe('la ronda 1 no se baja por aca', () => {
  it('400 con el mensaje que dice DONDE se trae, no un error generico', async () => {
    const error = await bajarStockDeLaRonda(COORDINADOR, 8078, 1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorHttp);
    expect((error as ErrorHttp).status).toBe(400);
    // Lo que tiene que decir: que el stock del primer conteo lo trae el
    // snapshot completo. Sin esto, el Coordinador lee "no se pudo" y reintenta.
    expect((error as ErrorHttp).message).toMatch(/snapshot/i);
    expect((error as ErrorHttp).message).toMatch(/primer conteo/i);
    // Y no llega a mirar ni el inventario: el rechazo no depende del estado.
    expect(prisma.inventario.findUnique).not.toHaveBeenCalled();
    expect(stockDeCodigos).not.toHaveBeenCalled();
  });
});

describe('el conjunto sale de la comparacion de la ronda anterior', () => {
  it('arrastra los que no cuadraron -- faltantes, sobrantes y el que nunca se conto', async () => {
    expect(await codigosQueArrastraLaRonda(8078, 2)).toEqual(ARRASTRAN_A_LA_2);
  });

  it('NO mira las hojas de la ronda que se pide: todavia no existen', async () => {
    await codigosQueArrastraLaRonda(8078, 2);

    // Los productos se buscan con `numeroConteo: 1` (la ANTERIOR). Si esto
    // pasara a ser 2, la consulta volveria vacia -- el endpoint corre ANTES de
    // que existan las hojas de la ronda 2 -- y el endpoint contestaria "0
    // items" sin que nada falle. Es el modo de fallar mas caro que tiene.
    expect(prisma.producto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hoja: { inventarioId: 8078, numeroConteo: 1 } } }),
    );
  });

  it('compara contra el stock DE LA RONDA DEL CONTEO, no contra el del snapshot, cuando esa ronda tiene el suyo', async () => {
    // Ronda 2 cerrada y con stock propio: el item 113967 valia 10 en la ronda 1
    // y hoy el ERP dice 9 -- justo lo que se conto. Contra la vara VIEJA
    // arrastraria a la ronda 3; contra la de su propia ronda, cuadra. Es el caso
    // que describio el cliente: se vendio una unidad entre las dos pasadas.
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ ...INVENTARIO, ultimaRondaCerrada: 2 } as never);
    vi.mocked(prisma.producto.findMany).mockResolvedValue([{ id: 1, codigo: '113967' }] as never);
    vi.mocked(prisma.hojaConteo.findMany).mockResolvedValue([hoja(2, [{ codigo: '113967', sueltas: 9 }])] as never);
    vi.mocked(prisma.stockRonda.findMany).mockResolvedValue([
      { codigo: '113967', numeroConteo: 2, stockErp: 9 },
    ] as never);

    expect(await codigosQueArrastraLaRonda(8078, 3)).toEqual([]);
  });

  it('el stock se resuelve por la ronda DEL CONTEO QUE MANDA, no por la ronda pedida', async () => {
    // El item entro a la ronda 2 pero su hoja se finalizo sin tocarlo: el conteo
    // que manda es el de la RONDA 1 (9 unidades), asi que la vara es la de la
    // ronda 1 (10) y no la que la ronda 2 bajo (9).
    //
    // Si esto se resolviera "por la ronda anterior" a secas, el item saldria
    // cuadrado contra el 9 de la ronda 2 -- y `rondas.service.ts#universoDeLaRonda`,
    // que usa la misma `stockDeLaMedicion`, lo mandaria a recontar. Ese desacuerdo
    // es exactamente el bug que reusar la funcion evita.
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ ...INVENTARIO, ultimaRondaCerrada: 2 } as never);
    vi.mocked(prisma.producto.findMany).mockResolvedValue([{ id: 1, codigo: '113967' }] as never);
    vi.mocked(prisma.hojaConteo.findMany).mockResolvedValue([
      hoja(1, [{ codigo: '113967', sueltas: 9 }]),
      hoja(2, [{ codigo: '113967', sueltas: null }]),
    ] as never);
    vi.mocked(prisma.stockRonda.findMany).mockResolvedValue([
      { codigo: '113967', numeroConteo: 2, stockErp: 9 },
    ] as never);

    expect(await codigosQueArrastraLaRonda(8078, 3)).toEqual(['113967']);
  });

  it('sin ninguna fila de stock de esa ronda cae a la ronda 1, en vez de dejar todo en null', async () => {
    // El caso de los inventarios que ya estaban antes del cambio, y el de una
    // ronda que se abrio sin poder bajar el stock del dia. Si en vez de caer a
    // la ronda 1 dejara todo en `null`, NADA arrastraria (un item sin stock es
    // `sin_dato_erp`, ni cuadrado ni a recontar) y el endpoint contestaria
    // "0 items" sobre una ronda que si tiene diferencias.
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ ...INVENTARIO, ultimaRondaCerrada: 2 } as never);
    vi.mocked(prisma.producto.findMany).mockResolvedValue([{ id: 1, codigo: '113967' }] as never);
    vi.mocked(prisma.hojaConteo.findMany).mockResolvedValue([hoja(2, [{ codigo: '113967', sueltas: 9 }])] as never);
    vi.mocked(prisma.stockRonda.findMany).mockResolvedValue([] as never);

    expect(await codigosQueArrastraLaRonda(8078, 3)).toEqual(['113967']);
  });
});

describe('el item que el ERP no devuelve queda en null, nunca en 0', () => {
  it('escribe null y lo cuenta en `sinStockEnErp`', async () => {
    // Dynamics contesta por dos de los tres: 108591 no tiene fila en el almacen.
    vi.mocked(stockDeCodigos).mockResolvedValue(
      new Map([
        ['113967', 8],
        ['100936', 19],
      ]),
    );

    const resultado = await bajarStockDeLaRonda(COORDINADOR, 8078, 2);

    expect(resultado.items).toBe(3);
    expect(resultado.sinStockEnErp).toBe(1);

    const filas = vi.mocked(prisma.stockRonda.createMany).mock.calls[0]![0]!.data as Array<{
      codigo: string;
      stockErp: number | null;
    }>;
    expect(filas.find((f) => f.codigo === '108591')!.stockErp).toBeNull();
    // Y los que si vinieron van con su numero, incluido un 0 real si lo hubiera.
    expect(filas.find((f) => f.codigo === '113967')!.stockErp).toBe(8);
  });

  it('un 0 que el ERP SI afirma se guarda como 0 -- es un dato, no una ausencia', async () => {
    vi.mocked(stockDeCodigos).mockResolvedValue(new Map([['113967', 0]]));
    vi.mocked(prisma.producto.findMany).mockResolvedValue([{ id: 1, codigo: '113967' }] as never);
    vi.mocked(prisma.hojaConteo.findMany).mockResolvedValue([hoja(1, [{ codigo: '113967', sueltas: 9 }])] as never);

    const resultado = await bajarStockDeLaRonda(COORDINADOR, 8078, 2);

    expect(resultado.sinStockEnErp).toBe(0);
    const filas = vi.mocked(prisma.stockRonda.createMany).mock.calls[0]![0]!.data as Array<{ stockErp: number | null }>;
    expect(filas[0]!.stockErp).toBe(0);
  });
});

describe('idempotencia: volver a llamarlo reemplaza la ronda entera', () => {
  beforeEach(() => {
    vi.mocked(stockDeCodigos).mockResolvedValue(new Map(ARRASTRAN_A_LA_2.map((c, i) => [c, 10 + i])));
  });

  it('borra las filas de esa ronda antes de escribirlas, y solo las de esa ronda', async () => {
    await bajarStockDeLaRonda(COORDINADOR, 8078, 2);

    expect(prisma.stockRonda.deleteMany).toHaveBeenCalledWith({
      where: { inventarioId: 8078, numeroConteo: 2 },
    });
    // El borrado y la insercion van en LA MISMA transaccion: si se partieran,
    // un fallo en el medio dejaria la ronda sin ninguna vara.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('dos llamadas dejan un solo `tomadoEn` por descarga, igual para todas las filas', async () => {
    const primera = await bajarStockDeLaRonda(COORDINADOR, 8078, 2);
    const segunda = await bajarStockDeLaRonda(COORDINADOR, 8078, 2);

    for (const llamada of vi.mocked(prisma.stockRonda.createMany).mock.calls) {
      const filas = llamada[0]!.data as Array<{ tomadoEn: Date }>;
      const instantes = new Set(filas.map((f) => f.tomadoEn.getTime()));
      // UN solo instante por descarga: media ronda con el stock de las 14:30 y
      // media con el de las 14:35 haria que la fecha de la pantalla no
      // signifique nada.
      expect(instantes.size).toBe(1);
    }
    expect(segunda.items).toBe(primera.items);
    // La segunda ACTUALIZA el tomadoEn: es lo que le dice al Coordinador que su
    // reintento sirvio.
    expect(Date.parse(segunda.tomadoEn)).toBeGreaterThanOrEqual(Date.parse(primera.tomadoEn));
  });

  it('el progreso queda limpio al terminar -- con exito', async () => {
    await bajarStockDeLaRonda(COORDINADOR, 8078, 2);
    expect(progresoDeLaDescarga(8078, 2)).toBeNull();
  });
});

describe('la ronda sin nada que arrastrar', () => {
  it('contesta 0 items, no toca Dynamics y limpia el stock viejo de esa ronda', async () => {
    // Todo cuadro en la ronda 1.
    vi.mocked(prisma.producto.findMany).mockResolvedValue([{ id: 1, codigo: '100150' }] as never);
    vi.mocked(prisma.hojaConteo.findMany).mockResolvedValue([hoja(1, [{ codigo: '100150', sueltas: 7 }])] as never);

    const resultado = await bajarStockDeLaRonda(COORDINADOR, 8078, 2);

    expect(resultado.items).toBe(0);
    expect(resultado.sinStockEnErp).toBe(0);
    expect(resultado.tomadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Que la ronda anterior cuadre entera es el caso FELIZ: un 409 obligaria a
    // la pantalla a tratar el mejor resultado posible como una falla.
    expect(stockDeCodigos).not.toHaveBeenCalled();
    expect(prisma.stockRonda.deleteMany).toHaveBeenCalledWith({
      where: { inventarioId: 8078, numeroConteo: 2 },
    });
  });

  it('sin codigos no exige almacen ni credenciales: no hay nada que preguntarle al ERP', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({
      ...INVENTARIO,
      sucursal: { nombre: 'Market Luzuriaga', almacenId: null },
    } as never);
    vi.mocked(d365AuthService.isConfigured).mockResolvedValue(false);
    vi.mocked(prisma.producto.findMany).mockResolvedValue([{ id: 1, codigo: '100150' }] as never);
    vi.mocked(prisma.hojaConteo.findMany).mockResolvedValue([hoja(1, [{ codigo: '100150', sueltas: 7 }])] as never);

    await expect(bajarStockDeLaRonda(COORDINADOR, 8078, 2)).resolves.toMatchObject({ items: 0 });
  });
});

describe('el error de Dynamics sube con su motivo', () => {
  it('un 502 del cliente de OData NO se aplana a un 500 ni se traga con un Map vacio', async () => {
    // El snapshot envuelve esta misma consulta en `.catch(() => [])` -- alla el
    // stock es una de siete entidades. Aca es lo unico que se vino a buscar:
    // tragarlo dejaria la ronda entera con `stockErp: null`, o sea "no se puede
    // auditar nada", como si Dynamics hubiera contestado eso.
    vi.mocked(stockDeCodigos).mockRejectedValue(new ErrorHttp(502, 'Error de Dynamics (401): Unauthorized'));

    const error = await bajarStockDeLaRonda(COORDINADOR, 8078, 2).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorHttp);
    expect((error as ErrorHttp).status).toBe(502);
    // El texto crudo es lo UNICO con que la pantalla separa "Azure rechazo las
    // credenciales" de "Dynamics contesto mal" (inventario-api.ts).
    expect((error as ErrorHttp).message).toMatch(/401|Unauthorized/);
    // Y no se escribio nada: una ronda a medias es peor que una sin stock.
    expect(prisma.stockRonda.createMany).not.toHaveBeenCalled();
  });

  it('el progreso queda limpio al terminar -- tambien con error', async () => {
    vi.mocked(stockDeCodigos).mockRejectedValue(new ErrorHttp(502, 'Error de Dynamics (500): boom'));

    await bajarStockDeLaRonda(COORDINADOR, 8078, 2).catch(() => undefined);

    // Un progreso colgado en "bajando" para siempre hace que el proximo sondeo
    // muestre el avance de una descarga que ya no existe.
    expect(progresoDeLaDescarga(8078, 2)).toBeNull();
  });

  it('sin credenciales, 400 con el texto que la pantalla mapea a `dynamics-no-configurado`', async () => {
    vi.mocked(d365AuthService.isConfigured).mockResolvedValue(false);

    const error = await bajarStockDeLaRonda(COORDINADOR, 8078, 2).catch((e: unknown) => e);

    expect((error as ErrorHttp).status).toBe(400);
    // `inventario-api.ts#comoErrorSnapshot` busca /credencial|configurad|D365_/
    // en un 400. Sin esas palabras la pantalla lo pinta como error de servidor
    // con reintento, y reintentar no trae credenciales.
    expect((error as ErrorHttp).message).toMatch(/configurad|D365_/i);
  });

  it('sin almacen en la tienda, 400 con el texto que la pantalla mapea a `sin-almacen`', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({
      ...INVENTARIO,
      sucursal: { nombre: 'Market Luzuriaga', almacenId: null },
    } as never);

    const error = await bajarStockDeLaRonda(COORDINADOR, 8078, 2).catch((e: unknown) => e);

    expect((error as ErrorHttp).status).toBe(400);
    // Es una salida DISTINTA de "faltan credenciales": esto lo arregla un
    // Administrador en Tiendas, no en Configuracion.
    expect((error as ErrorHttp).message).toMatch(/almac[eé]n/i);
  });
});

describe('las guardas de estado y de ronda', () => {
  it('la ronda anterior sin cerrar, 409 -- el conjunto todavia cambia con cada hoja', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({ ...INVENTARIO, ultimaRondaCerrada: null } as never);

    const error = await bajarStockDeLaRonda(COORDINADOR, 8078, 2).catch((e: unknown) => e);

    expect((error as ErrorHttp).status).toBe(409);
    expect((error as ErrorHttp).message).toMatch(/cerrar antes el conteo 1/);
    expect(stockDeCodigos).not.toHaveBeenCalled();
  });

  it('con el ajuste final ya iniciado, 409: no hay ronda que preparar', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue({
      ...INVENTARIO,
      estado: 'ajuste_auditor',
      ultimaRondaCerrada: 4,
    } as never);

    const error = await bajarStockDeLaRonda(COORDINADOR, 8078, 5).catch((e: unknown) => e);

    expect((error as ErrorHttp).status).toBe(409);
    expect((error as ErrorHttp).message).toMatch(/ajuste final/i);
  });

  it('un coordinador de otra tienda, 403 -- se reusa la regla de ajuste.permisos.ts', async () => {
    const deOtraTienda: ColaboradorAutenticado = { colaboradorId: 202, sucursalId: 9, rol: 'coordinador' };

    const error = await bajarStockDeLaRonda(deOtraTienda, 8078, 2).catch((e: unknown) => e);

    expect((error as ErrorHttp).status).toBe(403);
  });

  it('el inventario que no existe, 404', async () => {
    vi.mocked(prisma.inventario.findUnique).mockResolvedValue(null as never);

    const error = await bajarStockDeLaRonda(COORDINADOR, 9999, 2).catch((e: unknown) => e);

    expect((error as ErrorHttp).status).toBe(404);
  });
});
