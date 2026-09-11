/**
 * REPRODUCE UN BUG REAL (encontrado armando el caso end-to-end, 2026-09-10):
 * `crearSnapshot` es idempotente sobre `abierto: true`, pero ese flag NO
 * se limpia al cerrar el conteo (`estado -> 'conteo_cerrado'`) -- solo se
 * limpia al LACRAR (historial.service.ts#lacrar). Una tienda con el mes
 * anterior contado pero todavia sin la firma del auditor (normal, tarda
 * dias) tiene un inventario `conteo_cerrado` con `abierto: true` -- y
 * pedir el snapshot del mes SIGUIENTE devuelve el snapshot VIEJO como si
 * fuera el nuevo. La pantalla del Coordinador marca el paso 1 como "Hecho"
 * con datos de otro inventario.
 *
 * Prisma se mockea, D365 no se toca: `modo: 'ejemplo'` no llama a Dynamics.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../config/database', () => ({
  prisma: {
    sucursal: { findUnique: vi.fn() },
    inventario: { findFirst: vi.fn(), create: vi.fn() },
    catalogoItem: { create: vi.fn() },
    $transaction: vi.fn((arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as () => unknown)())),
  },
}));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from '../../config/database';
import { crearSnapshot, mensajeInventarioDuplicado } from './d365-catalogo.service';

const SUCURSAL = { id: 1, nombre: 'Market Bolívar', almacenId: null };

/** El inventario 34: contado pero SIN lacrar -- el estado real de hoy. */
const INVENTARIO_34_SIN_LACRAR = {
  id: 34,
  estado: 'conteo_cerrado',
  abierto: true, // BUG: sigue en `true` -- solo `lacrar()` lo pone en null.
  snapshotItems: 6297,
  snapshotTomadoEn: new Date('2026-08-01T10:00:00Z'),
  createdAt: new Date('2026-08-01T09:00:00Z'),
};

beforeEach(() => {
  vi.mocked(prisma.sucursal.findUnique).mockResolvedValue(SUCURSAL as never);
  vi.mocked(prisma.inventario.create).mockResolvedValue({ id: 99 } as never);
  vi.mocked(prisma.catalogoItem.create).mockResolvedValue({} as never);
});

describe('crearSnapshot: idempotencia sobre el inventario EN CURSO, no sobre "abierto"', () => {
  it('BUG: con el mes anterior conteo_cerrado y SIN lacrar, hoy devuelve su snapshot viejo', async () => {
    // El mock de `findFirst` responde como la base HOY: cualquier consulta
    // que filtre por `abierto: true` encuentra el inventario 34 (esta
    // conteo_cerrado, pero abierto nunca se limpio). Una consulta por
    // `estado: 'en_curso'` no encuentra nada -- no hay ningun conteo activo.
    vi.mocked(prisma.inventario.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => {
      if (where.abierto === true) return INVENTARIO_34_SIN_LACRAR;
      return null;
    }) as never);

    const resultado = await crearSnapshot(1, 'ejemplo');

    // CORRECTO: sin ningun conteo EN CURSO, tiene que crear un inventario
    // NUEVO (mock de `prisma.inventario.create`, id=99) -- nunca devolver
    // el 34, que ya cerro su conteo.
    expect(resultado.inventarioId).toBe(99);
  });

  it('si YA hay un conteo en curso (estado en_curso), ese SI es el idempotente', async () => {
    const enCurso = { id: 40, estado: 'en_curso', abierto: true, snapshotItems: 100, snapshotTomadoEn: new Date(), createdAt: new Date() };
    vi.mocked(prisma.inventario.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => {
      if (where.estado === 'en_curso') return enCurso;
      return null;
    }) as never);

    const resultado = await crearSnapshot(1, 'ejemplo');

    expect(resultado.inventarioId).toBe(40);
    expect(prisma.inventario.create).not.toHaveBeenCalled();
  });

  it('POST-MIGRACION: la fila cerrada ya quedo en `abierto: null`, y crearSnapshot igual crea el del mes siguiente', async () => {
    // Estado tras aplicar la migracion de datos (20260910120000): el inventario
    // 34 quedo con `abierto: null`. crearSnapshot decide por ESTADO, nunca por
    // `abierto` -- si alguien reintrodujera un `where: { abierto: true }`, este
    // test lo atajaria: no hay ninguna fila abierta, pero igual tiene que crear
    // el del mes que viene (y en la base real ya no hay dos `abierto: true` que
    // choquen contra @@unique([sucursal_id, abierto])).
    const cerradoMigrado = { ...INVENTARIO_34_SIN_LACRAR, abierto: null };
    vi.mocked(prisma.inventario.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => {
      if (where.estado === 'en_curso') return null; // ningun conteo en curso
      // El pre-chequeo de unicidad consulta por el periodo ACTUAL: el 34 es del
      // mes ANTERIOR (agosto), asi que el mes de hoy no tiene inventario todavia.
      if (where.periodoAnio !== undefined) return null;
      if (where.abierto === true) return null; // ya migrado: ninguna fila abierta
      return cerradoMigrado;
    }) as never);

    const resultado = await crearSnapshot(1, 'ejemplo');

    expect(resultado.inventarioId).toBe(99);
    expect(prisma.inventario.create).toHaveBeenCalled();
  });
});

/**
 * BUG A (caso end-to-end, 2026-09-10): armar un SEGUNDO inventario mensual en
 * una tienda que ya tiene el de ese mes choca contra
 * @@unique([sucursalId, periodoAnio, periodoMes, tipo]). El problema no era
 * solo el 500 mentiroso ("El servidor tuvo un problema. Vuelve a intentar"),
 * sino que el Coordinador esperaba la descarga COMPLETA de Dynamics (11.841
 * items) para recien AL FINAL enterarse. La regla se valida ahora ANTES de
 * bajar nada, y el P2002 queda como segunda barrera.
 */
describe('mensajeInventarioDuplicado: dice la verdad, sin "vuelve a intentar"', () => {
  it('nombra tienda, tipo, mes/anio, id y estado real -- el ejemplo del cliente', () => {
    const msg = mensajeInventarioDuplicado({
      sucursalNombre: 'Market Bolívar',
      tipo: 'mensual',
      periodoAnio: 2026,
      periodoMes: 9,
      inventarioId: 34,
      estado: 'conteo_cerrado',
    });
    expect(msg).toBe('Market Bolívar ya tiene su inventario mensual de septiembre 2026 (#34, conteo cerrado).');
    // No miente: ni "servidor/problema" ni "vuelve a intentar".
    expect(msg).not.toMatch(/servidor|problema|intent/i);
  });

  it('sin id/estado (barrera del INSERT) mantiene la verdad, mas corta', () => {
    const msg = mensajeInventarioDuplicado({
      sucursalNombre: 'Market Bolívar',
      tipo: 'mensual',
      periodoAnio: 2026,
      periodoMes: 9,
    });
    expect(msg).toBe('Market Bolívar ya tiene su inventario mensual de septiembre 2026.');
  });
});

describe('crearSnapshot: un solo inventario mensual por mes y tienda (BUG A)', () => {
  it('si ya existe el del periodo actual, corta con Conflicto (409) ANTES de la descarga', async () => {
    const ahora = new Date();
    const yaExiste = {
      id: 34,
      estado: 'conteo_cerrado',
      abierto: null,
      tipo: 'mensual',
      periodoAnio: ahora.getFullYear(),
      periodoMes: ahora.getMonth() + 1,
      snapshotItems: 6297,
      snapshotTomadoEn: new Date(),
      createdAt: new Date(),
    };
    vi.mocked(prisma.inventario.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => {
      if (where.estado === 'en_curso') return null; // ningun conteo en curso
      if (where.periodoAnio === ahora.getFullYear() && where.periodoMes === ahora.getMonth() + 1) return yaExiste;
      return null;
    }) as never);

    await expect(crearSnapshot(1, 'ejemplo')).rejects.toMatchObject({ status: 409 });
    // ANTES de la descarga: jamas se llega a crear el inventario ni a bajar el catalogo.
    expect(prisma.inventario.create).not.toHaveBeenCalled();
    expect(prisma.catalogoItem.create).not.toHaveBeenCalled();
  });

  it('el mensaje del Conflicto nombra la tienda y el inventario real', async () => {
    const ahora = new Date();
    const yaExiste = {
      id: 34,
      estado: 'conteo_cerrado',
      abierto: null,
      tipo: 'mensual',
      periodoAnio: ahora.getFullYear(),
      periodoMes: ahora.getMonth() + 1,
      snapshotItems: 6297,
      snapshotTomadoEn: new Date(),
      createdAt: new Date(),
    };
    vi.mocked(prisma.inventario.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => {
      if (where.estado === 'en_curso') return null;
      if (where.periodoAnio !== undefined) return yaExiste;
      return null;
    }) as never);

    await expect(crearSnapshot(1, 'ejemplo')).rejects.toThrow(/Market Bolívar ya tiene su inventario mensual .* \(#34, conteo cerrado\)\./);
  });

  it('SEGUNDA BARRERA: el P2002 del @@unique de periodo se traduce a 409, no a 500', async () => {
    // Pasa el pre-chequeo (findFirst -> null) pero el INSERT choca: borde de fin
    // de mes o carrera entre dos coordinadores llegando al create a la vez.
    vi.mocked(prisma.inventario.findFirst).mockResolvedValue(null as never);
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['sucursal_id', 'periodo_anio', 'periodo_mes', 'tipo'] },
    });
    vi.mocked(prisma.inventario.create).mockRejectedValue(p2002 as never);

    await expect(crearSnapshot(1, 'ejemplo')).rejects.toMatchObject({ status: 409 });
  });
});
