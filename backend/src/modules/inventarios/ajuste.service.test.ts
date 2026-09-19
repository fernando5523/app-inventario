/**
 * EL AJUSTE FINAL DEL AUDITOR, item por item.
 *
 * Es el UNICO lugar del sistema donde se escribe un conteo mirando el stock
 * del ERP, y se puede porque ya no queda nadie contando: el inventario está
 * en `ajuste_auditor` y el Coordinador quedó bloqueado. Los tests cuidan que
 * esa ventana sea exactamente esa, que escriba sobre la ULTIMA ronda (sobre
 * una vieja el valor quedaría tapado sin que nadie se entere) y que la
 * respuesta sí traiga el stock -- que es lo que la separa de la corrección.
 *
 * Prisma mockeado, sin base.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  hojaConteo: { aggregate: vi.fn() },
  producto: { findFirst: vi.fn() },
  conteo: { findUnique: vi.fn(), update: vi.fn() },
  catalogoItem: { findFirst: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

const registrarAuditoriaMock = vi.hoisted(() => vi.fn());
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: registrarAuditoriaMock }));

import { Conflicto, NoEncontrado, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import type { EstadoConAjuste } from './ajuste.permisos';
import { ajustarConteo } from './ajuste.service';

const BOLIVAR = 3;
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };
const oscar: ColaboradorAutenticado = { colaboradorId: 301, sucursalId: BOLIVAR, rol: 'coordinador' };

const CONTEO_ORIGINAL = {
  id: 55,
  productoId: 512,
  sueltas: 3,
  confirmadoPorEscaner: true,
  contadoEn: new Date('2026-09-18T10:00:00.000Z'),
  empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }], // 2x12 + 3 = 27
};

const AJUSTE = { empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }], sueltas: 6, motivo: 'Recuento con el ERP: 30' };

function mockInventario(estado: EstadoConAjuste = 'ajuste_auditor') {
  prismaMock.inventario.findUnique.mockResolvedValue({ id: 8039, sucursalId: BOLIVAR, estado });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInventario();
  prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: 3 } });
  prismaMock.producto.findFirst.mockResolvedValue({
    id: 512,
    codigo: 'ITM-001',
    hojaId: 7,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  });
  prismaMock.conteo.findUnique.mockResolvedValue(CONTEO_ORIGINAL);
  prismaMock.conteo.update.mockResolvedValue({
    ...CONTEO_ORIGINAL,
    sueltas: 6,
    confirmadoPorEscaner: false,
  });
  prismaMock.catalogoItem.findFirst.mockResolvedValue({ stockErp: 30 });
});

describe('ajustarConteo: el Auditor escribe viendo el ERP', () => {
  it('reemplaza el valor y devuelve el antes y el después', async () => {
    const r = await ajustarConteo(gilmer, 8039, 512, AJUSTE);

    expect(r.totalAnterior).toBe(27);
    expect(r.total).toBe(30);
  });

  /**
   * LO QUE SEPARA ESTE ENDPOINT DE LA CORRECCION DEL COORDINADOR. Acá el
   * stock SÍ viaja: comparar contra el ERP es literalmente el trabajo del
   * Auditor, y el conteo ciego ya no aplica porque nadie está contando.
   */
  it('devuelve stockErp y la diferencia: es su trabajo comparar', async () => {
    const r = await ajustarConteo(gilmer, 8039, 512, AJUSTE);

    expect(r.stockErp).toBe(30);
    expect(r.diferencia).toBe(0); // 30 contadas contra 30 del ERP
  });

  it('la diferencia es null -- no 0 -- cuando el snapshot no trajo stock', async () => {
    // "No sé" no es "cero": un 0 afirmaría que contó exactamente lo que
    // decía el ERP, que es una afirmación fuerte.
    prismaMock.catalogoItem.findFirst.mockResolvedValue({ stockErp: null });
    const r = await ajustarConteo(gilmer, 8039, 512, AJUSTE);

    expect(r.stockErp).toBeNull();
    expect(r.diferencia).toBeNull();
  });

  it('el stock sale del snapshot del arranque, por código y de ESTE inventario', async () => {
    await ajustarConteo(gilmer, 8039, 512, AJUSTE);
    expect(prismaMock.catalogoItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inventarioId: 8039, codigo: 'ITM-001' } }),
    );
  });
});

/**
 * SOBRE LA ULTIMA RONDA Y NINGUNA OTRA. Escribir sobre una ronda vieja no
 * fallaría: la matriz lee todas las rondas, pero manda la más nueva
 * (`conteoQueManda`). El Auditor vería "guardado" y el número no cambiaría en
 * ningún lado -- el peor tipo de bug, el que no avisa.
 */
describe('ajustarConteo: solo el último conteo', () => {
  it('busca el producto en la hoja de la ÚLTIMA ronda', async () => {
    await ajustarConteo(gilmer, 8039, 512, AJUSTE);

    expect(prismaMock.producto.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 512, hoja: { inventarioId: 8039, numeroConteo: 3 } },
      }),
    );
  });

  it('un producto que no está en la última ronda, 404 con la ronda en el mensaje', async () => {
    prismaMock.producto.findFirst.mockResolvedValue(null);
    const error = await ajustarConteo(gilmer, 8039, 512, AJUSTE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NoEncontrado);
    expect((error as Error).message).toMatch(/última ronda \(3\)/);
  });

  it('sin ninguna hoja, 404: no hay nada que ajustar', async () => {
    prismaMock.hojaConteo.aggregate.mockResolvedValue({ _max: { numeroConteo: null } });
    await expect(ajustarConteo(gilmer, 8039, 512, AJUSTE)).rejects.toThrow(NoEncontrado);
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });
});

describe('ajustarConteo: lo que queda registrado', () => {
  it('audita como conteo.ajustado, con el antes, el después y el motivo', async () => {
    await ajustarConteo(gilmer, 8039, 512, AJUSTE);

    expect(registrarAuditoriaMock).toHaveBeenCalledWith({
      actorId: gilmer.colaboradorId,
      accion: 'conteo.ajustado',
      entidad: 'conteo',
      entidadId: 55,
      detalle: {
        productoId: 512,
        codigo: 'ITM-001',
        ronda: 3,
        valorAnterior: 27,
        valorNuevo: 30,
        motivo: 'Recuento con el ERP: 30',
      },
    });
  });

  it('baja confirmadoPorEscaner y no toca contadoEn', async () => {
    await ajustarConteo(gilmer, 8039, 512, AJUSTE);
    const [{ data }] = prismaMock.conteo.update.mock.calls[0] as [{ data: Record<string, unknown> }];

    expect(data['confirmadoPorEscaner']).toBe(false);
    expect(data).not.toHaveProperty('contadoEn');
  });
});

describe('ajustarConteo: las guardas', () => {
  it('sin el ajuste iniciado, 409 y no escribe nada', async () => {
    mockInventario('en_curso');
    await expect(ajustarConteo(gilmer, 8039, 512, AJUSTE)).rejects.toThrow(Conflicto);
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });

  it('con el conteo ya cerrado, 409: el ajuste terminó', async () => {
    mockInventario('conteo_cerrado');
    await expect(ajustarConteo(gilmer, 8039, 512, AJUSTE)).rejects.toThrow(Conflicto);
  });

  /**
   * EL COORDINADOR NO ENTRA ACA, y no es un permiso de más: esta respuesta
   * lleva `stockErp`. Si pudiera llamarla, vería el número que las pasadas
   * cruzadas existen para que no vea.
   */
  it('el Coordinador NO, ni dentro de la ventana del ajuste', async () => {
    await expect(ajustarConteo(oscar, 8039, 512, AJUSTE)).rejects.toThrow(Prohibido);
    expect(prismaMock.catalogoItem.findFirst).not.toHaveBeenCalled();
  });

  it('un inventario que no existe, 404', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(ajustarConteo(gilmer, 8039, 512, AJUSTE)).rejects.toThrow(NoEncontrado);
  });

  it('una línea con un empaque que el producto no tiene NO se persiste a medias', async () => {
    const inventado = { ...AJUSTE, empaques: [{ empaqueNombre: 'Pallet', cantidad: 1 }] };
    await expect(ajustarConteo(gilmer, 8039, 512, inventado)).rejects.toThrow();
    expect(prismaMock.conteo.update).not.toHaveBeenCalled();
  });
});
