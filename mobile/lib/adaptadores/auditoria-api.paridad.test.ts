/**
 * ---------------------------------------------------------------------------
 * LA ÚNICA FORMA DE QUE LAS DOS COPIAS NO SE SEPAREN
 * ---------------------------------------------------------------------------
 * `mobile/lib/dominio/auditoria.ts` es una copia DELIBERADA de
 * `backend/src/modules/auditoria/auditoria.calculos.ts`: las pantallas del
 * teléfono calculan la diferencia SIN RED (la matriz, el ajuste final, la
 * corrección), así que la cuenta tiene que existir de los dos lados.
 *
 * El precio de esa decisión es que las dos pueden divergir, y cuando divergen el
 * Auditor ve un número en la pantalla y otro en el cierre sin forma de saber cuál
 * es el bueno. Ya pasó: hasta hoy la copia del teléfono restaba contra un único
 * `stockErp` mientras el servidor medía cada ronda contra la suya.
 *
 * ESTE TEST ES EL CABLE TRAMPA. El DTO del servidor manda por fila sus propios
 * derivados (`conteoFinal`, `diferenciaUnidades`, `diferenciaValor`, `veredicto`,
 * `stockDeLaMedicion`) y el adaptador los DESCARTA a propósito -- el dominio del
 * front los calcula solo, porque tener dos fuentes para el mismo número en
 * PRODUCCIÓN es justo lo que hay que evitar. Acá, en cambio, se usan como
 * respuesta correcta: se le pasa al dominio local lo que el servidor mandó y se
 * exige que llegue al mismo resultado, fila por fila.
 *
 * LAS FILAS SON EL CONTRATO DEL SERVIDOR, no expectativas inventadas de este
 * lado: la forma sale de `FilaMatrizDto` (auditoria.service.ts) y los derivados
 * de la regla escrita en `auditoria.calculos.ts#stockDeLaMedicion`. Si un día se
 * captura la matriz real del inventario 8078, esas filas reemplazan a estas sin
 * tocar una sola aserción -- los `expect` no repiten la regla, comparan las dos
 * implementaciones entre sí.
 *
 * NO ASERTA SOBRE `atribucion`: ese reparto lo decide el servidor con el umbral
 * congelado en el inventario, que no viaja en ninguna respuesta. No hay copia
 * local que pueda diferir, así que no hay nada que comparar (ver
 * `AtribucionItem` en dominio/tipos.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({}) }));

import {
  conteoFinal,
  diferenciaUnidades,
  diferenciaValor,
  stockDeLaMedicion,
  veredicto,
} from '../dominio/auditoria';
import type { AtribucionItem, ItemAuditoria, VeredictoAuditoria } from '../dominio/tipos';
import { recordarToken } from './_http';
import { auditoriaApi } from './auditoria-api';

/** Lo que el servidor manda de más en cada fila. Ver `FilaMatrizDto`. */
interface DerivadosDelServidor {
  conteoFinal: number | null;
  diferenciaUnidades: number | null;
  diferenciaValor: number | null;
  veredicto: VeredictoAuditoria;
  stockDeLaMedicion: {
    stockErp: number | null;
    rondaDelConteo: number | null;
    rondaDelStock: number | null;
    cayoALaRonda1: boolean;
  };
}

type FilaMatrizDto = ItemAuditoria & DerivadosDelServidor;

/** El reparto no se compara (ver la cabecera): viaja en cero para completar la forma. */
const ATRIBUCION: AtribucionItem = {
  clase: 'unidad',
  empaqueUsado: null,
  empaqueSimbolo: null,
  empaqueEsCorregido: false,
  razon: null,
  unidadesAlPersonal: 0,
  unidadesAPaquetes: 0,
  unidadesAEmpresa: 0,
};

let sig = 0;
function fila(datos: Partial<FilaMatrizDto> & DerivadosDelServidor): FilaMatrizDto {
  sig += 1;
  return {
    productoId: sig,
    codigo: `C${sig}`,
    descripcion: `Producto ${sig}`,
    zona: 'ABARROTES',
    hoja: '001',
    precioVenta: 2,
    stockErp: null,
    conteos: [],
    stockPorRonda: [],
    atribucion: ATRIBUCION,
    esEmpresa: false,
    ...datos,
  };
}

/**
 * LOS CASOS QUE EL STOCK POR RONDA HABILITÓ, cada uno con la respuesta del
 * servidor al lado. Los precios son enteros a propósito: el servidor redondea
 * `diferenciaValor` a dos decimales y el móvil no (es una diferencia que ya
 * existía, ajena a este cambio), y con enteros el redondeo no puede tapar una
 * divergencia real de la resta.
 */
const FILAS: FilaMatrizDto[] = [
  // La ronda 3 con stock propio: se mide contra el stock del día del reconteo.
  fila({
    codigo: 'RONDA-PROPIA',
    stockErp: 96,
    stockPorRonda: [96, 94, 92],
    conteos: [88, 90, 92],
    precioVenta: 5,
    conteoFinal: 92,
    diferenciaUnidades: 0,
    diferenciaValor: 0,
    veredicto: 'cuadrado',
    stockDeLaMedicion: { stockErp: 92, rondaDelConteo: 3, rondaDelStock: 3, cayoALaRonda1: false },
  }),
  // La ronda 2 sin stock propio: cae a la ronda 1 y la caída va marcada.
  fila({
    codigo: 'CAIDA',
    stockErp: 80,
    stockPorRonda: [80, null],
    conteos: [74, 78],
    precioVenta: 3,
    conteoFinal: 78,
    diferenciaUnidades: -2,
    diferenciaValor: -6,
    veredicto: 'falta',
    stockDeLaMedicion: { stockErp: 80, rondaDelConteo: 2, rondaDelStock: 1, cayoALaRonda1: true },
  }),
  // EL CASO QUE HACE TROPEZAR: cuadró en la ronda 1 y nunca se recontó, aunque la
  // ronda 2 existe y trajo su propio stock (50). Manda la ronda del CONTEO.
  fila({
    codigo: 'CUADRO-EN-LA-1',
    stockErp: 54,
    stockPorRonda: [54, 50],
    conteos: [54, null],
    precioVenta: 5,
    conteoFinal: 54,
    diferenciaUnidades: 0,
    diferenciaValor: 0,
    veredicto: 'cuadrado',
    stockDeLaMedicion: { stockErp: 54, rondaDelConteo: 1, rondaDelStock: 1, cayoALaRonda1: false },
  }),
  // La ronda 1 no trajo stock pero el reconteo sí: deja de ser `sin_erp`.
  fila({
    codigo: 'SOLO-EN-LA-2',
    stockErp: null,
    stockPorRonda: [null, 12],
    conteos: [10, 12],
    precioVenta: 2,
    conteoFinal: 12,
    diferenciaUnidades: 0,
    diferenciaValor: 0,
    veredicto: 'cuadrado',
    stockDeLaMedicion: { stockErp: 12, rondaDelConteo: 2, rondaDelStock: 2, cayoALaRonda1: false },
  }),
  // Un inventario de los que ya estaban en la base: `[]`, todo cae a la ronda 1.
  fila({
    codigo: 'INVENTARIO-VIEJO',
    stockErp: 30,
    stockPorRonda: [],
    conteos: [25, 25, 25],
    precioVenta: 2,
    conteoFinal: 25,
    diferenciaUnidades: -5,
    diferenciaValor: -10,
    veredicto: 'falta',
    stockDeLaMedicion: { stockErp: 30, rondaDelConteo: 3, rondaDelStock: 1, cayoALaRonda1: true },
  }),
  // Con stock y sin ningún conteo: no hay ronda que resolver.
  fila({
    codigo: 'SIN-CONTAR',
    stockErp: 10,
    stockPorRonda: [10],
    conteos: [null],
    precioVenta: 2,
    conteoFinal: null,
    diferenciaUnidades: null,
    diferenciaValor: null,
    veredicto: 'sin_contar',
    stockDeLaMedicion: { stockErp: 10, rondaDelConteo: null, rondaDelStock: 1, cayoALaRonda1: false },
  }),
  // Sin stock en ninguna ronda: `sin_erp`, y sin prometer una ronda que no hay.
  fila({
    codigo: 'SIN-ERP',
    stockErp: null,
    stockPorRonda: [],
    conteos: [5],
    precioVenta: 2,
    conteoFinal: 5,
    diferenciaUnidades: null,
    diferenciaValor: null,
    veredicto: 'sin_erp',
    stockDeLaMedicion: { stockErp: null, rondaDelConteo: 1, rondaDelStock: null, cayoALaRonda1: false },
  }),
];

function json(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

beforeEach(() => {
  recordarToken('token-de-prueba');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ total: FILAS.length, limite: 500, desplazamiento: 0, matriz: FILAS })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Las filas se emparejan POR CÓDIGO y no por posición: si el adaptador alguna vez
 * reordena o pierde una fila, el fallo dice cuál en vez de comparar dos ítems
 * distintos entre sí y culpar al cálculo.
 */
async function pares(): Promise<Array<{ local: ItemAuditoria; delServidor: FilaMatrizDto }>> {
  const items = await auditoriaApi.matriz(8078);
  const porCodigo = new Map(items.map((item) => [item.codigo, item]));

  return FILAS.map((delServidor) => {
    const local = porCodigo.get(delServidor.codigo);
    // `throw` y no un `!`: si el adaptador no devolvió la fila, el problema es ese
    // y hay que decirlo con su nombre -- no seguir comparando contra undefined.
    if (local === undefined) throw new Error(`el adaptador no devolvió la fila ${delServidor.codigo}`);
    return { local, delServidor };
  });
}

describe('la copia del teléfono contra el servidor, fila por fila', () => {
  it('el adaptador trae `stockPorRonda`: sin eso todo mediría contra la ronda 1 en silencio', async () => {
    for (const { local, delServidor } of await pares()) {
      // `toEqual` y no `toBe`: la lista se pasa tal cual, pero lo que importa es
      // que llegue con su contenido -- un `[]` de relleno compilaría igual y haría
      // que cada reconteo se compare contra el stock del día 22.
      expect(local.stockPorRonda, delServidor.codigo).toEqual(delServidor.stockPorRonda);
    }
  });

  it('`stockDeLaMedicion` da lo mismo de los dos lados', async () => {
    for (const { local, delServidor } of await pares()) {
      expect(stockDeLaMedicion(local), delServidor.codigo).toEqual(delServidor.stockDeLaMedicion);
    }
  });

  it('la diferencia, el conteo que manda y el veredicto dan lo mismo de los dos lados', async () => {
    for (const { local, delServidor } of await pares()) {
      expect(conteoFinal(local), delServidor.codigo).toBe(delServidor.conteoFinal);
      expect(diferenciaUnidades(local), delServidor.codigo).toBe(delServidor.diferenciaUnidades);
      expect(diferenciaValor(local), delServidor.codigo).toBe(delServidor.diferenciaValor);
      expect(veredicto(local), delServidor.codigo).toBe(delServidor.veredicto);
    }
  });

  /**
   * LA PRUEBA DE QUE ESTE TEST SIRVE PARA ALGO: si la copia local volviera a
   * restar contra `item.stockErp` -- que es lo que hacía hasta hoy -- dos de las
   * siete filas darían otra cosa. Se verifica acá para que nadie pueda "arreglar"
   * el test aflojando las aserciones de arriba sin darse cuenta de qué protegen.
   */
  it('la regla vieja (restar siempre contra la ronda 1) daría distinto en las filas con stock propio', async () => {
    const alaVieja = (item: ItemAuditoria): number | null => {
      const final = conteoFinal(item);
      if (item.stockErp === null || final === null) return null;
      return final - item.stockErp;
    };

    const distintas = (await pares()).filter(
      ({ local, delServidor }) => alaVieja(local) !== delServidor.diferenciaUnidades,
    );

    expect(distintas.map(({ delServidor }) => delServidor.codigo)).toEqual(['RONDA-PROPIA', 'SOLO-EN-LA-2']);
  });
});
