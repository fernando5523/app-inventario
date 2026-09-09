import { describe, expect, it } from 'vitest';
import { textoDeCriterios } from './criterios-snapshot';
import type { CriteriosSnapshot } from '../puertos/repositorios';

const miles = (n: number): string => String(n);

/** Lo que devuelve el backend HOY: stock y responsable sí, estado activo no. */
const HOY: CriteriosSnapshot = { porStock: true, porResponsable: true, porEstadoActivo: false };

describe('textoDeCriterios: el resumen dice qué ENTRÓ', () => {
  it('con los dos filtros que existen hoy, los nombra a los dos', () => {
    const t = textoDeCriterios(6297, 'mensual', HOY, miles);
    expect(t.resumen).toBe('Entraron 6297 ítems: los que tienen stock en el almacén de la tienda y son responsabilidad del personal.');
  });

  it('singular con un solo ítem', () => {
    expect(textoDeCriterios(1, 'mensual', HOY, miles).resumen).toContain('Entraron 1 ítem:');
  });

  it('sin dato de criterios (backend viejo) NO afirma ningún filtro: solo cuántos entraron', () => {
    // "No sé qué corrió" no es "no se filtró nada", y tampoco es "se filtró
    // todo". La única afirmación honesta es el número.
    const t = textoDeCriterios(500, 'mensual', undefined, miles);
    expect(t.resumen).toBe('Entraron 500 ítems al inventario.');
    expect(t.advertencia).toBeNull();
  });

  it('usa el formateador que le pasan, no uno propio', () => {
    const t = textoDeCriterios(8000, 'mensual', HOY, (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
    expect(t.resumen).toContain('8.000 ítems');
  });
});

describe('textoDeCriterios: la advertencia dice qué NO se pudo filtrar', () => {
  it('caso de hoy: avisa que entran los bloqueados/descontinuados', () => {
    // El filtro por estado no existe en el sistema: la app no puede
    // prometerlo, así que lo declara.
    const t = textoDeCriterios(6297, 'mensual', HOY, miles);
    expect(t.advertencia).toBe('Entraron también incluyendo los que están bloqueados o descontinuados en Dynamics.');
  });

  it('SIN ALMACÉN: lo dice, y explica que la tienda no lo tiene configurado', () => {
    const t = textoDeCriterios(11835, 'mensual', { ...HOY, porStock: false }, miles);
    expect(t.resumen).toBe('Entraron 11835 ítems: los que son responsabilidad del personal.');
    expect(t.advertencia).toContain('sin filtrar por stock');
    expect(t.advertencia).toContain('no tiene almacén configurado');
  });

  it('SIN RESPONSABLES en el mensual: avisa que no se separó lo de la empresa', () => {
    const t = textoDeCriterios(9000, 'mensual', { ...HOY, porResponsable: false }, miles);
    expect(t.resumen).toBe('Entraron 9000 ítems: los que tienen stock en el almacén de la tienda.');
    expect(t.advertencia).toContain('sin separar lo que asume la empresa');
  });

  it('en el ANUAL no se avisa por responsable: contar todo es lo correcto ahí, no una falla', () => {
    const t = textoDeCriterios(11835, 'anual', { ...HOY, porResponsable: false }, miles);
    expect(t.advertencia).not.toContain('empresa');
    expect(t.advertencia).toContain('bloqueados o descontinuados');
  });

  it('los tres caídos: el resumen no afirma NADA y la advertencia lista los tres', () => {
    const t = textoDeCriterios(11835, 'mensual', { porStock: false, porResponsable: false, porEstadoActivo: false }, miles);
    expect(t.resumen).toBe('Entraron 11835 ítems: todo el catálogo de la empresa, sin filtrar.');
    expect(t.advertencia).toContain('sin filtrar por stock');
    expect(t.advertencia).toContain('sin separar lo que asume la empresa');
    expect(t.advertencia).toContain('bloqueados o descontinuados');
  });

  it('con los TRES aplicados no hay advertencia (el día que exista el filtro de estado)', () => {
    // Fija el contrato a futuro: cuando el backend devuelva
    // porEstadoActivo: true, este texto se actualiza SOLO, sin tocar la
    // pantalla ni esta función.
    const t = textoDeCriterios(6297, 'mensual', { porStock: true, porResponsable: true, porEstadoActivo: true }, miles);
    expect(t.resumen).toBe(
      'Entraron 6297 ítems: los que tienen stock en el almacén de la tienda, son responsabilidad del personal y están activos en Dynamics.',
    );
    expect(t.advertencia).toBeNull();
  });

  it('nunca promete un criterio que no se aplicó', () => {
    const t = textoDeCriterios(100, 'mensual', { porStock: false, porResponsable: true, porEstadoActivo: false }, miles);
    expect(t.resumen).not.toContain('stock en el almacén');
    expect(t.resumen).not.toContain('activos');
  });
});
