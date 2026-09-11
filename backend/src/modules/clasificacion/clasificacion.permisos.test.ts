/**
 * Quien puede clasificar productos: SOLO el Auditor. Ni siquiera el
 * administrador -- la clasificacion mueve plata de un lado a otro de la
 * liquidacion (empresa vs empleado), y el cliente puso esa decision en manos
 * del Auditor. Puro, sin Prisma: es la regla, no el acceso a datos.
 */
import { describe, expect, it } from 'vitest';

import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';
import { validarPermisoDeClasificacion } from './clasificacion.permisos';

const actor = (rol: Rol): ColaboradorAutenticado => ({ colaboradorId: 1, sucursalId: 1, rol });

describe('validarPermisoDeClasificacion: solo el Auditor', () => {
  it('el auditor pasa', () => {
    expect(() => validarPermisoDeClasificacion(actor('auditor'))).not.toThrow();
  });

  it.each(['administrador', 'coordinador', 'conteo'] as const)('%s no puede clasificar', (rol) => {
    expect(() => validarPermisoDeClasificacion(actor(rol))).toThrow(/Auditor/);
  });
});
