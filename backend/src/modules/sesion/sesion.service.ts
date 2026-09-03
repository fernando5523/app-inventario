/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura).
 * Implementa los 3 metodos de RepositorioSesion que el login necesita:
 * sucursales, colaboradores(sucursalId), ingresar(colaboradorId, pin).
 */

import crypto from 'node:crypto';
import { prisma } from '../../config/database';
import { NoAutorizado, NoEncontrado } from '../../shared/errores';
import { verificarPin } from '../../shared/pin';
import type { Rol } from '../../shared/tipos';

const DURACION_SESION_MS = 12 * 60 * 60 * 1000; // 12 horas, igual que sesion-memoria.ts

export interface SucursalDto {
  id: number;
  nombre: string;
  colaboradores: number;
}

export interface ColaboradorDto {
  id: number;
  nombre: string;
  dni: string;
  rol: Rol;
}

export interface SesionDto {
  colaborador: ColaboradorDto;
  /** null solo para rol=administrador: es del sistema, no de una tienda. */
  sucursal: SucursalDto | null;
  token: string;
  expiraEn: string;
}

/** Solo tiendas activas: una deshabilitada no se ofrece para iniciar sesion. */
export async function listarSucursales(): Promise<SucursalDto[]> {
  const sucursales = await prisma.sucursal.findMany({
    where: { activa: true },
    orderBy: { id: 'asc' },
    include: { _count: { select: { colaboradores: true } } },
  });

  return sucursales.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    colaboradores: s._count.colaboradores,
  }));
}

/** Solo colaboradores activos: uno deshabilitado no aparece para elegir al ingresar. */
export async function listarColaboradores(sucursalId: number): Promise<ColaboradorDto[]> {
  const colaboradores = await prisma.colaborador.findMany({
    where: { sucursalId, activo: true },
    orderBy: { id: 'asc' },
  });

  return colaboradores.map((c) => ({ id: c.id, nombre: c.nombre, dni: c.dni, rol: c.rol }));
}

/**
 * Camino de login separado para el rol=administrador: no pertenece a
 * ninguna sucursal (sucursalId null a proposito, ver SesionDto#sucursal),
 * asi que no puede salir de `listarColaboradores(sucursalId)` como el resto.
 * Sin este endpoint, el rol existe en la base y en el codigo pero nadie
 * puede entrar por el.
 */
export async function listarAdministradores(): Promise<ColaboradorDto[]> {
  const administradores = await prisma.colaborador.findMany({
    where: { sucursalId: null, activo: true },
    orderBy: { id: 'asc' },
  });

  return administradores.map((c) => ({ id: c.id, nombre: c.nombre, dni: c.dni, rol: c.rol }));
}

/**
 * El PIN vive hasheado (argon2) en nuestra base -- nunca en claro. El rate
 * limiting por colaborador contra el espacio chico de 6 digitos se aplica
 * ANTES de llegar aca (ver sesion.routes.ts, limitadorIngreso).
 */
export async function ingresar(colaboradorId: number, pin: string): Promise<SesionDto> {
  const colaborador = await prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    include: { sucursal: { include: { _count: { select: { colaboradores: true } } } } },
  });
  if (!colaborador) throw new NoEncontrado('Colaborador no encontrado.');
  if (!colaborador.activo) throw new NoAutorizado('Esta cuenta esta deshabilitada.');

  const pinValido = await verificarPin(colaborador.pinHash, pin);
  if (!pinValido) throw new NoAutorizado('PIN incorrecto.');

  const token = crypto.randomBytes(32).toString('hex');
  const expiraEn = new Date(Date.now() + DURACION_SESION_MS);

  await prisma.sesionToken.create({
    data: { token, colaboradorId: colaborador.id, expiraEn },
  });

  return {
    colaborador: {
      id: colaborador.id,
      nombre: colaborador.nombre,
      dni: colaborador.dni,
      rol: colaborador.rol,
    },
    // colaborador.sucursal es null unicamente para rol=administrador
    // (sucursalId nulo, ver prisma/schema.prisma#Colaborador).
    sucursal: colaborador.sucursal
      ? {
          id: colaborador.sucursal.id,
          nombre: colaborador.sucursal.nombre,
          colaboradores: colaborador.sucursal._count.colaboradores,
        }
      : null,
    token,
    expiraEn: expiraEn.toISOString(),
  };
}

/**
 * Usado por auth.middleware.ts -- ahi tampoco se importa PrismaClient
 * directo. Revalida `activo` en CADA request, no solo al ingresar: si a
 * alguien lo deshabilitan a mitad de turno, el token que ya tiene en el
 * telefono tiene que dejar de servir en la proxima llamada, no recien
 * cuando expire por tiempo.
 */
export async function verificarToken(token: string) {
  const sesion = await prisma.sesionToken.findUnique({
    where: { token },
    include: { colaborador: true },
  });
  if (!sesion || sesion.expiraEn.getTime() < Date.now()) return null;
  if (!sesion.colaborador.activo) return null;

  return {
    colaboradorId: sesion.colaborador.id,
    sucursalId: sesion.colaborador.sucursalId,
    rol: sesion.colaborador.rol,
  };
}
