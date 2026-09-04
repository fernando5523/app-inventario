import { describe, expect, it } from 'vitest';
import { SolicitudInvalida } from '../../shared/errores';
import { mensajeSinAlmacen, puedeTraerStock, resolverAlmacen } from './tiendas.almacen';

/** Como los devuelve GET /api/d365/almacenes (entidad Warehouses del ERP). */
const DISPONIBLES = [
  { codigo: 'MD11_CENT', nombre: 'Market Central Luzuriaga' },
  { codigo: 'AD04_TCE', nombre: 'Almacen Carhuaz' },
  { codigo: 'MD22_BOL', nombre: 'Market Bolivar' },
];

describe('resolverAlmacen', () => {
  it('devuelve codigo Y nombre del almacen elegido', () => {
    // El nombre se copia a la sucursal: mostrar una tienda no deberia
    // exigir una llamada a Dynamics.
    expect(resolverAlmacen('MD11_CENT', DISPONIBLES)).toEqual({
      almacenId: 'MD11_CENT',
      almacenNombre: 'Market Central Luzuriaga',
    });
  });

  it('acepta el codigo en minusculas pero guarda el del ERP', () => {
    // Si se guardara lo que vino del cliente, dos tiendas podrian quedar con
    // "md11_cent" y "MD11_CENT" para el mismo almacen y cualquier
    // comparacion posterior fallaria.
    expect(resolverAlmacen('md11_cent', DISPONIBLES).almacenId).toBe('MD11_CENT');
  });

  it('RECHAZA un codigo que no existe en Dynamics', () => {
    // El caso caro: "MD11_CNET" tiene forma valida y traeria el stock de
    // otra tienda -- o de ninguna -- sin que nadie se entere.
    expect(() => resolverAlmacen('MD11_CNET', DISPONIBLES)).toThrow(SolicitudInvalida);
  });

  it('sugiere los parecidos: casi siempre es un dedazo', () => {
    expect(() => resolverAlmacen('MD11_CNET', DISPONIBLES)).toThrow(/MD11_CENT/);
  });

  it('cuando no hay parecidos, dice donde esta la lista', () => {
    expect(() => resolverAlmacen('ZZZZZ', DISPONIBLES)).toThrow(/d365\/almacenes/);
  });

  it('el mensaje explica la consecuencia, no solo que no existe', () => {
    expect(() => resolverAlmacen('ZZZZZ', DISPONIBLES)).toThrow(/stock de otra tienda/);
  });

  it('con la lista vacia rechaza todo en vez de aceptar cualquier cosa', () => {
    expect(() => resolverAlmacen('MD11_CENT', [])).toThrow(SolicitudInvalida);
  });
});

describe('puedeTraerStock', () => {
  it('sin almacen configurado, no', () => {
    expect(puedeTraerStock({ almacenId: null })).toBe(false);
    expect(puedeTraerStock({ almacenId: '' })).toBe(false);
  });

  it('con almacen, si', () => {
    expect(puedeTraerStock({ almacenId: 'MD11_CENT' })).toBe(true);
  });
});

describe('mensajeSinAlmacen', () => {
  it('nombra la tienda y dice quien lo arregla y como', () => {
    const m = mensajeSinAlmacen('Market Sucre');
    expect(m).toContain('Market Sucre');
    expect(m).toContain('administrador');
    expect(m).toContain('almacenId');
  });
});
