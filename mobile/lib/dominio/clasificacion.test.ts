/**
 * Lógica pura de la pantalla de Clasificación del Auditor:
 *   - el ESTADO de un producto: qué dice Dynamics y qué decidió el Auditor,
 *     y si esa decisión CAMBIA lo de Dynamics (la cerveza) o coincide;
 *   - el PAGINADO (¿hay más por traer del catálogo de ~11.800?);
 *   - aplicar/quitar la clasificación en la lista ya cargada, sin recargar todo.
 */
import { describe, expect, it } from 'vitest';

import type { Clasificacion, ProductoClasificable } from '../puertos/repositorios';
import {
  ADVERTENCIA_SIN_EMPAQUE,
  aplicarClasificacion,
  claseEfectiva,
  CLASES,
  consecuenciaDeEmpaque,
  empaqueEfectivo,
  empaqueTecleado,
  errorDeEmpaque,
  estadoClasificacion,
  explicacionClase,
  hayMasPorCargar,
  soloConClasificacion,
  textoClase,
  textoEmpaqueCompra,
  textoResponsableDynamics,
} from './clasificacion';

function producto(over: Partial<ProductoClasificable> = {}): ProductoClasificable {
  return {
    codigo: 'CERV-001',
    descripcion: 'Cerveza Pilsen 620ml',
    categoria: 'CERVEZAS',
    responsableDynamics: 'empleado',
    // Lo que derivó el snapshot si nadie pone excepción. El default es
    // `unidad`, el tratamiento de siempre.
    claseDynamics: 'unidad',
    empaqueCompra: 12,
    empaqueCompraSimbolo: 'Emp.12',
    clasificacion: null,
    ...over,
  };
}

function clasif(over: Partial<Clasificacion> = {}): Clasificacion {
  return {
    codigo: 'CERV-001',
    esEmpresa: true,
    clase: 'empresa',
    empaqueCompraCorregido: null,
    nota: null,
    clasificadoPorId: 103,
    clasificadoEn: '2026-09-11T12:00:00.000Z',
    ...over,
  };
}

describe('estadoClasificacion: Dynamics vs Auditor, y si cambia la cuenta', () => {
  it('sin excepción del Auditor: sin-clasificar', () => {
    expect(estadoClasificacion(producto({ clasificacion: null }))).toEqual({ tipo: 'sin-clasificar' });
  });

  it('la cerveza: el sistema la trata por unidad, el Auditor la marca empresa -> EXCEPCION (mueve la cuenta)', () => {
    const p = producto({ claseDynamics: 'unidad', clasificacion: clasif({ clase: 'empresa', esEmpresa: true }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'excepcion', clase: 'empresa' });
  });

  it('el Auditor decide lo mismo que ya derivaba el snapshot: coincide (no cambia nada)', () => {
    const p = producto({ claseDynamics: 'empresa', clasificacion: clasif({ clase: 'empresa', esEmpresa: true }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'coincide', clase: 'empresa' });
  });

  /**
   * EL CASO QUE EL BOOLEANO NO PODÍA VER. De `unidad` a `paquete` los DOS
   * tienen `esEmpresa: false`: comparando el booleano viejo esto daba
   * "coincide", o sea la pantalla decía que no cambiaba nada sobre el cambio
   * que el cliente pidió poder hacer.
   */
  it('de unidad a paquete es EXCEPCIÓN, aunque el booleano no cambie', () => {
    const p = producto({ claseDynamics: 'unidad', clasificacion: clasif({ clase: 'paquete', esEmpresa: false }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'excepcion', clase: 'paquete' });
  });

  it('de paquete a unidad también: el sistema iba a medir umbral y el Auditor dice que no', () => {
    const p = producto({ claseDynamics: 'paquete', clasificacion: clasif({ clase: 'unidad', esEmpresa: false }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'excepcion', clase: 'unidad' });
  });

  /**
   * INVARIANTE 2: una excepción vieja tiene `clase === null` y NO se
   * reinterpreta. Se muestra por lo que es -- empresa o no -- sin inventarle
   * una tercera vía que nadie eligió.
   */
  it('excepción VIEJA (clase null): estado propio, nunca una clase inventada', () => {
    const p = producto({ clasificacion: clasif({ clase: null, esEmpresa: true }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'vieja', esEmpresa: true });
  });

  it('una vieja del empleado también se muestra como lo que es', () => {
    const p = producto({ clasificacion: clasif({ clase: null, esEmpresa: false }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'vieja', esEmpresa: false });
  });

  /**
   * SOLO SE CORRIGIÓ EL EMPAQUE, sin forzar cuadro. Tiene `clase: null` igual
   * que una vieja, y lo que las distingue es el empaque: el servidor exige que
   * una fila nueva diga al menos una de las dos cosas, así que
   * `clase null + empaque null` solo puede ser una vieja.
   */
  it('solo empaque corregido: estado propio, no se confunde con una vieja', () => {
    const p = producto({ clasificacion: clasif({ clase: null, esEmpresa: false, empaqueCompraCorregido: 12 }) });
    expect(estadoClasificacion(p)).toEqual({ tipo: 'solo-empaque', empaqueCorregido: 12 });
  });

  it('y una vieja sigue siendo vieja: no tiene empaque corregido', () => {
    const p = producto({ clasificacion: clasif({ clase: null, esEmpresa: true, empaqueCompraCorregido: null }) });
    expect(estadoClasificacion(p).tipo).toBe('vieja');
  });
});

describe('las tres vías: etiquetas y qué significa cada una', () => {
  it('las tres, en el orden en que se ofrecen', () => {
    expect(CLASES).toEqual(['empresa', 'paquete', 'unidad']);
  });

  /** Las etiquetas del cliente, textuales. */
  it('usa las palabras del cliente', () => {
    expect(textoClase('empresa')).toBe('Empresa');
    expect(textoClase('paquete')).toBe('Paquete');
    expect(textoClase('unidad')).toBe('Unidad');
  });

  /**
   * El Auditor tiene que poder elegir sin acordarse de una reunión de agosto:
   * cada vía dice qué le pasa a la plata, y las tres dicen cosas distintas.
   */
  it('cada vía explica su consecuencia, y ninguna repite a otra', () => {
    const textos = CLASES.map(explicacionClase);
    expect(new Set(textos).size).toBe(3);
    expect(explicacionClase('empresa')).toMatch(/no se le descuenta a nadie/i);
    expect(explicacionClase('paquete')).toMatch(/empaque de compra/i);
    expect(explicacionClase('unidad')).toMatch(/se le descuenta al personal/i);
  });
});

describe('el empaque de compra: el denominador del umbral', () => {
  it('muestra el número con el símbolo del ERP, para poder auditar de dónde salió', () => {
    expect(textoEmpaqueCompra(12, 'Emp.12')).toBe('12 — Emp.12');
  });

  it('sin símbolo muestra solo el número', () => {
    expect(textoEmpaqueCompra(24, null)).toBe('24');
  });

  /** NULL NO ES 1: sin el dato no se muestra un número, se explica la consecuencia. */
  it('sin empaque de compra no inventa un 1: devuelve null', () => {
    expect(textoEmpaqueCompra(null, 'Emp.12')).toBeNull();
    expect(textoEmpaqueCompra(null, null)).toBeNull();
  });

  it('la advertencia dice la consecuencia, no solo que falta el dato', () => {
    expect(ADVERTENCIA_SIN_EMPAQUE).toMatch(/no se puede medir el umbral/i);
  });
});

describe('textoResponsableDynamics', () => {
  it('traduce los tres valores', () => {
    expect(textoResponsableDynamics('empresa')).toBe('Empresa');
    expect(textoResponsableDynamics('empleado')).toBe('Empleado');
    expect(textoResponsableDynamics(null)).toBe('Sin dato');
  });
});

describe('hayMasPorCargar: paginado sobre ~11.800', () => {
  it('quedan más si lo cargado es menor que el total', () => {
    expect(hayMasPorCargar(50, 11800)).toBe(true);
  });
  it('no quedan más cuando lo cargado alcanza el total', () => {
    expect(hayMasPorCargar(11800, 11800)).toBe(false);
  });
  it('total 0: no hay más', () => {
    expect(hayMasPorCargar(0, 0)).toBe(false);
  });
});

describe('aplicarClasificacion: actualiza en la lista ya cargada, sin recargar', () => {
  const lista = [producto({ codigo: 'A', clasificacion: null }), producto({ codigo: 'B', clasificacion: null })];

  it('clasificar B: solo B cambia, A queda intacto y el arreglo es nuevo', () => {
    const nueva = clasif({ codigo: 'B', clase: 'empresa', esEmpresa: true });
    const res = aplicarClasificacion(lista, 'B', nueva);
    expect(res).not.toBe(lista); // inmutable
    expect(res.find((p) => p.codigo === 'B')!.clasificacion).toEqual(nueva);
    expect(res.find((p) => p.codigo === 'A')!.clasificacion).toBeNull();
  });

  it('desclasificar (null) deja el producto sin excepción', () => {
    const conB = aplicarClasificacion(lista, 'B', clasif({ codigo: 'B' }));
    const res = aplicarClasificacion(conB, 'B', null);
    expect(res.find((p) => p.codigo === 'B')!.clasificacion).toBeNull();
  });
});

describe('soloConClasificacion: el filtro de la lista de excepciones tras desclasificar', () => {
  it('deja solo los que tienen excepción', () => {
    const lista = [producto({ codigo: 'A', clasificacion: clasif({ codigo: 'A' }) }), producto({ codigo: 'B', clasificacion: null })];
    const res = soloConClasificacion(lista);
    expect(res.map((p) => p.codigo)).toEqual(['A']);
  });
});

/**
 * EL AUDITOR CORRIGE EL EMPAQUE DE COMPRA — el caso medido por min-1: de los
 * 7 fallos de la regla contra el Excel real de Gilmer, 3 son productos que
 * D365 trae con empaque 1 (se compra suelto) cuando vienen en display. El de
 * abajo es uno de ellos, con sus números reales.
 *
 * CORREGIR EL EMPAQUE NO ES CORREGIR EL STOCK: acá no hay ninguna función que
 * toque stock, y no la va a haber.
 */
describe('el empaque efectivo y su consecuencia', () => {
  /** DORITOS QUESO 90G: D365 dice 1, Gilmer lo clasificó a mano como PAQUETE. */
  const doritos = (over: Partial<ProductoClasificable> = {}) =>
    producto({
      codigo: '105621',
      descripcion: 'DORITOS QUESO 90G',
      empaqueCompra: 1,
      empaqueCompraSimbolo: 'U',
      claseDynamics: 'unidad',
      ...over,
    });

  it('sin corregir manda el del snapshot; corregido manda el del Auditor', () => {
    expect(empaqueEfectivo(null, 1)).toBe(1);
    expect(empaqueEfectivo(12, 1)).toBe(12);
  });

  /** NULL NO ES 1: sin ninguno de los dos no hay denominador, y no se asume nada. */
  it('sin ninguno de los dos queda null, no 1', () => {
    expect(empaqueEfectivo(null, null)).toBeNull();
  });

  it('un 1 corregido a mano gana sobre un snapshot de 12: afirma "se compra suelto"', () => {
    expect(empaqueEfectivo(1, 12)).toBe(1);
  });

  /**
   * ESPEJA `backend/src/dominio/faltante-por-paquete.ts#claseEfectiva`, y los
   * casos de abajo son los MISMOS que se midieron contra esa función. Si el
   * espejo se desalinea, la previsualización de la pantalla y el destino real
   * del faltante dejan de coincidir — y el Auditor decide mirando un número
   * que no es el que se va a aplicar.
   */
  describe('claseEfectiva: espejo de la regla del backend', () => {
    it('(1) el cuadro forzado manda, aunque el empaque diga otra cosa', () => {
      expect(claseEfectiva('empresa', 'unidad', 1)).toBe('empresa');
      expect(claseEfectiva('unidad', 'paquete', 12)).toBe('unidad');
    });

    /** Lo único que acota al cuadro forzado: sin empaque contra el cual medir, Paquete no se puede cumplir. */
    it('(1b) forzar Paquete sin un empaque mayor que 1 degrada a Unidad', () => {
      expect(claseEfectiva('paquete', 'unidad', 1)).toBe('unidad');
      expect(claseEfectiva('paquete', 'unidad', null)).toBe('unidad');
      expect(claseEfectiva('paquete', 'unidad', 12)).toBe('paquete');
    });

    /** `empresa` lo decide gerencia, no el tamaño de una caja. */
    it('(2) empresa no se toca por esta vía, ni corrigiendo el empaque', () => {
      expect(claseEfectiva(null, 'empresa', 12)).toBe('empresa');
      expect(claseEfectiva('empresa', 'unidad', null)).toBe('empresa');
    });

    /**
     * (3) LO QUE HACE QUE CORREGIR EL EMPAQUE SOLO ALCANCE. Sin cuadro
     * forzado, la clase NO sale del snapshot: se re-deriva con el empaque
     * efectivo, en las DOS direcciones. Antes salía del snapshot y por eso
     * una corrección quedaba escrita y sin efecto.
     */
    it('(3) sin cuadro forzado, la clase se re-deriva del empaque efectivo', () => {
      // El snapshot decía `unidad` (el ERP traía 1) y el empaque corregido lo sube.
      expect(claseEfectiva(null, 'unidad', 12)).toBe('paquete');
      // Y al revés: el snapshot decía `paquete` y el empaque corregido lo baja.
      expect(claseEfectiva(null, 'paquete', 1)).toBe('unidad');
    });

    it('(3b) sin empaque en ningún lado queda Unidad: null no es 1, y sin denominador no se mide', () => {
      expect(claseEfectiva(null, 'unidad', null)).toBe('unidad');
      expect(claseEfectiva(null, 'paquete', null)).toBe('unidad');
    });
  });

  describe('consecuenciaDeEmpaque: qué cambia ANTES de guardar', () => {
    /** EL CASO DEL BRIEF: con empaque 1 se descuenta al personal; con 12 va a paquetes. */
    it('DORITOS: marcar Paquete y corregir el empaque a 12 lo mueve de cuadro', () => {
      const c = consecuenciaDeEmpaque(doritos(), 'paquete', 12);

      expect(c).toMatchObject({
        empaqueAntes: 1,
        empaqueDespues: 12,
        claseAntes: 'unidad',
        claseDespues: 'paquete',
        cambia: true,
        paqueteSinEfecto: false,
      });
    });

    /**
     * EL AVISO QUE MÁS IMPORTA: marcar Paquete SIN corregir el empaque no hace
     * nada, y quien lo marcó se iría convencido de que sí.
     */
    it('marcar Paquete sin corregir el empaque no tiene efecto, y se avisa', () => {
      const c = consecuenciaDeEmpaque(doritos(), 'paquete', null);

      expect(c.claseDespues).toBe('unidad');
      expect(c.paqueteSinEfecto).toBe(true);
      expect(c.cambia).toBe(false);
    });

    it('un empaque corregido a 1 tampoco alcanza: sigue siendo "se compra suelto"', () => {
      expect(consecuenciaDeEmpaque(doritos(), 'paquete', 1).paqueteSinEfecto).toBe(true);
    });

    /**
     * El "antes" sale de lo que está GUARDADO, no de lo que se está eligiendo:
     * si no, cambiar cuadro y empaque a la vez mostraría un antes que nunca
     * existió.
     */
    it('el antes se mide con la excepción ya guardada, no con la que se está por elegir', () => {
      const yaCorregido = doritos({
        clasificacion: clasif({ codigo: '105621', clase: 'paquete', esEmpresa: false, empaqueCompraCorregido: 12 }),
      });

      const c = consecuenciaDeEmpaque(yaCorregido, 'unidad', 12);

      expect(c.claseAntes).toBe('paquete');
      expect(c.claseDespues).toBe('unidad');
      expect(c.cambia).toBe(true);
    });

    it('deshacer la corrección vuelve al empaque del ERP y lo dice', () => {
      const yaCorregido = doritos({
        clasificacion: clasif({ codigo: '105621', clase: 'paquete', esEmpresa: false, empaqueCompraCorregido: 12 }),
      });

      const c = consecuenciaDeEmpaque(yaCorregido, 'paquete', null);

      expect(c).toMatchObject({ empaqueAntes: 12, empaqueDespues: 1, claseAntes: 'paquete', claseDespues: 'unidad', cambia: true });
    });

    /**
     * EL CASO DORITOS SIN FORZAR CUADRO — el que el cliente quiere poder
     * hacer, y el que da sentido a la corrección del empaque: arreglar el dato
     * una vez y que la regla clasifique sola de ahí en adelante ("así evitamos
     * estar corrigiendo 1:1").
     *
     * MEDIDO contra el backend real: `claseEfectiva(null, 'unidad', 12)`
     * devuelve `'paquete'` desde que la clase se re-deriva con el empaque
     * efectivo.
     */
    it('corregir el empaque SIN forzar cuadro alcanza: pasa a Paquete', () => {
      const c = consecuenciaDeEmpaque(doritos(), null, 12);

      expect(c.claseAntes).toBe('unidad');
      expect(c.claseDespues).toBe('paquete');
      expect(c.cambia).toBe(true);
      expect(c.paqueteSinEfecto).toBe(false);
    });

    /** LA OTRA DIRECCIÓN: corregir a 1 saca del cuadro de paquetes. */
    it('corregir a 1 un producto que el ERP trae en caja lo devuelve a Unidad', () => {
      const enCaja = doritos({ empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12', claseDynamics: 'paquete' });

      const c = consecuenciaDeEmpaque(enCaja, null, 1);

      expect(c).toMatchObject({ claseAntes: 'paquete', claseDespues: 'unidad', cambia: true });
    });

    /** `empresa` NO se toca por esta vía: lo decide gerencia, no el tamaño de una caja. */
    it('corregir el empaque de un producto de empresa no lo saca de empresa', () => {
      const deEmpresa = doritos({ claseDynamics: 'empresa' });

      const c = consecuenciaDeEmpaque(deEmpresa, null, 12);

      expect(c).toMatchObject({ claseAntes: 'empresa', claseDespues: 'empresa', cambia: false });
    });

    /** El cuadro forzado sigue mandando sobre lo derivado. */
    it('forzar Unidad con el empaque en 12 deja el ítem en Unidad', () => {
      const c = consecuenciaDeEmpaque(doritos(), 'unidad', 12);
      expect(c.claseDespues).toBe('unidad');
    });
  });
});

describe('el campo del empaque: qué se puede tipear', () => {
  it('vacío es válido: significa "sin corregir", y es el deshacer', () => {
    expect(errorDeEmpaque('')).toBeNull();
    expect(errorDeEmpaque('   ')).toBeNull();
    expect(empaqueTecleado('')).toBeNull();
  });

  it('un entero de 1 para arriba entra', () => {
    expect(errorDeEmpaque('12')).toBeNull();
    expect(empaqueTecleado('12')).toBe(12);
    // El 1 es una afirmación válida CON consecuencia: "se compra suelto".
    expect(errorDeEmpaque('1')).toBeNull();
    expect(empaqueTecleado('1')).toBe(1);
  });

  it('el 0 y los negativos no: serían una división por cero en la razón del umbral', () => {
    expect(errorDeEmpaque('0')).toMatch(/1 o más/);
    expect(errorDeEmpaque('-3')).not.toBeNull();
  });

  it('lo que no es un número dice qué se espera, no solo que está mal', () => {
    expect(errorDeEmpaque('doce')).toMatch(/solo el número/i);
    expect(errorDeEmpaque('1,5')).not.toBeNull();
  });
});

/**
 * UNA EXCEPCIÓN VIEJA sigue mandando por `esEmpresa`, y el backend la
 * reconcilia a `'empresa'` antes de resolver nada
 * (`liquidacion.reclasificacion.ts#conciliarClase`).
 *
 * La divergencia apareció recién cuando la clase pasó a re-derivarse del
 * empaque: antes, pasar `null` daba `unidad` y se notaba poco; ahora daría
 * `paquete` y la pantalla diría que el faltante se va al cuadro de paquetes
 * cuando en realidad lo absorbe la empresa. Medido contra las dos funciones
 * reales del backend antes de escribir el arreglo.
 */
describe('la previsualización respeta las excepciones viejas', () => {
  const conEmpaque12 = () =>
    producto({ codigo: '105621', empaqueCompra: 12, empaqueCompraSimbolo: 'Emp.12', claseDynamics: 'unidad' });

  it('una vieja marcada empresa sigue en Empresa, no se re-deriva a Paquete', () => {
    const p = conEmpaque12();
    p.clasificacion = clasif({ codigo: '105621', clase: null, esEmpresa: true, empaqueCompraCorregido: null });

    expect(consecuenciaDeEmpaque(p, null, null).claseAntes).toBe('empresa');
  });

  /** Una vieja del EMPLEADO no fuerza nada: ahí sí manda lo derivado. */
  it('una vieja del empleado no fuerza cuadro: se re-deriva normalmente', () => {
    const p = conEmpaque12();
    p.clasificacion = clasif({ codigo: '105621', clase: null, esEmpresa: false, empaqueCompraCorregido: null });

    expect(consecuenciaDeEmpaque(p, null, null).claseAntes).toBe('paquete');
  });

  it('sin ninguna excepción tampoco fuerza nada', () => {
    expect(consecuenciaDeEmpaque(conEmpaque12(), null, null).claseAntes).toBe('paquete');
  });
});
