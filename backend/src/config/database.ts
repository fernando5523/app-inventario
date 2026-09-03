/**
 * Punto unico de acceso a Prisma. Solo los *.service.ts importan este
 * archivo -- la regla de capas dura es que ningun controller toque
 * PrismaClient directamente.
 */

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
