/**
 * Un DNI no puede estar en dos cuentas habilitadas, aunque sean de tiendas
 * distintas o una sea de administrador. Ver `validarDniLibre`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', () => ({
  prisma: {
    colaborador: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: vi.fn() }));
vi.mock('../../shared/pin', () => ({ hashearPin: vi.fn(async () => 'hash') }));

import { prisma } from '../../config/database';
import { Conflicto } from '../../shared/errores';
import { actualizarEstado, crear, editar } from './usuarios.service';

const admin = { colaboradorId: 9002, sucursalId: null, rol: 'administrador' as const };
const auditor = { colaboradorId: 9006, sucursalId: 9002, rol: 'auditor' as const };
const fila = {
  id: 9007,
  nombre: 'Contador Prueba',
  dni: '00000005',
  rol: 'conteo',
  sucursalId: 9002,
  activo: true,
  creadoPorId: 9006,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.colaborador.create).mockResolvedValue(fila as never);
  vi.mocked(prisma.colaborador.update).mockResolvedValue(fila as never);
  vi.mocked(prisma.colaborador.findUnique).mockResolvedValue(fila as never);
});

describe('el DNI de una cuenta nueva', () => {
  it('ya habilitado en otra tienda: se rechaza y dice dónde', async () => {
    vi.mocked(prisma.colaborador.findFirst).mockResolvedValue({ sucursal: { nombre: 'Market Bolívar' } } as never);
    const error = await crear(auditor, { nombre: 'X', dni: '00000001', rol: 'conteo', sucursalId: 9002, pin: '583920' }).catch((e) => e);
    expect(error).toBeInstanceOf(Conflicto);
    expect(error.message).toMatch(/Market Bolívar/);
    expect(prisma.colaborador.create).not.toHaveBeenCalled();
  });

  it('ya habilitado en un administrador: se rechaza', async () => {
    vi.mocked(prisma.colaborador.findFirst).mockResolvedValue({ sucursal: null } as never);
    const error = await crear(admin, { nombre: 'X', dni: '00000001', rol: 'conteo', sucursalId: 9002, pin: '583920' }).catch((e) => e);
    expect(error.message).toMatch(/de administrador/);
  });

  it('libre, o solo en cuentas deshabilitadas: se crea', async () => {
    vi.mocked(prisma.colaborador.findFirst).mockResolvedValue(null);
    await crear(auditor, { nombre: 'X', dni: '00000009', rol: 'conteo', sucursalId: 9002, pin: '583920' });
    expect(prisma.colaborador.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { dni: '00000009', activo: true } }));
    expect(prisma.colaborador.create).toHaveBeenCalled();
  });
});

describe('editar y habilitar', () => {
  it('editar sin cambiar el DNI no lo revisa', async () => {
    await editar(auditor, 9007, { nombre: 'Otro nombre', dni: '00000005' });
    expect(prisma.colaborador.findFirst).not.toHaveBeenCalled();
  });

  it('cambiar el DNI a uno habilitado en otra cuenta se rechaza', async () => {
    vi.mocked(prisma.colaborador.findFirst).mockResolvedValue({ sucursal: { nombre: 'Market Raymondi' } } as never);
    await expect(editar(auditor, 9007, { dni: '00000001' })).rejects.toBeInstanceOf(Conflicto);
    expect(prisma.colaborador.update).not.toHaveBeenCalled();
  });

  it('habilitar una cuenta cuyo DNI ya está habilitado en otra se rechaza', async () => {
    vi.mocked(prisma.colaborador.findUnique).mockResolvedValue({ ...fila, activo: false } as never);
    vi.mocked(prisma.colaborador.findFirst).mockResolvedValue({ sucursal: { nombre: 'Market Raymondi' } } as never);
    await expect(actualizarEstado(auditor, 9007, true)).rejects.toBeInstanceOf(Conflicto);
    expect(prisma.colaborador.update).not.toHaveBeenCalled();
  });

  it('deshabilitar no revisa el DNI', async () => {
    await actualizarEstado(auditor, 9007, false);
    expect(prisma.colaborador.findFirst).not.toHaveBeenCalled();
  });
});
