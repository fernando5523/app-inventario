/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura).
 * Implementa los 3 metodos de RepositorioSesion que el login necesita:
 * sucursales, colaboradores(sucursalId), ingresar(colaboradorId, pin).
 */

import crypto from 'node:crypto';
import { prisma } from '../../config/database';
import { registrarAuditoria } from '../../shared/auditoria';
import { validarCambioDePin } from './sesion.pin';
import { NoAutorizado, NoEncontrado } from '../../shared/errores';
import { hashearPin, verificarPin } from '../../shared/pin';
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

/**
 * Cambia el PIN del colaborador de la SESION.
 *
 * Exige el PIN actual aunque el token ya pruebe quien es, y no es
 * redundante: un token robado (un telefono desbloqueado sobre el mostrador,
 * una sesion que quedo abierta) alcanzaria para cambiarle el PIN al dueno y
 * dejarlo afuera de su propia cuenta. Pedir el actual convierte ese robo en
 * "puede usar la sesion hasta que expire" en vez de "se quedo con la cuenta".
 *
 * Al cambiar el PIN se cierran TODAS las demas sesiones de esa persona: si
 * lo esta cambiando porque sospecha que alguien lo conocia, dejar vivas las
 * sesiones abiertas de ese alguien haria que el cambio no sirviera de nada.
 */
export async function cambiarPinPropio(colaboradorId: number, pinActual: string, pinNuevo: string): Promise<void> {
  validarCambioDePin({ colaboradorId, pinActual, pinNuevo });

  const colaborador = await prisma.colaborador.findUnique({ where: { id: colaboradorId } });
  if (!colaborador || !colaborador.activo) throw new NoAutorizado('Cuenta no disponible.');

  if (!(await verificarPin(colaborador.pinHash, pinActual))) {
    throw new NoAutorizado('El PIN actual no es correcto.');
  }

  const pinHash = await hashearPin(pinNuevo);
  await prisma.$transaction([
    prisma.colaborador.update({ where: { id: colaboradorId }, data: { pinHash } }),
    // Todas menos ninguna: la sesion actual tambien se cierra. Es un
    // segundo de molestia (volver a ingresar) a cambio de que un cambio de
    // PIN signifique de verdad "desde ahora, solo yo".
    prisma.sesionToken.deleteMany({ where: { colaboradorId } }),
  ]);

  await registrarAuditoria({
    actorId: colaboradorId,
    accion: 'colaborador.pin_cambiado_por_si_mismo',
    entidad: 'colaborador',
    entidadId: colaboradorId,
    // Nunca el PIN, ni el viejo ni el nuevo -- ver prisma/schema.prisma#RegistroAuditoria.
    detalle: null,
  });
}
