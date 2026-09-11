import { describe, expect, it } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarAcceso } from './liquidacion.permisos';

const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
// El auditor ya no pertenece a una tienda: entra por "administradores" en el login.
const auditorSinTienda: ColaboradorAutenticado = { colaboradorId: 104, sucursalId: null, rol: 'auditor' };
const jose: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
const maria: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

/**
 * DECISIÓN DEL CLIENTE (2026-09-11): la liquidación pasa al AUDITOR. Textual:
 * "el Coordinador deja de ver la liquidacion y ejecutarlo, ahora lo realiza el
 * auditor". Es lo que pidió Gilmer en la reunión: los coordinadores "no van a
 * poder ver el resultado del inventario, eso netamente nos corresponde a mi
 * persona y a Michell".
 *
 * UN SOLO permiso para ver y para ejecutar (leer la planilla, cargar los
 * ajustes, liquidar). Antes eran dos porque el coordinador cerraba y el
 * auditor miraba; ahora las dos cosas las hace la misma persona.
 */
describe('validarAcceso: la liquidación es del auditor, para verla y para ejecutarla', () => {
  it('el auditor SÍ', () => {
    expect(() => validarAcceso(gilmer)).not.toThrow();
  });

  it('el auditor sin tienda en la ficha también: audita toda la cadena, no una sucursal', () => {
    expect(() => validarAcceso(auditorSinTienda)).not.toThrow();
  });

  it('el coordinador NO, ni la de su propia tienda: tampoco para mirarla', () => {
    expect(() => validarAcceso(jose)).toThrow(Prohibido);
  });

  it('el administrador NO: es técnico y no participa del proceso de inventario', () => {
    expect(() => validarAcceso(admin)).toThrow(Prohibido);
  });

  it('el rol conteo NO: el descuento de sus compañeros no es asunto suyo', () => {
    expect(() => validarAcceso(maria)).toThrow(Prohibido);
  });

  it('el rechazo dice a quién pedírsela: al auditor', () => {
    expect(() => validarAcceso(jose)).toThrow(/auditor/);
  });
});
