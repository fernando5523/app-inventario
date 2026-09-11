import { describe, expect, it } from 'vitest';

import type { ReporteGerencia } from '../puertos/repositorios';
import {
  nombreArchivoReporteGerencia,
  textoMontoReporte,
  textoSinPrecioReporte,
  textoUnidadesReporte,
  vistaReporteGerencia,
} from './reporte-gerencia';

// Formateadores deterministas: el test no puede depender del ICU del runtime.
const soles = (n: number): string => `S/ ${n.toFixed(2)}`;
const miles = (n: number): string => String(n);

function reporte(parcial: Partial<ReporteGerencia> = {}): ReporteGerencia {
  return {
    inventarioId: 45,
    estado: 'liquidado',
    faltantes: [
      { codigo: 'CERV620', descripcion: 'Cerveza 620ml', unidades: 10, monto: 100 },
      { codigo: 'PISCO', descripcion: 'Pisco 700ml', unidades: 1, monto: null },
    ],
    sobrantes: [{ codigo: 'VINO750', descripcion: 'Vino tinto 750ml', unidades: 3, monto: 45 }],
    totalFaltante: 100,
    totalSobrante: 45,
    ...parcial,
  };
}

describe('vistaReporteGerencia: qué muestra la tarjeta del reporte', () => {
  it('con la planilla sin cerrar NO hay reporte, y dice POR QUÉ -- nunca una lista vacía', () => {
    const v = vistaReporteGerencia({ proyectada: true, reporte: null, error: null });

    expect(v.tipo).toBe('no-liquidado');
    // La causa real: qué productos son de la empresa recién queda fijo al liquidar.
    expect(v.tipo === 'no-liquidado' && v.motivo).toMatch(/liquid/);
    expect(v.tipo === 'no-liquidado' && v.motivo).toMatch(/empresa/);
  });

  it('sin liquidar gana aunque haya quedado un reporte en memoria de otra tienda', () => {
    expect(vistaReporteGerencia({ proyectada: true, reporte: reporte(), error: null }).tipo).toBe('no-liquidado');
  });

  it('liquidada y todavía sin respuesta: "cargando", no "sin productos"', () => {
    expect(vistaReporteGerencia({ proyectada: false, reporte: null, error: null }).tipo).toBe('cargando');
  });

  it('si el pedido falló, el motivo del servidor tal cual', () => {
    expect(vistaReporteGerencia({ proyectada: false, reporte: null, error: 'Sin conexión con el servidor.' })).toEqual({
      tipo: 'error',
      motivo: 'Sin conexión con el servidor.',
    });
  });

  it('liquidada y sin productos de la empresa con diferencias: lo dice, en vez de dos listas vacías', () => {
    const v = vistaReporteGerencia({ proyectada: false, reporte: reporte({ faltantes: [], sobrantes: [] }), error: null });

    expect(v.tipo).toBe('sin-productos');
    expect(v.tipo === 'sin-productos' && v.motivo).toMatch(/no hubo/i);
  });

  it('con datos: faltantes y sobrantes separados, los totales del servidor y cuántos no tienen precio', () => {
    const v = vistaReporteGerencia({ proyectada: false, reporte: reporte(), error: null });

    expect(v).toMatchObject({ tipo: 'con-datos', totalFaltante: 100, totalSobrante: 45, sinPrecio: 1 });
    expect(v.tipo === 'con-datos' && v.faltantes.map((f) => f.codigo)).toEqual(['CERV620', 'PISCO']);
    expect(v.tipo === 'con-datos' && v.sobrantes.map((f) => f.codigo)).toEqual(['VINO750']);
  });

  it('con datos solo de un lado: el otro lado viene vacío, no se esconde la tarjeta', () => {
    const v = vistaReporteGerencia({ proyectada: false, reporte: reporte({ sobrantes: [], totalSobrante: 0 }), error: null });
    expect(v).toMatchObject({ tipo: 'con-datos', sobrantes: [] });
  });
});

describe('textoMontoReporte', () => {
  it('sin precio en Dynamics dice "Sin precio", nunca S/ 0.00', () => {
    expect(textoMontoReporte(null, soles)).toBe('Sin precio');
  });

  it('con precio, el formateador que le pasan', () => {
    expect(textoMontoReporte(100, soles)).toBe('S/ 100.00');
  });
});

describe('textoSinPrecioReporte: el total no incluye a los que no tienen precio, y se dice', () => {
  it('singular', () => {
    expect(textoSinPrecioReporte(1)).toBe('1 producto no tiene precio en Dynamics: está en la lista pero no suma al total.');
  });

  it('plural', () => {
    expect(textoSinPrecioReporte(3)).toBe('3 productos no tienen precio en Dynamics: están en la lista pero no suman al total.');
  });
});

describe('textoUnidadesReporte: el signo es la segunda vía, además del color', () => {
  it('faltante en negativo', () => {
    expect(textoUnidadesReporte('faltante', 10, miles)).toBe('-10 und');
  });

  it('sobrante en positivo', () => {
    expect(textoUnidadesReporte('sobrante', 3, miles)).toBe('+3 und');
  });

  it('usa el formateador de miles que le pasan', () => {
    expect(textoUnidadesReporte('faltante', 1200, () => '1.200')).toBe('-1.200 und');
  });
});

describe('nombreArchivoReporteGerencia: el mismo formato que el backend', () => {
  it('tienda + período + inventario, sin tildes ni espacios', () => {
    expect(nombreArchivoReporteGerencia('Market Bolívar', 2026, 8, 45)).toBe('reporte-gerencia-market-bolivar-2026-08-inv45.xlsx');
  });

  it('sucursal vacía o solo símbolos no deja un nombre roto', () => {
    expect(nombreArchivoReporteGerencia('---', 2026, 12, 3)).toBe('reporte-gerencia-sucursal-2026-12-inv3.xlsx');
  });
});
