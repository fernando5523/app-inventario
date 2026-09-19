/**
 * La asistencia registrada acá es el insumo de la multa por inasistencia, que
 * se descuenta del sueldo. Estos tests cuidan las dos preguntas que deciden
 * cuánta plata se mueve: QUIÉN puede marcar y HASTA CUÁNDO.
 */

import { describe, expect, it } from 'vitest';
import { Conflicto, Prohibido } from '../../shared/errores';
import type { EstadoInventario } from '../historial/historial.permisos';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  validarJustificacion,
  validarLectura,
  validarRegistro,
  validarSucursal,
  type InventarioParaPermisos,
} from './asistencia.permisos';

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

/**
 * JUSTIFICAR UNA FALTA. Es plata en la dirección contraria a la multa: le
 * baja el descuento a una persona y le cambia el bono a todas las demás.
 *
 * Los dos ejes que decide este validador -- quién y hasta cuándo -- son el
 * control entero de la funcionalidad.
 */
describe('validarJustificacion: quién perdona una falta, y hasta cuándo', () => {
  it('el auditor puede, con el inventario en curso', () => {
    expect(() => validarJustificacion(gilmer, enCurso)).not.toThrow();
  });

  /**
   * ESTE ES EL CASO NORMAL, no la excepción: el reclamo aparece cuando el
   * auditor mira la planilla, y eso pasa con el conteo ya cerrado. Si la
   * ventana se cerrara junto con el conteo, la funcionalidad no serviría para
   * el caso que la motivó.
   */
  it('y también con el conteo ya cerrado, que es cuando aparece el reclamo', () => {
    expect(() => validarJustificacion(gilmer, cerrado)).not.toThrow();
  });

  it('y durante el ajuste del auditor', () => {
    expect(() => validarJustificacion(gilmer, { sucursalId: BOLIVAR, estado: 'ajuste_auditor' })).not.toThrow();
  });

  /**
   * EL COORDINADOR NO, y no es un olvido: es él quien pasa lista. Si además
   * pudiera perdonar, marcaría ausente a alguien y le levantaría la falta sin
   * que nadie más intervenga -- la multa dejaría de depender de dos personas.
   */
  it('el coordinador NO justifica: quien registra la ausencia no la perdona', () => {
    expect(() => validarJustificacion(oscar, enCurso)).toThrow(Prohibido);
  });

  /**
   * El administrador sí pasa lista (entra por soporte) y sin embargo acá no
   * entra. Pasar lista es operativo y alguien tiene que poder destrabarlo;
   * perdonar una multa es una decisión de negocio sobre la plata de una
   * persona, y el administrador no participa del proceso de inventario.
   */
  it('el administrador tampoco, aunque sí pueda pasar lista', () => {
    expect(() => validarJustificacion(admin, enCurso)).toThrow(Prohibido);
  });

  it('el rol conteo, menos que nadie: nadie se perdona a sí mismo', () => {
    expect(() => validarJustificacion(silvia, enCurso)).toThrow(Prohibido);
  });

  /**
   * LA VENTANA SE CIERRA AL LIQUIDAR. Después la planilla está firmada y los
   * montos descontados de un sueldo: una justificación tardía cambiaría un
   * descuento que ya salió en un recibo.
   *
   * `Conflicto` (409) y no `Prohibido` (403) a propósito -- el rol es el
   * correcto, lo que no da es el momento, y quien se lo encuentra tiene que
   * entender que pedir permisos no lo destraba.
   */
  it('liquidado: 409, el descuento ya salió en un recibo', () => {
    expect(() => validarJustificacion(gilmer, { sucursalId: BOLIVAR, estado: 'liquidado' })).toThrow(Conflicto);
  });

  it('lacrado: 409 también', () => {
    expect(() => validarJustificacion(gilmer, { sucursalId: BOLIVAR, estado: 'lacrado' })).toThrow(Conflicto);
  });

  it('anulado: 409 -- ese inventario no produce histórico, no hay multa que perdonar', () => {
    expect(() => validarJustificacion(gilmer, { sucursalId: BOLIVAR, estado: 'anulado' })).toThrow(Conflicto);
  });

  /**
   * Sin cerco por sucursal: el auditor audita toda la cadena (corrección del
   * cliente, 2026-09-09), así que ninguna tienda le es ajena. Es el mismo
   * criterio de `liquidacion.permisos.ts`.
   */
  it('el auditor justifica en cualquier tienda: no tiene cerco por sucursal', () => {
    expect(() => validarJustificacion(gilmer, { sucursalId: SUCRE, estado: 'en_curso' })).not.toThrow();
  });
});

describe('validarLectura: el auditor entra a leer', () => {
  /**
   * Cambió con las justificaciones: antes el auditor no veía esta lista (la
   * leía indirectamente por la liquidación). Ahora la necesita para saber a
   * quién le está perdonando qué día.
   */
  it('el auditor lee la lista, en cualquier tienda y en cualquier estado', () => {
    expect(() => validarLectura(gilmer, enCurso)).not.toThrow();
    expect(() => validarLectura(gilmer, { sucursalId: SUCRE, estado: 'lacrado' })).not.toThrow();
  });

  it('pero leer no es escribir: pasar lista le sigue estando vedado', () => {
    // La separación entera: quien registra la ausencia (coordinador) no es
    // quien la perdona (auditor), y ninguno de los dos hace lo del otro.
    expect(() => validarRegistro(gilmer, enCurso)).toThrow(Prohibido);
  });
});
