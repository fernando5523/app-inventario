/**
 * LAS CINCO VENTANAS. Lo que estos tests cuidan es la del Coordinador, que es
 * la delicada: corrige con la ronda abierta Y con la ronda cerrada, y deja de
 * poder en el instante en que el Auditor inicia el ajuste. Ni antes (perderia
 * la ventana que el cliente pidio) ni despues (le pisaria al Auditor un valor
 * decidido mirando el stock, sin que nadie se entere).
 */

import { describe, expect, it } from 'vitest';
import { Conflicto, Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  validarAbrirRondaExtra,
  validarAjusteEnCurso,
  validarCorreccion,
  validarIniciarAjuste,
  validarSucursal,
  type EstadoConAjuste,
  type InventarioParaAjuste,
} from './ajuste.permisos';

const BOLIVAR = 3;
const SUCRE = 4;

const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
const oscar: ColaboradorAutenticado = { colaboradorId: 301, sucursalId: BOLIVAR, rol: 'coordinador' };
const coordDeSucre: ColaboradorAutenticado = { colaboradorId: 401, sucursalId: SUCRE, rol: 'coordinador' };
const silvia: ColaboradorAutenticado = { colaboradorId: 302, sucursalId: BOLIVAR, rol: 'conteo' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };

const inv = (estado: EstadoConAjuste, sucursalId = BOLIVAR): InventarioParaAjuste => ({ sucursalId, estado });

/** Los estados en los que el conteo ya quedo firme. */
const CERRADOS: EstadoConAjuste[] = ['conteo_cerrado', 'liquidado', 'lacrado', 'anulado'];

describe('validarCorreccion: la ventana del Coordinador', () => {
  it('con el inventario en curso, SI -- valga la ronda abierta o cerrada', () => {
    // El estado del inventario es lo unico que mira: que la hoja este
    // finalizada no lo frena, y esa es justamente la decision del cliente.
    expect(() => validarCorreccion(oscar, inv('en_curso'))).not.toThrow();
  });

  it('el administrador tambien, por soporte', () => {
    expect(() => validarCorreccion(admin, inv('en_curso'))).not.toThrow();
  });

  /**
   * EL CORTE. Desde que el Auditor inicia el ajuste, los dos escribirian la
   * MISMA fila de `Conteo`: una correccion acá pisaria en silencio el valor
   * que el Auditor puso mirando el stock.
   */
  it('con el ajuste del Auditor iniciado, 409', () => {
    expect(() => validarCorreccion(oscar, inv('ajuste_auditor'))).toThrow(Conflicto);
  });

  it('el 409 del ajuste explica que el valor pasa a manos del Auditor, no que falten permisos', () => {
    expect(() => validarCorreccion(oscar, inv('ajuste_auditor'))).toThrow(/Auditor/);
  });

  it.each(CERRADOS)('con el inventario %s, 409: el conteo quedo firme', (estado) => {
    expect(() => validarCorreccion(oscar, inv(estado))).toThrow(Conflicto);
  });

  it('el rol conteo NO: quien conto no se corrige a si mismo', () => {
    expect(() => validarCorreccion(silvia, inv('en_curso'))).toThrow(Prohibido);
  });

  /**
   * EL AUDITOR TAMBIEN CORRIGE, y este test decia lo contrario.
   *
   * Hasta este cambio esta via era solo del Coordinador y el Auditor tenia
   * que esperar a su ajuste final. El cliente pidio darle la misma potestad
   * mientras el inventario esta en rondas: ve un error de conteo y lo
   * corrige, sin tener que cerrar el ciclo primero.
   *
   * La ventana es la MISMA que la del Coordinador -- `en_curso`, con la ronda
   * abierta o cerrada --, asi que no hay una segunda regla que mantener. Lo
   * unico distinto es que el Auditor ve el stock al hacerlo, y eso no se
   * decide aca sino en lo que el endpoint devuelve.
   */
  it('el Auditor TAMBIEN corrige mientras el inventario esta en rondas', () => {
    expect(() => validarCorreccion(gilmer, inv('en_curso'))).not.toThrow();
  });

  it('y llega a cualquier sucursal: audita toda la cadena', () => {
    expect(() => validarCorreccion(gilmer, inv('en_curso', SUCRE))).not.toThrow();
  });

  /**
   * PERO SE LE CIERRA CUANDO ARRANCA SU PROPIO AJUSTE. Decision del cliente,
   * textual: no dos caminos para lo mismo al mismo tiempo. Desde ahi corrige
   * por la pantalla de ajuste, que es la que compara contra el stock.
   */
  it('al Auditor se le corta la via cuando inicia su ajuste final', () => {
    expect(() => validarCorreccion(gilmer, inv('ajuste_auditor'))).toThrow(Conflicto);
  });

  it('el 409 le dice por donde sigue: la pantalla de ajuste', () => {
    expect(() => validarCorreccion(gilmer, inv('ajuste_auditor'))).toThrow(/pantalla de ajuste/);
  });

  it('el Coordinador de otra tienda, 403', () => {
    expect(() => validarCorreccion(coordDeSucre, inv('en_curso'))).toThrow(Prohibido);
  });

  /** Primero el rol y despues el estado: un contador tiene que ver 403, no 409. */
  it('el rol se valida ANTES que el estado', () => {
    expect(() => validarCorreccion(silvia, inv('ajuste_auditor'))).toThrow(Prohibido);
  });
});

describe('validarAbrirRondaExtra: el Auditor abre otra pasada', () => {
  it('el Auditor con el inventario en curso, SI', () => {
    expect(() => validarAbrirRondaExtra(gilmer, inv('en_curso'))).not.toThrow();
  });

  it('el Auditor llega a cualquier sucursal: audita toda la cadena', () => {
    expect(() => validarAbrirRondaExtra(gilmer, inv('en_curso', SUCRE))).not.toThrow();
  });

  it('el Coordinador NO: cierra el tramo automatico, pero no decide si hace falta otra pasada', () => {
    expect(() => validarAbrirRondaExtra(oscar, inv('en_curso'))).toThrow(Prohibido);
  });

  /**
   * Una vez adentro del ajuste no se vuelve atras: el Auditor ya empezo a
   * escribir valores con el stock a la vista, y abrir una ronda despues
   * mandaria a contar a ciegas algo que ya tiene un valor decidido.
   */
  it('con el ajuste ya iniciado, 409: no se vuelve atras', () => {
    expect(() => validarAbrirRondaExtra(gilmer, inv('ajuste_auditor'))).toThrow(Conflicto);
  });

  it.each(CERRADOS)('con el inventario %s, 409', (estado) => {
    expect(() => validarAbrirRondaExtra(gilmer, inv(estado))).toThrow(Conflicto);
  });
});

describe('validarIniciarAjuste: el boton que arranca el ajuste', () => {
  it('el Auditor con el inventario en curso, SI', () => {
    expect(() => validarIniciarAjuste(gilmer, inv('en_curso'))).not.toThrow();
  });

  it('el Coordinador NO', () => {
    expect(() => validarIniciarAjuste(oscar, inv('en_curso'))).toThrow(Prohibido);
  });

  it('iniciarlo dos veces, 409: la pantalla se desincronizo y hay que decirlo', () => {
    expect(() => validarIniciarAjuste(gilmer, inv('ajuste_auditor'))).toThrow(Conflicto);
  });

  it.each(CERRADOS)('con el inventario %s, 409', (estado) => {
    expect(() => validarIniciarAjuste(gilmer, inv(estado))).toThrow(Conflicto);
  });
});

describe('validarAjusteEnCurso: ajustar un valor y cerrar el ajuste', () => {
  it('el Auditor dentro del ajuste, SI', () => {
    expect(() => validarAjusteEnCurso(gilmer, inv('ajuste_auditor'), 'ajustar un conteo')).not.toThrow();
  });

  /**
   * Antes de iniciar el ajuste, el Coordinador todavia puede estar
   * corrigiendo: si el Auditor escribiera ahi, los dos pisarian la misma fila.
   */
  it('con el inventario en curso todavia, 409 y el mensaje dice que lo inicie', () => {
    expect(() => validarAjusteEnCurso(gilmer, inv('en_curso'), 'ajustar un conteo')).toThrow(Conflicto);
    expect(() => validarAjusteEnCurso(gilmer, inv('en_curso'), 'ajustar un conteo')).toThrow(/no esta iniciado/);
  });

  it.each(CERRADOS)('con el inventario %s, 409: el ajuste ya termino', (estado) => {
    expect(() => validarAjusteEnCurso(gilmer, inv(estado), 'cerrar el ajuste')).toThrow(Conflicto);
  });

  it('el Coordinador NO ajusta, ni dentro de la ventana del Auditor', () => {
    expect(() => validarAjusteEnCurso(oscar, inv('ajuste_auditor'), 'ajustar un conteo')).toThrow(Prohibido);
  });

  it('el rol conteo tampoco', () => {
    expect(() => validarAjusteEnCurso(silvia, inv('ajuste_auditor'), 'ajustar un conteo')).toThrow(Prohibido);
  });

  it('el rechazo nombra la accion que se intento, para que el mensaje sirva en las dos rutas', () => {
    expect(() => validarAjusteEnCurso(oscar, inv('ajuste_auditor'), 'cerrar el ajuste')).toThrow(
      /cerrar el ajuste/,
    );
  });
});

describe('validarSucursal: el cerco por tienda', () => {
  it('el Coordinador queda atado a la suya', () => {
    expect(() => validarSucursal(oscar, BOLIVAR)).not.toThrow();
    expect(() => validarSucursal(oscar, SUCRE)).toThrow(Prohibido);
  });

  it('administrador y auditor no tienen cerco', () => {
    for (const actor of [admin, gilmer]) {
      expect(() => validarSucursal(actor, BOLIVAR)).not.toThrow();
      expect(() => validarSucursal(actor, SUCRE)).not.toThrow();
    }
  });
});

/**
 * LA INVARIANTE DE LAS DOS VENTANAS: para cualquier estado, no puede haber
 * uno en el que el Coordinador corrija Y el Auditor ajuste. Los dos escriben
 * la misma fila de `Conteo`; que se solapen es el unico bug que estas reglas
 * existen para impedir.
 */
describe('las dos ventanas nunca se solapan', () => {
  const TODOS: EstadoConAjuste[] = ['en_curso', 'ajuste_auditor', ...CERRADOS];

  it.each(TODOS)('en %s, corregir y ajustar no pueden estar los dos abiertos', (estado) => {
    const corrige = puede(() => validarCorreccion(oscar, inv(estado)));
    const ajusta = puede(() => validarAjusteEnCurso(gilmer, inv(estado), 'ajustar un conteo'));
    expect(corrige && ajusta).toBe(false);
  });

  /**
   * EL CASO QUE IMPORTA DESDE QUE EL AUDITOR CORRIGE: el MISMO actor con las
   * dos vias. Antes la invariante se sostenia sola porque eran dos roles
   * distintos; ahora el Auditor esta en las dos listas y lo unico que impide
   * que tenga dos caminos abiertos para lo mismo es el estado. Si alguna vez
   * los dos dieran `true` a la vez, la pantalla de ajuste y la de correccion
   * escribirian la misma fila de `Conteo` sin saber una de la otra.
   */
  it.each(TODOS)('en %s, el Auditor NUNCA tiene las dos vias abiertas', (estado) => {
    const corrige = puede(() => validarCorreccion(gilmer, inv(estado)));
    const ajusta = puede(() => validarAjusteEnCurso(gilmer, inv(estado), 'ajustar un conteo'));
    expect(corrige && ajusta).toBe(false);
  });

  it('y en cada tramo el Auditor tiene UNA de las dos, nunca ninguna', () => {
    // En rondas corrige; en el ajuste, ajusta. Si las dos dieran false en
    // alguno de los dos estados, se habria quedado sin forma de cambiar un
    // valor justo cuando le toca.
    expect(puede(() => validarCorreccion(gilmer, inv('en_curso')))).toBe(true);
    expect(puede(() => validarAjusteEnCurso(gilmer, inv('en_curso'), 'x'))).toBe(false);
    expect(puede(() => validarCorreccion(gilmer, inv('ajuste_auditor')))).toBe(false);
    expect(puede(() => validarAjusteEnCurso(gilmer, inv('ajuste_auditor'), 'x'))).toBe(true);
  });

  it('y en algun estado cada una SI esta abierta (si no, el test de arriba pasaria vacio)', () => {
    expect(puede(() => validarCorreccion(oscar, inv('en_curso')))).toBe(true);
    expect(puede(() => validarAjusteEnCurso(gilmer, inv('ajuste_auditor'), 'ajustar un conteo'))).toBe(true);
  });
});

function puede(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}
