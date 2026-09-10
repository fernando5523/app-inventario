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
import { crearSnapshot } from './d365-catalogo.service';

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
});
