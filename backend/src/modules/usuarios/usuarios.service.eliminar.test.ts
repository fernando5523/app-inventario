/**
 * Eliminar una cuenta es todo o nada: si el borrado falla porque la persona
 * tiene historia, sus hojas siguen asignadas y su sesión sigue abierta.
 *
 * La base es falsa: lo que se prueba es que cada escritura pasa por la MISMA
 * transacción que el borrado, que es lo que hace que Postgres las deshaga.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const tx = vi.hoisted(() => ({
  sesionToken: { deleteMany: vi.fn() },
  colaborador: { updateMany: vi.fn(), delete: vi.fn() },
  hojaConteo: { updateMany: vi.fn() },
}));

vi.mock('../../config/database', () => ({
  prisma: {
    colaborador: { findUnique: vi.fn() },
    // Si alguna escritura se hiciera por fuera de la transacción, iría a
    // estos y la prueba lo detecta.
    sesionToken: { deleteMany: vi.fn() },
    hojaConteo: { updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));

import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { Conflicto } from '../../shared/errores';
import { eliminar } from './usuarios.service';

const auditor = { colaboradorId: 9006, sucursalId: 9002, rol: 'auditor' as const };
const contador = { id: 9003, nombre: 'Contador', dni: '00000001', rol: 'conteo', sucursalId: 9002 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.colaborador.findUnique).mockResolvedValue(contador as never);
});

describe('eliminar una cuenta', () => {
  it('con historia: falla con un aviso y todas las escrituras iban en la transacción', async () => {
    tx.colaborador.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }),
    );

    await expect(eliminar(auditor, 9003)).rejects.toBeInstanceOf(Conflicto);

    expect(tx.hojaConteo.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.sesionToken.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.hojaConteo.updateMany).not.toHaveBeenCalled();
    expect(prisma.sesionToken.deleteMany).not.toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('sin historia: se borra y queda en la auditoría', async () => {
    tx.colaborador.delete.mockResolvedValue(contador);

    await eliminar(auditor, 9003);

    expect(tx.colaborador.delete).toHaveBeenCalledWith({ where: { id: 9003 } });
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
  });
});
