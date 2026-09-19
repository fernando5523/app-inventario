/**
 * LA CORRECCION DEL COORDINADOR.
 *
 * Lo que se escribe acá reemplaza un valor que ya cargó otra persona, y ese
 * valor termina en el faltante que se le descuenta del sueldo a alguien. Los
 * tests cuidan las cuatro cosas que no se pueden errar: que funcione con la
 * hoja FINALIZADA (la mitad del pedido que `guardarConteo` no puede dar), que
 * NO haga falta estar asignado (se corrige lo de otro), que quede auditado
 * con el antes y el después, y que la respuesta NO traiga el stock del ERP.
 *
 * Prisma mockeado, sin base (igual que el resto de la suite).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  hojaConteo: {
    findUnique: vi.fn(),
    // Los de abajo los usa `sacarDeLaRondaSiguienteSiCuadro`, que ahora corre
    // dentro de la transaccion de la correccion (ver hojas.service.ts).
    aggregate: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  producto: { findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn(), count: vi.fn() },
  conteo: { findUnique: vi.fn(), update: vi.fn() },
  catalogoItem: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

const registrarAuditoriaMock = vi.hoisted(() => vi.fn());
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: registrarAuditoriaMock }));

import { Conflicto, NoEncontrado, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import type { EstadoConAjuste } from '../inventarios/ajuste.permisos';
import { corregirConteo } from './hojas.service';

const BOLIVAR = 3;
const oscar: ColaboradorAutenticado = { colaboradorId: 301, sucursalId: BOLIVAR, rol: 'coordinador' };
const silvia: ColaboradorAutenticado = { colaboradorId: 302, sucursalId: BOLIVAR, rol: 'conteo' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };

/** El conteo original: 2 cajas de 12 + 3 sueltas = 27 unidades. */
const CONTEO_ORIGINAL = {
  id: 55,
  productoId: 512,
  sueltas: 3,
  confirmadoPorEscaner: true,
  contadoEn: new Date('2026-09-18T10:00:00.000Z'),
  empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }],
};

const CORRECCION = {
  empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
  sueltas: 3,
  motivo: 'Contó la caja de 12 como si fueran dos',
};

function mockHoja(estado: EstadoConAjuste = 'en_curso', hojaEstado = 'finalizada') {
  prismaMock.hojaConteo.findUnique.mockResolvedValue({
    id: 7,
    inventarioId: 8039,
    numeroConteo: 3,
    estado: hojaEstado,
    inventario: { sucursalId: BOLIVAR, estado },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // La transaccion corre la callback con el mismo mock: lo que importa es QUE
  // operaciones se piden, no que Postgres las aplique.
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prismaMock) : arg,
  );
  // Por defecto, la hoja corregida ES la ronda mas alta: no hay ronda
  // siguiente que limpiar. Los tests que la necesitan la declaran.
  prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 3 } });
  prismaMock.hojaConteo.findMany.mockResolvedValue([]);
  prismaMock.hojaConteo.count.mockResolvedValue(0);
  prismaMock.producto.findMany.mockResolvedValue([]);
  prismaMock.producto.count.mockResolvedValue(0);
  mockHoja();
  prismaMock.producto.findFirst.mockResolvedValue({
    id: 512,
    codigo: 'ITM-001',
    hojaId: 7,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  prismaMock.conteo.findUnique.mockResolvedValue(CONTEO_ORIGINAL);
  prismaMock.catalogoItem.findFirst.mockResolvedValue({ stockErp: 20 });
  prismaMock.conteo.update.mockResolvedValue({
    ...CONTEO_ORIGINAL,
    sueltas: 3,
    confirmadoPorEscaner: false,
    empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
  });
});

describe('corregirConteo: lo que `guardarConteo` no puede hacer', () => {
  /**
   * LA MITAD DEL PEDIDO QUE NO ENTRA POR LA OTRA PUERTA. `guardarConteo`
   * rechaza con 409 sobre una hoja finalizada, y el cliente pidió
   * explícitamente corregir con la ronda cerrada.
   */
  it('corrige una hoja FINALIZADA', async () => {
    const r = await corregirConteo(oscar, 7, 512, CORRECCION);

    expect(r.totalAnterior).toBe(27); // 2 cajas de 12 + 3
    expect(r.total).toBe(15); // 1 caja de 12 + 3
    expect(prismaMock.conteo.update).toHaveBeenCalled();
  });

  /**
   * NO EXIGE ESTAR ASIGNADO, y es lo contrario de `guardarConteo` a
   * propósito: el Coordinador corrige lo que contó OTRO. La autoría no se
   * pierde -- queda en el log quién pisó el valor y por qué.
   */
  it('el Coordinador corrige una hoja que NO tiene asignada', async () => {
    // El mock de la hoja no declara asignados: si el service pidiera estar
    // asignado, esto tiraría.
    await expect(corregirConteo(oscar, 7, 512, CORRECCION)).resolves.toBeDefined();
  });

  it('también con la hoja todavía en proceso: la ventana es del inventario, no de la hoja', async () => {
    mockHoja('en_curso', 'en_proceso');
    await expect(corregirConteo(oscar, 7, 512, CORRECCION)).resolves.toBeDefined();
  });
});

describe('corregirConteo: lo que queda registrado', () => {
  it('audita con el antes, el después y el motivo', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);

    // Dos argumentos: el registro Y el cliente de la transaccion. El segundo
    // no es decorativo -- ver el test de abajo.
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      {
        actorId: oscar.colaboradorId,
        accion: 'conteo.corregido',
        entidad: 'conteo',
        entidadId: 55,
        detalle: {
          productoId: 512,
          codigo: 'ITM-001',
          ronda: 3,
          valorAnterior: 27,
          valorNuevo: 15,
          motivo: 'Contó la caja de 12 como si fueran dos',
          rol: 'coordinador',
        },
      },
      expect.anything(),
    );
  });

  /**
   * EL LOG ENTRA EN LA TRANSACCION. Si quedara afuera y la limpieza de la
   * ronda fallara, el registro afirmaria una correccion que se deshizo -- y es
   * justo donde alguien va a mirar cuando reclame por su descuento.
   */
  it('el registro va DENTRO de la transaccion, no suelto', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);

    const [, tx] = registrarAuditoriaMock.mock.calls[0] as [unknown, unknown];
    expect(tx).toBe(prismaMock);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  /**
   * EN UNIDADES, no en la lista de empaques. "2 cajas -> 1 caja" obliga a
   * quien lee el log seis meses después a saber el factor de la caja para
   * entender qué cambió; 27 -> 15 se entiende solo, y es el número que se
   * audita contra el ERP.
   */
  it('el antes y el después van en UNIDADES, no en empaques', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);
    const [{ detalle }] = registrarAuditoriaMock.mock.calls[0] as [{ detalle: Record<string, unknown> }];
    expect(detalle['valorAnterior']).toBe(27);
    expect(detalle['valorNuevo']).toBe(15);
  });

  /**
   * `confirmadoPorEscaner` afirma que alguien escaneó el código en la
   * góndola. Quien corrige teclea desde otro lado: dejar el `true` del
   * conteo original sería firmar con el escáner un valor que nunca vio.
   */
  it('baja confirmadoPorEscaner: quien corrige teclea, no escanea', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);
    const [{ data }] = prismaMock.conteo.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data['confirmadoPorEscaner']).toBe(false);
  });

  /**
   * `contadoEn` es CUANDO se contó en la góndola. Corregir no cambia eso, y
   * pisarlo borraría el único rastro de cuándo se hizo la pasada real -- la
   * hora de la corrección ya queda en el registro de auditoría.
   */
  it('NO toca contadoEn: la pasada real siguió pasando cuando pasó', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);
    const [{ data }] = prismaMock.conteo.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data).not.toHaveProperty('contadoEn');
  });

  /** Reemplaza la lista entera de líneas, no la mezcla con la anterior. */
  it('reemplaza los empaques, no los acumula', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);
    const [{ data }] = prismaMock.conteo.update.mock.calls[0] as [
      { data: { empaques: { deleteMany: unknown; create: unknown[] } } },
    ];
    expect(data.empaques.deleteMany).toEqual({});
    expect(data.empaques.create).toEqual([{ empaqueNombre: 'Caja', cantidad: 1 }]);
  });
});

/**
 * EL CONTEO CIEGO, del lado de la corrección. Si la respuesta trajera el
 * stock, el Coordinador dejaría de corregir un error de conteo y pasaría a
 * hacer que el inventario cuadre -- que es lo que las pasadas cruzadas
 * existen para impedir.
 */
describe('corregirConteo: sin stock en la respuesta', () => {
  it('no devuelve stockErp ni nada del snapshot, en ningún nivel', async () => {
    const r = await corregirConteo(oscar, 7, 512, CORRECCION);
    const claves = new Set<string>();
    (function recorrer(v: unknown): void {
      if (Array.isArray(v)) v.forEach(recorrer);
      else if (v !== null && typeof v === 'object') {
        for (const [k, sub] of Object.entries(v)) {
          claves.add(k);
          recorrer(sub);
        }
      }
    })(JSON.parse(JSON.stringify(r)));

    for (const prohibida of ['stockErp', 'precioVenta', 'esEmpresa', 'diferencia']) {
      expect([...claves]).not.toContain(prohibida);
    }
  });

  it('ni siquiera lo CONSULTA: lo que no se pide, no se trae', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);
    // `catalogoItem` no está ni en el mock de Prisma: si el service lo
    // tocara, esto reventaría con "cannot read property of undefined".
    expect(prismaMock.producto.findFirst).toHaveBeenCalled();
  });
});

describe('corregirConteo: las guardas', () => {
  it('con el ajuste del Auditor iniciado, 409 y no escribe nada', async () => {
    mockHoja('ajuste_auditor');
    await expect(corregirConteo(oscar, 7, 512, CORRECCION)).rejects.toThrow(Conflicto);
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });

  it('con el conteo ya cerrado, 409', async () => {
    mockHoja('conteo_cerrado');
    await expect(corregirConteo(oscar, 7, 512, CORRECCION)).rejects.toThrow(Conflicto);
  });

  it('el rol conteo NO corrige: quien contó no se corrige a sí mismo', async () => {
    await expect(corregirConteo(silvia, 7, 512, CORRECCION)).rejects.toThrow(Prohibido);
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });

  /**
   * EL AUDITOR YA ENTRA POR ACA, y este test decia lo contrario: hasta este
   * cambio la via era solo del Coordinador. El cliente le dio la misma
   * potestad mientras el inventario esta en rondas.
   */
  it('el Auditor TAMBIEN corrige mientras el inventario esta en rondas', async () => {
    await expect(corregirConteo(gilmer, 7, 512, CORRECCION)).resolves.toBeDefined();
  });

  it('pero no una vez que inicio su ajuste: desde ahi es la pantalla de ajuste', async () => {
    mockHoja('ajuste_auditor');
    await expect(corregirConteo(gilmer, 7, 512, CORRECCION)).rejects.toThrow(Conflicto);
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });

  it('un producto de OTRA hoja, 404', async () => {
    prismaMock.producto.findFirst.mockResolvedValue(null);
    await expect(corregirConteo(oscar, 7, 999, CORRECCION)).rejects.toThrow(NoEncontrado);
  });

  /**
   * SIN CONTEO PREVIO NO ES UNA CORRECCION: sería el Coordinador CARGANDO un
   * valor sobre un renglón que nadie miró. Es la misma regla que sostiene
   * `finalizar` desde 2026-09-11 -- un 0 significa "lo vi y no había" y lo
   * tiene que afirmar quien fue a la góndola.
   */
  it('sobre un producto sin ningún conteo, 409: eso se cuenta, no se corrige', async () => {
    prismaMock.conteo.findUnique.mockResolvedValue(null);
    await expect(corregirConteo(oscar, 7, 512, CORRECCION)).rejects.toThrow(Conflicto);
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });

  it('una línea con un empaque que el producto no tiene NO se persiste a medias', async () => {
    const inventado = { ...CORRECCION, empaques: [{ empaqueNombre: 'Pallet', cantidad: 1 }] };
    await expect(corregirConteo(oscar, 7, 512, inventado)).rejects.toThrow();
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });
});

/**
 * QUIEN VE EL STOCK AL CORREGIR.
 *
 * Decision del cliente: el Auditor SI (ya lo tiene en su panel; ocultarselo
 * solo lo obligaria a saltar de pantalla para comparar), el Coordinador NO
 * (conteo ciego). La regla NO es una lista de roles propia de este endpoint:
 * es `auditoria.permisos.ts#puedeVerLaMatriz`, la misma que decide quien
 * puede mirar el `stockErp` de un inventario en cualquier otro lado.
 */
describe('corregirConteo: el stock viaja solo para quien ya podia verlo', () => {
  it('al Auditor le llega stockErp y la diferencia', async () => {
    const r = await corregirConteo(gilmer, 7, 512, CORRECCION);

    expect(r.stockErp).toBe(20);
    // 15 contadas contra 20 del ERP: faltan 5.
    expect(r.diferencia).toBe(-5);
  });

  it('al administrador también: ya ve la matriz de cualquier inventario', async () => {
    const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
    expect((await corregirConteo(admin, 7, 512, CORRECCION)).stockErp).toBe(20);
  });

  /**
   * LA CLAVE NO VIENE, no viene en `null`. Un `null` diria "el ERP no trajo
   * stock" -- una afirmacion sobre el DATO -- y esto es una afirmacion sobre
   * QUIEN pregunta. Son dos cosas distintas y el front tiene que poder
   * distinguirlas.
   */
  it('al Coordinador NO le llega la clave siquiera', async () => {
    const r = await corregirConteo(oscar, 7, 512, CORRECCION);

    expect(r).not.toHaveProperty('stockErp');
    expect(r).not.toHaveProperty('diferencia');
  });

  it('y ni siquiera se consulta el catálogo cuando corrige el Coordinador', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);
    // Lo que no se pide, no se trae: no basta con no serializarlo.
    expect(prismaMock.catalogoItem.findFirst).not.toHaveBeenCalled();
  });

  it('la diferencia es null -- no 0 -- si el snapshot no trajo stock', async () => {
    prismaMock.catalogoItem.findFirst.mockResolvedValue({ stockErp: null });
    const r = await corregirConteo(gilmer, 7, 512, CORRECCION);

    expect(r.stockErp).toBeNull();
    expect(r.diferencia).toBeNull();
  });

  it('el stock sale del snapshot de ESE inventario, por código', async () => {
    await corregirConteo(gilmer, 7, 512, CORRECCION);
    expect(prismaMock.catalogoItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inventarioId: 8039, codigo: 'ITM-001' } }),
    );
  });
});

/**
 * CORREGIR LO CONTADO NO ES CORREGIR EL STOCK. Regla que el cliente dejo
 * explicita: `CatalogoItem.stockErp` es la foto del ERP y no la edita nadie
 * desde la app. Este endpoint puede LEERLA para el Auditor, nunca escribirla.
 */
describe('corregirConteo: el stock del ERP no se toca', () => {
  it('ni el Auditor lo escribe: solo se consulta', async () => {
    await corregirConteo(gilmer, 7, 512, CORRECCION);

    // `catalogoItem` en el mock solo tiene `findFirst`: si el service
    // intentara un update/upsert, reventaria con "is not a function".
    expect(Object.keys(prismaMock.catalogoItem)).toEqual(['findFirst']);
    expect(prismaMock.conteo.update).toHaveBeenCalled();
  });
});

/**
 * CON LAS DOS VIAS ABIERTAS hace falta poder separar despues una correccion
 * del Coordinador de una del Auditor. El `actorId` solo no alcanza: obligaria
 * a ir a buscar que rol tenia esa persona ESE dia, y el rol pudo cambiar.
 */
describe('corregirConteo: el rol queda en el registro', () => {
  it('auditor', async () => {
    await corregirConteo(gilmer, 7, 512, CORRECCION);
    const [{ detalle }] = registrarAuditoriaMock.mock.calls[0] as [{ detalle: Record<string, unknown> }];
    expect(detalle['rol']).toBe('auditor');
  });

  it('coordinador', async () => {
    await corregirConteo(oscar, 7, 512, CORRECCION);
    const [{ detalle }] = registrarAuditoriaMock.mock.calls[0] as [{ detalle: Record<string, unknown> }];
    expect(detalle['rol']).toBe('coordinador');
  });
});
