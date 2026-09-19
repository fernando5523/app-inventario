/**
 * A qué cuadro va el faltante de un ítem, probado sin base.
 *
 * De acá sale a quién se le descuenta plata: al personal de la tienda o al
 * almacenero. Los casos salen del archivo real del cliente
 * (`requerimiento/INVENTARIO MES DE JULIO 2026 ACTUAL MKT BOLIVAR.xlsx`), que
 * es la especificación más confiable que hay: son 107 renglones que Gilmer
 * clasificó a mano.
 */

import { describe, expect, it } from 'vitest';
import { claseEfectiva, empaqueEfectivo, repartirDiferencia, type ClaseItem } from './faltante-por-paquete';

/** El umbral por defecto: media caja. `Inventario.umbralMediaUnidadPaquete`. */
const MEDIA = 0.5;

describe('repartirDiferencia — la regla: el ítem ENTERO va a un cuadro', () => {
  it('EL EJEMPLO DE GILMER: empaque 6, faltan 23 -> los 23 a paquetes', () => {
    // Reunión 1, 00:18:30: "empaque de 6, le falta 23, entonces SON PAQUETES".
    // El 23 entero -- nunca dijo "3 paquetes y 5 sueltas".
    const r = repartirDiferencia(-23, 'paquete', 6, MEDIA);
    expect(r.aPaquetes).toBe(-23);
    expect(r.alPersonal).toBe(0);
  });

  it('NO SE PARTE: nunca quedan unidades en los dos cuadros a la vez', () => {
    // La prueba del archivo: ningún código aparece en FALTANTES UNICOS y en
    // FALTANTE POR PAQUETE. Si se partiera, el -21 de DORITOS tendría que
    // figurar como -12 en paquetes y -9 en únicos, y no figura.
    for (const dif of [-23, -21, -14, -9, -8, -7, -4, -3, -2, -1]) {
      const r = repartirDiferencia(dif, 'paquete', 6, MEDIA);
      const cuadrosConPlata = [r.alPersonal, r.aPaquetes, r.aEmpresa].filter((x) => x !== 0);
      expect(cuadrosConPlata).toHaveLength(1);
    }
  });

  it('menos de media caja: al personal, entero', () => {
    expect(repartirDiferencia(-2, 'paquete', 6, MEDIA).alPersonal).toBe(-2);
  });

  it('LA MITAD JUSTA no alcanza: se le descuenta al personal', () => {
    // La comparación es ESTRICTA -- "MÁS de la mitad".
    expect(repartirDiferencia(-3, 'paquete', 6, MEDIA).alPersonal).toBe(-3);
    expect(repartirDiferencia(-4, 'paquete', 6, MEDIA).aPaquetes).toBe(-4);
  });

  /**
   * EL CASO QUE DESCARTA CUALQUIER REGLA BASADA EN LA CANTIDAD ABSOLUTA, y
   * que sale directo del archivo: -37 de chocolate quedó en UNICOS y -3 de
   * limpiador quedó en PAQUETE. Lo único que explica las dos a la vez es la
   * razón contra el empaque de compra.
   */
  it('LA CANTIDAD ABSOLUTA NO DECIDE: -37 al personal y -3 a paquetes', () => {
    // NESTLE CHOCOLATE PRINCESA: caja de 540 (Gilmer mencionó ese número).
    expect(repartirDiferencia(-37, 'paquete', 540, MEDIA).alPersonal).toBe(-37);
    // VIRUTEX LIMPIADOR LAVANDA 3.8LT: pack chico.
    expect(repartirDiferencia(-3, 'paquete', 4, MEDIA).aPaquetes).toBe(-3);
  });

  it('expone la RAZON que decidió, para poder indicar el porqué', () => {
    // El "hay que indicar" del cliente: el reporte tiene que explicar por qué
    // el ítem quedó donde quedó.
    const r = repartirDiferencia(-23, 'paquete', 6, MEDIA);
    expect(r.razon).toBeCloseTo(23 / 6);
    expect(r.paquetesEnteros).toBe(3); // informativo: "casi 4 cajas de 6"
  });
});

describe('repartirDiferencia — SOBRANTES, con la misma regla', () => {
  it('el sobrante va entero al cuadro por paquete y CONSERVA EL SIGNO', () => {
    // El archivo tiene SOBRANTE POR PAQUETE con +10, +12, +18, +20 completos.
    expect(repartirDiferencia(20, 'paquete', 6, MEDIA).aPaquetes).toBe(20);
  });

  it('un sobrante chico queda a favor del personal', () => {
    // Los sobrantes únicos COMPENSAN a los faltantes: en el archivo,
    // -862.50 + 490.60 = -371.90, que es el monto a descontar.
    expect(repartirDiferencia(2, 'paquete', 6, MEDIA).alPersonal).toBe(2);
  });
});

describe('repartirDiferencia — las otras dos clases', () => {
  it('`empresa` absorbe todo: no toca ni al personal ni al cuadro de paquetes', () => {
    const r = repartirDiferencia(-23, 'empresa', 6, MEDIA);
    expect(r).toEqual({ alPersonal: 0, aPaquetes: 0, aEmpresa: -23, razon: null, paquetesEnteros: 0 });
  });

  it('`unidad` va entero al personal aunque el faltante sea enorme', () => {
    expect(repartirDiferencia(-500, 'unidad', 1, MEDIA).alPersonal).toBe(-500);
  });
});

describe('repartirDiferencia — lo que no se puede calcular', () => {
  it('`paquete` SIN empaque de compra se descuenta al personal, no al almacenero', () => {
    // NULL no es 1: sin denominador no hay razón que calcular. Mandarlo al
    // cuadro del almacenero por un dato que falta le sacaría plata al
    // descuento sin que nadie lo haya decidido.
    const r = repartirDiferencia(-23, 'paquete', null, MEDIA);
    expect(r.alPersonal).toBe(-23);
    expect(r.razon).toBeNull();
  });

  it('un empaque de 1 es "se compra por unidad": todo al personal', () => {
    // Con empaque 1 la razón sería la cantidad entera y TODO faltante de 2 o
    // más iría a paquetes, vaciando el descuento al personal de un plumazo.
    expect(repartirDiferencia(-23, 'paquete', 1, MEDIA).alPersonal).toBe(-23);
  });

  it('diferencia CERO no manda nada a ningún lado', () => {
    const r = repartirDiferencia(0, 'paquete', 6, MEDIA);
    expect(r.alPersonal).toBe(0);
    expect(r.aPaquetes).toBe(0);
  });
});

describe('repartirDiferencia — el umbral configurable', () => {
  it('un umbral más alto deja más ítems con el personal', () => {
    // Oscar (reunión 1, 00:37:49): "la mitad cuatro o la mitad más uno...
    // allí lo va a ir definiendo usted".
    expect(repartirDiferencia(-4, 'paquete', 6, 0.9).alPersonal).toBe(-4);
    expect(repartirDiferencia(-4, 'paquete', 6, 0.5).aPaquetes).toBe(-4);
  });

  it('empaque IMPAR queda bien definido: con 5, más de 2.5 es 3', () => {
    expect(repartirDiferencia(-3, 'paquete', 5, MEDIA).aPaquetes).toBe(-3);
    expect(repartirDiferencia(-2, 'paquete', 5, MEDIA).alPersonal).toBe(-2);
  });
});

describe('repartirDiferencia — LA INVARIANTE', () => {
  it('los tres cuadros SIEMPRE suman la diferencia original', () => {
    const clases: ClaseItem[] = ['empresa', 'paquete', 'unidad'];
    for (const clase of clases) {
      for (const empaque of [null, 1, 4, 6, 12, 540]) {
        for (const dif of [-540, -37, -23, -8, -3, -1, 0, 1, 3, 23, 540]) {
          const r = repartirDiferencia(dif, clase, empaque, MEDIA);
          expect(r.alPersonal + r.aPaquetes + r.aEmpresa).toBe(dif);
        }
      }
    }
  });
});

describe('claseEfectiva — la precedencia', () => {
  it('la excepción MANUAL del auditor manda sobre el snapshot', () => {
    expect(claseEfectiva('paquete', 'unidad', 6)).toBe('paquete');
    expect(claseEfectiva('unidad', 'paquete', 6)).toBe('unidad');
    expect(claseEfectiva('empresa', 'unidad', 6)).toBe('empresa');
  });

  it('sin excepción manda el snapshot', () => {
    expect(claseEfectiva(null, 'paquete', 6)).toBe('paquete');
    expect(claseEfectiva(null, 'empresa', null)).toBe('empresa');
  });

  /**
   * EL EMPAQUE RE-DERIVA LA CLASE, y esto es la mitad que faltaba: antes el
   * empaque solo DEGRADABA (paquete -> unidad) y nunca PROMOVIA. Corregirlo no
   * alcanzaba para mover el ítem, así que el Auditor tenía que corregir el
   * empaque Y ADEMÁS forzar el cuadro -- o sea el "corregir 1:1" que el
   * cliente quería evitar.
   */
  it('PROMUEVE: con empaque corregido a 12, un ítem `unidad` pasa a `paquete`', () => {
    // El caso DORITOS: el ERP lo trae con empaque 1 (símbolo "U") y el Auditor
    // lo corrige a 12. La clase del snapshot se DERIVÓ del empaque malo; con el
    // insumo arreglado, la derivación vuelve a correr.
    expect(claseEfectiva(null, 'unidad', 12)).toBe('paquete');
  });

  it('DEGRADA: con empaque 1 o null, un ítem `paquete` baja a `unidad`', () => {
    expect(claseEfectiva(null, 'paquete', 1)).toBe('unidad');
    expect(claseEfectiva(null, 'paquete', null)).toBe('unidad');
  });

  it('LÍMITE 1: `empresa` NO se toca por esta vía, por más empaque que haya', () => {
    // Que un producto lo absorba gerencia lo decide gerencia, no el tamaño de
    // una caja: corregirle el empaque a una cerveza no la saca de su cuadro.
    expect(claseEfectiva(null, 'empresa', 12)).toBe('empresa');
    expect(claseEfectiva(null, 'empresa', 1)).toBe('empresa');
  });

  it('LÍMITE 2: la excepción manual del Auditor gana a la re-derivación', () => {
    // Si el Auditor forzó `unidad` sobre un ítem con empaque 12, manda él.
    // Sin este límite, la re-derivación lo devolvería a `paquete` solo -- y
    // forzar el cuadro dejaría de servir para nada.
    expect(claseEfectiva('unidad', 'unidad', 12)).toBe('unidad');
    expect(claseEfectiva('unidad', 'paquete', 12)).toBe('unidad');
    expect(claseEfectiva('empresa', 'unidad', 12)).toBe('empresa');
  });

  it('SIN empaque de compra degrada a `unidad`, incluso contra el auditor', () => {
    expect(claseEfectiva('paquete', 'paquete', null)).toBe('unidad');
    expect(claseEfectiva(null, 'paquete', null)).toBe('unidad');
    expect(claseEfectiva('paquete', 'unidad', 1)).toBe('unidad');
  });

  it('`empresa` NO necesita empaque: no se mide nada, se absorbe entero', () => {
    expect(claseEfectiva('empresa', 'unidad', null)).toBe('empresa');
    expect(claseEfectiva(null, 'empresa', null)).toBe('empresa');
  });
});

describe('empaqueEfectivo — el empaque que vale', () => {
  it('la corrección del Auditor manda sobre el snapshot del ERP', () => {
    // Reunión 2, Fernando: "claro que tú edites el empaque y ya cambia el
    // resultado".
    expect(empaqueEfectivo(12, 1)).toBe(12);
  });

  it('sin corrección manda el snapshot', () => {
    expect(empaqueEfectivo(null, 6)).toBe(6);
  });

  it('sin ninguno de los dos sigue siendo null, no 1', () => {
    // NULL no es 1: "no se sabe el tamaño del paquete" es distinto de "se
    // compra por unidad", y con null la regla del umbral no corre.
    expect(empaqueEfectivo(null, null)).toBeNull();
  });

  it('el snapshot NO se pierde: esta función elige cuál MIDE, no reemplaza', () => {
    // El snapshot tiene que seguir diciendo lo que dijo Dynamics, para poder
    // responder "el ERP dijo 1 y el Auditor lo corrigió a 12".
    const snapshot = 1;
    expect(empaqueEfectivo(12, snapshot)).toBe(12);
    expect(snapshot).toBe(1);
  });
});

/**
 * EL ORDEN: `empaqueEfectivo` -> `claseEfectiva` -> `repartirDiferencia`.
 *
 * Es el bug que este test existe para que no vuelva: si `claseEfectiva` ve el
 * empaque del SNAPSHOT en vez del corregido, degrada a `unidad` antes de que
 * nadie mire la corrección, y la corrección no cambia un solo sol.
 */
describe('el orden de las tres funciones NO es intercambiable', () => {
  // DORITOS QUESO ATREVIDO 90G: Dynamics lo trae con PurchaseUnitSymbol 'U'
  // (empaque 1) y el Auditor lo corrige a 12. Faltan 21 -> 21/12 = 1.75 > 0.5,
  // o sea cuadro de paquetes. Es uno de los renglones que Gilmer clasificó a
  // mano en el Excel de Bolívar.
  const SNAPSHOT = 1;
  const CORREGIDO = 12;
  const FALTAN = -21;

  it('BIEN: resolver el empaque efectivo PRIMERO manda el ítem a paquetes', () => {
    const empaque = empaqueEfectivo(CORREGIDO, SNAPSHOT);
    const clase = claseEfectiva(null, 'paquete', empaque);
    const r = repartirDiferencia(FALTAN, clase, empaque, MEDIA);

    expect(clase).toBe('paquete');
    expect(r.aPaquetes).toBe(FALTAN);
    expect(r.alPersonal).toBe(0);
  });

  it('MAL: con el empaque del snapshot, la corrección no sirve para nada', () => {
    // Empaque 1 -> `claseEfectiva` degrada a `unidad` -> se le descuenta al
    // personal. La corrección se guardó, se ve en pantalla, y no movió nada.
    const clase = claseEfectiva(null, 'paquete', SNAPSHOT);
    const r = repartirDiferencia(FALTAN, clase, SNAPSHOT, MEDIA);

    expect(clase).toBe('unidad');
    expect(r.alPersonal).toBe(FALTAN);
    expect(r.aPaquetes).toBe(0);
  });
});
