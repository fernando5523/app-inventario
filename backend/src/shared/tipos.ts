/**
 * Tipos compartidos entre capas (no son el dominio: eso vive en el front,
 * mobile/lib/dominio/tipos.ts, y este backend lo sirve, no lo redefine para
 * las respuestas de la API).
 */

import type { Request } from 'express';

/** Los 4 roles reales (prisma/schema.prisma#Rol) -- nunca se acepta del cliente. */
export type Rol = 'administrador' | 'coordinador' | 'conteo' | 'auditor';

/** Colaborador autenticado, colgado del request por auth.middleware.ts. */
export interface ColaboradorAutenticado {
  colaboradorId: number;
  /** null solo para rol=administrador -- ver prisma/schema.prisma#Colaborador.sucursalId. */
  sucursalId: number | null;
  rol: Rol;
}

export interface RequestAutenticado extends Request {
  colaborador?: ColaboradorAutenticado;
}
