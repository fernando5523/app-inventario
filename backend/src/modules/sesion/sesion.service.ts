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

/**
 * Quién cuelga de una TIENDA y quién no. Regla del cliente (2026-09-10): el
 * auditor y el administrador NO tienen tienda propia -- el auditor audita toda
 * la cadena, el administrador es del sistema-- así que se eligen en el grupo
 * "administradores" del login, nunca dentro de una sucursal.
 *
 * El agrupamiento es por ROL, no por `sucursalId`: un auditor sembrado con una
 * sucursal asignada (dato viejo, Gilmer) igual va al grupo de arriba y deja de
 * aparecer bajo su vieja tienda -- sin tocar su fila (no hace falta migrar dato,
 * la columna ya es nullable y nada aquí la cambia).
 */
const ROLES_DE_TIENDA: Rol[] = ['coordinador', 'conteo'];
const ROLES_SIN_TIENDA: Rol[] = ['administrador', 'auditor'];

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
    // El conteo de la tarjeta cuenta SOLO a los de tienda (coordinador/conteo):
    // un auditor con sucursal asignada no debe inflar el número de una tienda a
    // la que, por regla, no pertenece.
    include: { _count: { select: { colaboradores: { where: { rol: { in: ROLES_DE_TIENDA }, activo: true } } } } },
  });

  return sucursales.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    colaboradores: s._count.colaboradores,
  }));
}

/**
 * Solo colaboradores activos y DE TIENDA (coordinador/conteo): uno
 * deshabilitado no aparece para elegir al ingresar, y el auditor/administrador
 * tampoco -- se eligen en el grupo "administradores" (ver listarAdministradores),
 * no colgando de una sucursal.
 */
export async function listarColaboradores(sucursalId: number): Promise<ColaboradorDto[]> {
  const colaboradores = await prisma.colaborador.findMany({
    where: { sucursalId, activo: true, rol: { in: ROLES_DE_TIENDA } },
    orderBy: { id: 'asc' },
  });

  return colaboradores.map((c) => ({ id: c.id, nombre: c.nombre, dni: c.dni, rol: c.rol }));
}

/**
 * El grupo "administradores" del login: los usuarios SIN tienda propia. Es el
 * camino separado para quienes no pertenecen a una sucursal -- el administrador
 * (del sistema) y el AUDITOR (audita toda la cadena, entrega el informe
 * consolidado). Se agrupa por ROL, no por `sucursalId null`: un auditor
 * sembrado con sucursal (Gilmer) igual entra acá.
 *
 * ENTRAR POR ESTE GRUPO NO DA PERMISOS DE ADMINISTRADOR: `ingresar` emite la
 * sesión con `rol` leído del padrón (colaborador.rol), no del grupo elegido, y
 * TODA autorización se hace por ese rol (requiereRol / *.permisos.ts). El auditor
 * conserva sus permisos de auditor; el grupo es solo dónde se lo elige.
 */
export async function listarAdministradores(): Promise<ColaboradorDto[]> {
  const administradores = await prisma.colaborador.findMany({
    where: { rol: { in: ROLES_SIN_TIENDA }, activo: true },
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
