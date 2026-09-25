/**
 * EL CONTRATO DE `GET /api/auditoria/cadena`: las diez tiendas de un periodo
 * en una sola llamada.
 *
 * Lo que se fija acá es lo que la pantalla del Auditor va a creer:
 *
 *   1. EL TOTAL ES LA SUMA DE LAS FILAS. Quien mira el pie de la tabla va a
 *      sumar la columna con la calculadora; si no da, el centavo que sobra no
 *      esta en ninguna parte que se pueda señalar.
 *   2. UNA TIENDA SIN INVENTARIO SALE IGUAL, con `inventarioId: null` y en
 *      cero. Es la cobertura del periodo -- esconderla haria que una cadena con
 *      tres tiendas arrancadas se leyera como una cadena de tres tiendas.
 *   3. EL COORDINADOR RECIBE 403. Coordina UNA tienda; los faltantes de las
 *      otras nueve son plata de gente que no conoce.
 *   4. UN ITEM SIN STOCK DEL ERP NO CUENTA COMO CUADRADO. La regla de siempre,
 *      verificada por esta via tambien: es el error que ya reporto "100%
 *      cuadrado" sobre 11.835 productos sin stock cargado.
 *
 * 1, 2 y 4 se prueban SIN BASE: las cifras de cada fila salen de `resumir`, que
 * es puro, y el recorte y la suma tambien. 3 se prueba por HTTP contra el router
 * REAL -- `validarAccesoALaCadena` es la primera linea del service, asi que el
 * 403 sale antes de que nada toque Prisma.
 */

import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { Prohibido } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  filaDeCadena,
  filaDeCadenaSinInventario,
  porClaseVacia,
  resumir,
  totalizarCadena,
  type FilaCadena,
  type ItemAuditoria,
} from './auditoria.calculos';
import { validarAccesoALaCadena } from './auditoria.permisos';

const UMBRAL = 0.5;

/** Un item de catalogo con lo minimo para que `resumir` lo pueda mirar. */
function item(parcial: Partial<ItemAuditoria> & { codigo: string }): ItemAuditoria {
  return {
    productoId: 1,
    descripcion: `Producto ${parcial.codigo}`,
    zona: 'A',
    hoja: '001',
    precioVenta: 10,
    stockErp: 10,
    clase: 'unidad',
    claseForzada: null,
    empaqueCompra: null,
    empaqueCompraSimbolo: null,
    empaqueCompraCorregido: null,
    conteos: [10],
    esEmpresa: false,
    ...parcial,
  };
}

function fila(sucursalId: number, nombre: string, items: ItemAuditoria[]): FilaCadena {
  return filaDeCadena(
    { sucursalId, sucursal: nombre, inventarioId: 8000 + sucursalId, estado: 'ajuste_auditor' },
    resumir(items, UMBRAL),
  );
}

describe('el total es la suma de las tiendas', () => {
  /** Dos tiendas con faltante y sobrante de verdad, mas una que no arranco. */
  const luzuriaga = fila(1, 'Market Luzuriaga', [
    item({ codigo: 'A1', stockErp: 10, conteos: [7] }), // faltan 3 -> 30
    item({ codigo: 'A2', stockErp: 10, conteos: [14] }), // sobran 4 -> 40
    item({ codigo: 'A3', stockErp: 5, conteos: [5] }), // cuadra
  ]);
  const carhuaz = fila(2, 'Market Carhuaz', [
    item({ codigo: 'B1', stockErp: 20, conteos: [18], precioVenta: 2.5 }), // faltan 2 -> 5
    item({ codigo: 'B2', stockErp: 8, conteos: [8] }), // cuadra
  ]);
  const sucre = filaDeCadenaSinInventario(3, 'Market Sucre');
  const total = totalizarCadena([luzuriaga, carhuaz, sucre]);

  it('los conteos de items, auditables y cuadrados suman', () => {
    expect(total.items).toBe(luzuriaga.items + carhuaz.items + sucre.items);
    expect(total.auditables).toBe(luzuriaga.auditables + carhuaz.auditables + sucre.auditables);
    expect(total.cuadrados).toBe(luzuriaga.cuadrados + carhuaz.cuadrados + sucre.cuadrados);
    expect(total.items).toBe(5);
    expect(total.cuadrados).toBe(2);
  });

  it('la plata suma al centavo', () => {
    expect(total.valorFaltante).toBe(35); // 30 + 5
    expect(total.valorSobrante).toBe(40);
    expect(total.valorFaltante).toBe(luzuriaga.valorFaltante + carhuaz.valorFaltante);
  });

  /**
   * LOS TRES CUADROS TAMBIEN SUMAN. Es lo que impide que un item se cuente dos
   * veces o se pierda entre cuadros al totalizar diez tiendas -- la misma
   * invariante que ya tiene `resumir` para una.
   */
  it('cada cuadro suma el de las tiendas, y los tres suman el total', () => {
    for (const clase of ['unidad', 'paquete', 'empresa'] as const) {
      expect(total.porClase[clase].valorFaltante).toBe(
        luzuriaga.porClase[clase].valorFaltante + carhuaz.porClase[clase].valorFaltante,
      );
      expect(total.porClase[clase].items).toBe(luzuriaga.porClase[clase].items + carhuaz.porClase[clase].items);
    }
    const sumaDeCuadros =
      total.porClase.unidad.valorFaltante + total.porClase.paquete.valorFaltante + total.porClase.empresa.valorFaltante;
    expect(sumaDeCuadros).toBe(total.valorFaltante);
  });

  it('cuenta las tiendas y cuantas arrancaron el periodo', () => {
    expect(total.tiendas).toBe(3);
    expect(total.conInventario).toBe(2);
  });

  /**
   * SUMAR DECIMALES DESVIA, y el JSON no puede llevar esa cola: 161.7 + 88 da
   * 249.70000000000002 en punto flotante. Por eso el total se vuelve a
   * redondear aunque cada fila ya venga redondeada.
   */
  it('no arrastra la cola del punto flotante', () => {
    const a = fila(1, 'A', [item({ codigo: 'X', stockErp: 100, conteos: [43], precioVenta: 2.79 })]);
    const b = fila(2, 'B', [item({ codigo: 'Y', stockErp: 100, conteos: [89], precioVenta: 1.61 })]);
    const t = totalizarCadena([a, b]);
    expect(t.valorFaltante).toBe(Number(t.valorFaltante.toFixed(2)));
    expect(String(t.valorFaltante)).not.toMatch(/\d{5,}$/);
  });
});

describe('una tienda que no arranco el periodo', () => {
  const sinInventario = filaDeCadenaSinInventario(26, 'Market Carhuaz');

  it('va en la lista igual: no se esconde', () => {
    expect(sinInventario.sucursalId).toBe(26);
    expect(sinInventario.sucursal).toBe('Market Carhuaz');
  });

  it('con los dos ids en null -- no en 0, que seria un inventario que existe', () => {
    expect(sinInventario.inventarioId).toBeNull();
    expect(sinInventario.estado).toBeNull();
  });

  it('y todo en cero, cuadros incluidos', () => {
    expect(sinInventario.items).toBe(0);
    expect(sinInventario.auditables).toBe(0);
    expect(sinInventario.cuadrados).toBe(0);
    expect(sinInventario.valorFaltante).toBe(0);
    expect(sinInventario.valorSobrante).toBe(0);
    expect(sinInventario.porClase).toEqual(porClaseVacia());
  });

  it('no mueve el total mas que el denominador de la cobertura', () => {
    const conDatos = fila(1, 'Market Luzuriaga', [item({ codigo: 'A1', stockErp: 10, conteos: [7] })]);
    const solo = totalizarCadena([conDatos]);
    const conVacia = totalizarCadena([conDatos, sinInventario]);
    expect(conVacia.valorFaltante).toBe(solo.valorFaltante);
    expect(conVacia.items).toBe(solo.items);
    expect(conVacia.tiendas).toBe(2);
    expect(conVacia.conInventario).toBe(1);
  });
});

describe('un item sin stock del ERP no cuenta como cuadrado', () => {
  /**
   * EL ERROR QUE ESTO IMPIDE, y que ya paso: con `stockErp` en null leido como
   * 0, un item que nadie pudo comparar se reportaba como cuadrado. Contra los
   * 11.835 productos sin stock cargado, la pantalla decia "100% cuadrado" --
   * un falso "todo bien" en el unico lugar donde se decide si el mes cierra.
   */
  const conHuecos = fila(1, 'Market Luzuriaga', [
    item({ codigo: 'A1', stockErp: 10, conteos: [10] }), // cuadra de verdad
    item({ codigo: 'A2', stockErp: null, conteos: [10] }), // sin ERP: no se puede afirmar nada
    item({ codigo: 'A3', stockErp: null, conteos: [] }), // ni ERP ni conteo
  ]);

  it('los tres items viajan, pero solo uno es auditable', () => {
    expect(conHuecos.items).toBe(3);
    expect(conHuecos.auditables).toBe(1);
  });

  it('y solo ese uno cuenta como cuadrado', () => {
    expect(conHuecos.cuadrados).toBe(1);
  });

  it('el total de la cadena arrastra la misma regla', () => {
    const total = totalizarCadena([conHuecos, filaDeCadenaSinInventario(2, 'Market Carhuaz')]);
    expect(total.items).toBe(3);
    expect(total.auditables).toBe(1);
    expect(total.cuadrados).toBe(1);
    // Lo que NO puede pasar: que cuadrados iguale items y la tabla diga 100%.
    expect(total.cuadrados).not.toBe(total.items);
  });
});

describe('quien puede pedir la cadena', () => {
  const admin: ColaboradorAutenticado = { colaboradorId: 1000, sucursalId: null, rol: 'administrador' };
  const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: 1, rol: 'auditor' };
  const jose: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: 1, rol: 'coordinador' };
  const maria: ColaboradorAutenticado = { colaboradorId: 102, sucursalId: 1, rol: 'conteo' };

  it('el auditor y el administrador si', () => {
    expect(() => validarAccesoALaCadena(gilmer)).not.toThrow();
    expect(() => validarAccesoALaCadena(admin)).not.toThrow();
  });

  it('el coordinador no, y el mensaje dice a donde va en vez de solo negar', () => {
    expect(() => validarAccesoALaCadena(jose)).toThrow(Prohibido);
    expect(() => validarAccesoALaCadena(jose)).toThrow(/inventario de su tienda/i);
  });

  it('el rol conteo tampoco', () => {
    expect(() => validarAccesoALaCadena(maria)).toThrow(Prohibido);
  });
});

/**
 * EL 403 POR HTTP, contra el router REAL y su controller real. No se mockea el
 * service: `validarAccesoALaCadena` es su primera linea, asi que el rechazo sale
 * antes de que nada toque Prisma -- y eso es justamente lo que se quiere fijar,
 * que el corte esta ANTES del trabajo y no despues de armar diez matrices.
 */
describe('GET /api/auditoria/cadena por HTTP', () => {
  it('el coordinador recibe 403 con un JSON que explica por que', async () => {
    const { auditoriaRouter } = await import('./auditoria.routes');
    const app = express();
    app.use(express.json());
    // Se inyecta el actor a mano en vez de mockear la sesion: lo que se prueba
    // es el recorte de rol, no el login.
    app.use((req, _res, next) => {
      (req as express.Request & { colaborador?: ColaboradorAutenticado }).colaborador = {
        colaboradorId: 101,
        sucursalId: 1,
        rol: 'coordinador',
      };
      next();
    });
    app.use('/api/auditoria', auditoriaRouter);
    const { errorMiddleware } = await import('../../middleware/error.middleware');
    app.use(errorMiddleware);

    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as { port: number };
    try {
      const respuesta = await fetch(`http://127.0.0.1:${port}/api/auditoria/cadena`);
      expect(respuesta.status).toBe(403);
      expect(respuesta.headers.get('content-type')).toContain('application/json');
      const cuerpo = (await respuesta.json()) as { error: string };
      expect(cuerpo.error).toMatch(/auditor y del administrador/i);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

vi.mock('../../middleware/auth.middleware', () => ({
  // El login no es lo que se prueba: el actor lo inyecta el test.
  requiereSesion: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
