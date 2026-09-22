/**
 * Las reglas de acá deciden quién puede cambiar un valor que después se
 * descuenta de un sueldo. Los casos que se prueban son los bordes donde el
 * permiso cambia de mano, que es donde una equivocación deja a alguien
 * corrigiendo lo que no le toca -- o sin poder arreglar lo que sí.
 */

import { describe, expect, it } from 'vitest';

import {
  elAuditorPuedeDecidir,
  errorDeMotivo,
  faseDeCierre,
  motivoValido,
  MOTIVO_MINIMO,
  motivoSinCorregir,
  puedeAbrirRondaExtra,
  puedeAjustar,
  puedeCorregirLoContado,
  puedeIniciarAjuste,
  STOCK_NO_SE_CORRIGE,
  type FaseDeCierre,
  textoItemSalioDeRonda,
  textoRondaQueYaNoExiste,
} from './ajuste-final';

describe('faseDeCierre', () => {
  it('con una ronda abierta se está contando', () => {
    expect(faseDeCierre('en_curso', 1, 26)).toBe('contando');
    expect(faseDeCierre('en_curso', 4, 26)).toBe('contando');
  });

  /** LA VENTANA: la última ronda cerró y el ajuste todavía no arrancó. */
  it('en_curso SIN ronda activa, CON hojas, es la ventana entre la última ronda y el ajuste', () => {
    expect(faseDeCierre('en_curso', null, 26)).toBe('rondas-cerradas');
  });

  /**
   * El caso que rompía todo: durante el ajuste no hay ronda activa Y el
   * inventario sigue abierto. Deducir la fase de la ronda sola lo habría dado
   * por cerrado.
   */
  it('ajuste_auditor es su propia fase, aunque no haya ronda activa', () => {
    expect(faseDeCierre('ajuste_auditor', null, 26)).toBe('ajuste');
  });

  it('cualquier estado posterior es cerrado: nadie toca nada', () => {
    expect(faseDeCierre('conteo_cerrado', null, 26)).toBe('cerrado');
    expect(faseDeCierre('liquidado', null, 26)).toBe('cerrado');
    expect(faseDeCierre('lacrado', null, 26)).toBe('cerrado');
    expect(faseDeCierre('anulado', null, 26)).toBe('cerrado');
  });
});

/**
 * LOS DOS CASOS QUE `rondaActiva === null` JUNTABA, y son lo contrario uno
 * del otro. Este describe existe para que el que lea el `if` entienda por qué
 * están separados y no los vuelva a juntar.
 *
 * BUG REAL (2026-09-21, emulador): un inventario con el catálogo traído y
 * CERO hojas se mostraba como *"El conteo de este inventario terminó"*, y el
 * Coordinador quedaba sin camino para crear las hojas -- lo único a lo que
 * había entrado. Los dos llegaban con `rondaActiva: null` y la función los
 * trataba a los dos como el segundo.
 */
describe('faseDeCierre: nada empezó todavía NO es todo terminó', () => {
  it('catálogo traído y CERO hojas es `sin-hojas`: el armado recién empieza', () => {
    // El caso de Luzuriaga: 980 ítems de catálogo, 0 hojas.
    expect(faseDeCierre('en_curso', null, 0)).toBe('sin-hojas');
  });

  it('con hojas y sin ronda abierta SIGUE siendo `rondas-cerradas`: el caso no se tocó', () => {
    expect(faseDeCierre('en_curso', null, 26)).toBe('rondas-cerradas');
  });

  it('lo que las separa es si TUVO hojas alguna vez, no si hay una ronda ahora', () => {
    // Misma ronda (ninguna), mismo estado: lo único distinto es `totalHojas`,
    // y eso solo ya decide dos fases opuestas.
    expect(faseDeCierre('en_curso', null, 0)).toBe('sin-hojas');
    expect(faseDeCierre('en_curso', null, 1)).toBe('rondas-cerradas');
  });

  it('sin hojas NO es `contando`: no hay nada que contar todavía', () => {
    // Importa porque media app pregunta `fase !== 'contando'` para decidir si
    // ya no se cuenta, y ahí `sin-hojas` tiene que caer del lado correcto.
    expect(faseDeCierre('en_curso', null, 0)).not.toBe('contando');
  });

  it('el estado manda sobre las hojas: un inventario cerrado sin hojas es `cerrado`', () => {
    // Un inventario anulado antes de crear hojas existe, y no es el paso 2 de
    // nadie: ya nadie va a armar nada ahí.
    expect(faseDeCierre('conteo_cerrado', null, 0)).toBe('cerrado');
    expect(faseDeCierre('anulado', null, 0)).toBe('cerrado');
    expect(faseDeCierre('ajuste_auditor', null, 0)).toBe('ajuste');
  });

  it('el Auditor NO puede decidir sobre un inventario sin hojas', () => {
    // Antes sí podía: `sin-hojas` caía en `rondas-cerradas` y
    // `elAuditorPuedeDecidir` daba true sobre un inventario donde nadie contó
    // nada. Queda arreglado de rebote, y este test lo fija.
    expect(elAuditorPuedeDecidir(faseDeCierre('en_curso', null, 0))).toBe(false);
    expect(elAuditorPuedeDecidir(faseDeCierre('en_curso', null, 26))).toBe(true);
  });

  it('y no se puede "corregir lo contado" cuando no se contó nada', () => {
    expect(puedeCorregirLoContado(faseDeCierre('en_curso', null, 0))).toBe(false);
  });
});

describe('quién puede tocar un valor', () => {
  it('el coordinador corrige con la ronda abierta Y con la ronda cerrada', () => {
    expect(puedeCorregirLoContado('contando')).toBe(true);
    expect(puedeCorregirLoContado('rondas-cerradas')).toBe(true);
  });

  /** Decisión textual del cliente: arrancado el ajuste, el coordinador queda afuera. */
  it('el coordinador NO corrige durante el ajuste del auditor', () => {
    expect(puedeCorregirLoContado('ajuste')).toBe(false);
    expect(puedeCorregirLoContado('cerrado')).toBe(false);
  });

  it('el auditor abre otra ronda o arranca el ajuste solo con la última ronda cerrada', () => {
    const fases: FaseDeCierre[] = ['contando', 'rondas-cerradas', 'ajuste', 'cerrado'];
    expect(fases.filter(puedeAbrirRondaExtra)).toEqual(['rondas-cerradas']);
    expect(fases.filter(puedeIniciarAjuste)).toEqual(['rondas-cerradas']);
  });

  it('el auditor cambia valores SOLO durante el ajuste', () => {
    const fases: FaseDeCierre[] = ['contando', 'rondas-cerradas', 'ajuste', 'cerrado'];
    expect(fases.filter(puedeAjustar)).toEqual(['ajuste']);
  });

  /** Los dos permisos nunca se superponen: no hay fase con dos manos sobre el mismo valor. */
  it('el coordinador y el auditor nunca pueden tocar el mismo valor a la vez', () => {
    const fases: FaseDeCierre[] = ['contando', 'rondas-cerradas', 'ajuste', 'cerrado'];
    expect(fases.filter((f) => puedeCorregirLoContado(f) && puedeAjustar(f))).toEqual([]);
  });
});

describe('motivoSinCorregir', () => {
  it('no dice nada cuando sí se puede', () => {
    expect(motivoSinCorregir('contando')).toBeNull();
    expect(motivoSinCorregir('rondas-cerradas')).toBeNull();
  });

  /** En términos del negocio: ni "endpoint", ni "estado", ni "403". */
  it('explica el motivo real, distinto para el ajuste y para el cierre', () => {
    expect(motivoSinCorregir('ajuste')).toContain('auditor');
    expect(motivoSinCorregir('cerrado')).toContain('cerró');
    expect(motivoSinCorregir('ajuste')).not.toBe(motivoSinCorregir('cerrado'));
  });

  it('ninguno invita a reintentar algo que no va a cambiar solo', () => {
    for (const fase of ['ajuste', 'cerrado'] as const) {
      expect(motivoSinCorregir(fase)).not.toMatch(/intenta|intentar/i);
    }
  });
});

describe('el motivo del cambio', () => {
  it('un motivo vacío o de espacios no sirve', () => {
    expect(motivoValido('')).toBe(false);
    expect(motivoValido('    ')).toBe(false);
    expect(errorDeMotivo('   ')).toContain('Escribe por qué');
  });

  /** Un campo obligatorio sin piso se llena con "x": cumple en la base, no en la realidad. */
  it('un relleno de un toque tampoco sirve', () => {
    expect(motivoValido('x')).toBe(false);
    expect(errorDeMotivo('x')).toContain(String(MOTIVO_MINIMO));
  });

  it('un motivo real pasa, y los espacios de los bordes no cuentan', () => {
    expect(motivoValido('Contó dos cajas de más')).toBe(true);
    expect(errorDeMotivo('  Recuento con el jefe de tienda  ')).toBeNull();
  });
});

/**
 * EL CANDADO QUE NO SE ABRÍA. Los dos botones del Auditor estaban
 * condicionados a 'rondas-cerradas', y contra el backend real esa fase no se
 * puede detectar: `activo()` devuelve `estado: 'en_curso'` y la última ronda
 * que EXISTE, que es un número tanto si sigue abierta como si ya cerró. En el
 * emulador (inventario 8040) el resultado fue que la pantalla del Ciclo decía
 * "el auditor decide" y no mostraba un solo botón para decidir.
 */
describe('elAuditorPuedeDecidir: no usa una fase que no se puede detectar', () => {
  it('se le ofrecen las dos acciones con el inventario abierto, cerrada la ronda o no', () => {
    expect(elAuditorPuedeDecidir('contando')).toBe(true);
    expect(elAuditorPuedeDecidir('rondas-cerradas')).toBe(true);
  });

  it('no se le ofrecen con el ajuste ya empezado ni con el conteo cerrado', () => {
    expect(elAuditorPuedeDecidir('ajuste')).toBe(false);
    expect(elAuditorPuedeDecidir('cerrado')).toBe(false);
  });

  /**
   * La razón de existir de esta función: cubre estrictamente más que las dos
   * de abajo, que siguen describiendo cuándo la acción es VÁLIDA de verdad
   * (eso lo sostiene el servidor, con su 409).
   */
  it('cubre todo lo que cubren puedeAbrirRondaExtra y puedeIniciarAjuste', () => {
    const fases: FaseDeCierre[] = ['contando', 'rondas-cerradas', 'ajuste', 'cerrado'];
    for (const fase of fases) {
      if (puedeAbrirRondaExtra(fase) || puedeIniciarAjuste(fase)) expect(elAuditorPuedeDecidir(fase)).toBe(true);
    }
  });

  /** Y nunca se superpone con el ajuste: no se ofrece "empezar" lo que ya empezó. */
  it('nunca se ofrece decidir mientras se está ajustando', () => {
    const fases: FaseDeCierre[] = ['contando', 'rondas-cerradas', 'ajuste', 'cerrado'];
    expect(fases.filter((f) => elAuditorPuedeDecidir(f) && puedeAjustar(f))).toEqual([]);
  });
});

/**
 * El Auditor corrige lo contado igual que el Coordinador -- misma ventana,
 * mismo endpoint, mismo motivo obligatorio. Lo único distinto es que él ve el
 * stock mientras lo hace, y eso lo decide la pantalla, no esta regla.
 */
describe('corregir lo contado: la ventana es la misma para los dos roles', () => {
  it('se puede contando y con la ronda ya cerrada', () => {
    expect(puedeCorregirLoContado('contando')).toBe(true);
    expect(puedeCorregirLoContado('rondas-cerradas')).toBe(true);
  });

  it('arrancado el ajuste se cierra para los dos, no solo para el coordinador', () => {
    expect(puedeCorregirLoContado('ajuste')).toBe(false);
    expect(puedeCorregirLoContado('cerrado')).toBe(false);
  });

  /**
   * Decirle "el auditor ya empezó" AL AUDITOR lo deja buscando a otra persona
   * que no existe: el texto tiene que nombrarlo a él y decirle por dónde sigue.
   */
  it('el motivo del ajuste se le dice distinto a cada rol', () => {
    const paraCoordinador = motivoSinCorregir('ajuste');
    const paraAuditor = motivoSinCorregir('ajuste', 'auditor');

    expect(paraCoordinador).toContain('El auditor');
    expect(paraAuditor).toMatch(/Ya empezaste/);
    expect(paraAuditor).toContain('Ajuste final');
    expect(paraAuditor).not.toBe(paraCoordinador);
  });

  it('con el conteo cerrado el motivo es el mismo para los dos: el hecho es uno solo', () => {
    expect(motivoSinCorregir('cerrado', 'auditor')).toBe(motivoSinCorregir('cerrado'));
  });

  it('mientras se puede corregir, ninguno de los dos recibe un motivo', () => {
    for (const fase of ['contando', 'rondas-cerradas'] as const) {
      expect(motivoSinCorregir(fase)).toBeNull();
      expect(motivoSinCorregir(fase, 'auditor')).toBeNull();
    }
  });

  /** La regla del cliente, en el único lugar donde vive el texto. */
  it('la frase del stock dice que se compara, nunca que se corrige', () => {
    expect(STOCK_NO_SE_CORRIGE).toMatch(/no se corrige/i);
    expect(STOCK_NO_SE_CORRIGE).toMatch(/comparar/i);
  });
});

/**
 * EL AVISO QUE CIERRA EL CÍRCULO. Es la frase que el cliente pidió textual
 * (reunión 2, 00:12:12): *"puedes corregirlo para que ya no salga en mi
 * segundo conteo"*.
 */
describe('textoItemSalioDeRonda', () => {
  const base = { codigo: 'PQ-522626-A', ronda: 2, hojaBorrada: false, rondaBorrada: false };

  it('dice el código y el conteo del que salió, con las palabras del cliente', () => {
    const t = textoItemSalioDeRonda(base);
    expect(t).toContain('PQ-522626-A');
    expect(t).toContain('2do conteo');
    expect(t).toContain('ya no sale');
  });

  it('si la hoja quedó vacía, lo dice: alguien iba a ir a buscarla', () => {
    expect(textoItemSalioDeRonda({ ...base, hojaBorrada: true })).toContain('hoja');
  });

  /**
   * El caso más grave y el que más importa avisar: el Auditor puede estar
   * mirando justo esa ronda cuando desaparece.
   */
  it('si la ronda entera desapareció, gana sobre el aviso de la hoja', () => {
    const t = textoItemSalioDeRonda({ ...base, hojaBorrada: true, rondaBorrada: true });
    expect(t).toContain('ya no hace falta');
    expect(t).not.toContain('Su hoja quedó');
  });

  /** Las rondas extra del Auditor existen: el ordinal no puede cortarse en 3. */
  it('sirve para una ronda extra', () => {
    expect(textoItemSalioDeRonda({ ...base, ronda: 5 })).toContain('5to conteo');
  });

  /** Tuteo latino neutro, pedido explícito del cliente: nada de voseo. */
  it('no usa voseo', () => {
    for (const salida of [base, { ...base, hojaBorrada: true }, { ...base, rondaBorrada: true }]) {
      expect(textoItemSalioDeRonda(salida)).not.toMatch(/\b(corregí|tenés|podés|fijate|acá)\b/i);
    }
  });
});

describe('textoRondaQueYaNoExiste', () => {
  it('dice cuál se fue, por qué y adónde se lo llevó', () => {
    const t = textoRondaQueYaNoExiste(2, 1);
    expect(t).toContain('2do conteo');
    expect(t).toContain('1er conteo');
    expect(t).toContain('se corrigieron todos sus ítems');
  });
});
