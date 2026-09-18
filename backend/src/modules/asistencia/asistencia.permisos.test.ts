/**
 * La asistencia registrada acá es el insumo de la multa por inasistencia, que
 * se descuenta del sueldo. Estos tests cuidan las dos preguntas que deciden
 * cuánta plata se mueve: QUIÉN puede marcar y HASTA CUÁNDO.
 */

import { describe, expect, it } from 'vitest';
import { Conflicto, Prohibido } from '../../shared/errores';
import type { EstadoInventario } from '../historial/historial.permisos';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { validarLectura, validarRegistro, validarSucursal, type InventarioParaPermisos } from './asistencia.permisos';

const BOLIVAR = 1;
const SUCRE = 2;

const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const oscar: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: BOLIVAR, rol: 'coordinador' };
const coordinadorDeSucre: ColaboradorAutenticado = { colaboradorId: 201, sucursalId: SUCRE, rol: 'coordinador' };
const silvia: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: BOLIVAR, rol: 'conteo' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };

const enCurso: InventarioParaPermisos = { sucursalId: BOLIVAR, estado: 'en_curso' };
const cerrado: InventarioParaPermisos = { sucursalId: BOLIVAR, estado: 'conteo_cerrado' };

describe('validarRegistro: quién pasa lista', () => {
  it('el coordinador de esa tienda SÍ -- es quien está mirando quién llegó', () => {
    expect(() => validarRegistro(oscar, enCurso)).not.toThrow();
  });

  it('el administrador SÍ, en cualquier tienda: entra por soporte', () => {
    expect(() => validarRegistro(admin, enCurso)).not.toThrow();
    expect(() => validarRegistro(admin, { sucursalId: SUCRE, estado: 'en_curso' })).not.toThrow();
  });

  it('el rol conteo NO: nadie declara su propia multa', () => {
    expect(() => validarRegistro(silvia, enCurso)).toThrow(Prohibido);
  });

  it('el auditor NO: no estuvo en la jornada, y la planilla que cierra se apoya en estas marcas', () => {
    expect(() => validarRegistro(gilmer, enCurso)).toThrow(Prohibido);
  });

  it('el rechazo dice a quién pedírselo: al coordinador', () => {
    expect(() => validarRegistro(silvia, enCurso)).toThrow(/coordinador/);
  });
});

describe('validarRegistro: hasta cuándo', () => {
  /**
   * Al cerrar el conteo se congela `ResultadoInventario.diasDelInventario`,
   * que es el denominador de TODAS las multas del mes. Una marca posterior
   * caería en un día que ese número ya no cuenta, y la planilla dejaría de
   * coincidir con el detalle que la respalda.
   */
  it.each<EstadoInventario>(['conteo_cerrado', 'liquidado', 'lacrado', 'anulado'])(
    'con el inventario %s, 409: la asistencia quedó firme',
    (estado) => {
      expect(() => validarRegistro(oscar, { sucursalId: BOLIVAR, estado })).toThrow(Conflicto);
    },
  );

  it('el 409 es del momento, no del rol: no se arregla pidiendo permisos, y el mensaje lo dice', () => {
    expect(() => validarRegistro(oscar, cerrado)).toThrow(/ya cerró|firme/);
  });

  it('el administrador tampoco puede tocar un inventario cerrado: el candado es del estado', () => {
    expect(() => validarRegistro(admin, cerrado)).toThrow(Conflicto);
  });

  /**
   * El orden importa: un contador que le pega a un inventario cerrado tiene
   * que ver 403 (su rol nunca va a poder), no 409 (que suena a "esperá al mes
   * que viene").
   */
  it('el rol se valida ANTES que el estado', () => {
    expect(() => validarRegistro(silvia, cerrado)).toThrow(Prohibido);
  });
});

describe('validarLectura: ver la lista', () => {
  it('el coordinador ve la de su tienda con el inventario en curso', () => {
    expect(() => validarLectura(oscar, enCurso)).not.toThrow();
  });

  /**
   * Cerrar congela la asistencia, no la esconde. El coordinador es quien le
   * explica al equipo por qué le descontaron dos días, y esa conversación
   * pasa DESPUÉS del cierre.
   */
  it('y también la de un inventario ya cerrado: congelada no es secreta', () => {
    expect(() => validarLectura(oscar, cerrado)).not.toThrow();
    expect(() => validarLectura(oscar, { sucursalId: BOLIVAR, estado: 'lacrado' })).not.toThrow();
  });

  it('el rol conteo no la ve ni cerrada', () => {
    expect(() => validarLectura(silvia, cerrado)).toThrow(Prohibido);
  });
});

describe('validarSucursal: el cerco por tienda', () => {
  it('el coordinador de Sucre no toca el inventario de Bolívar', () => {
    expect(() => validarSucursal(coordinadorDeSucre, BOLIVAR)).toThrow(Prohibido);
    expect(() => validarRegistro(coordinadorDeSucre, enCurso)).toThrow(Prohibido);
  });

  it('el administrador no tiene cerco: sucursalId null y llega a todas', () => {
    expect(() => validarSucursal(admin, BOLIVAR)).not.toThrow();
    expect(() => validarSucursal(admin, SUCRE)).not.toThrow();
  });
});
