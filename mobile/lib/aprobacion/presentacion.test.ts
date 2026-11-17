import { describe, expect, it } from 'vitest';

import {
  FILTRO_HISTORIAL_VACIO,
  almacenesDe,
  contarFiltrosHistorial,
  estadoDeEtiqueta,
  etiquetasEstado,
  etiquetasPeriodo,
  periodoDeEtiqueta,
  textoFiltroHistorial,
  textoMostrandoHistorial,
  fechaDeSolicitud,
  filtrosDeHistorial,
  pendientesDe,
  rangoDePeriodo,
  resumenPendientes,
  textoCantidad,
  textoEspera,
  textoRecordatorio,
} from './presentacion';
import type { LineaSolicitud, SolicitudResumen } from './tipos';

const linea = (p: Partial<LineaSolicitud>): LineaSolicitud => ({
  linea: 1,
  codigo: '101057',
  nombre: 'KOLA REAL',
  unidad: 'U',
  cantidad: 1,
  cantidadInventario: 1,
  unidadInventario: 'U.',
  precio: 6.2,
  importe: 6.2,
  decision: 'pendiente',
  decididoPor: '',
  decididoEn: null,
  comentario: '',
  ...p,
});

describe('textos', () => {
  it('la espera: sin dato es "—", nunca un cero inventado', () => {
    expect(textoEspera(null)).toBe('—');
    expect(textoEspera(0)).toBe('Hace menos de 1 h');
    expect(textoEspera(26)).toBe('Hace 26 h');
    expect(textoEspera(75)).toBe('Hace 3 días');
  });

  it('la cantidad muestra lo pedido y lo que sale del inventario, con la unidad tal cual', () => {
    expect(textoCantidad({ cantidad: 1, unidad: 'Emp.4', cantidadInventario: 4, unidadInventario: 'U.' })).toBe('1 Emp.4 · 4 U.');
    expect(textoCantidad({ cantidad: 2, unidad: 'U.', cantidadInventario: 2, unidadInventario: 'U.' })).toBe('2 U.');
    expect(textoCantidad({ cantidad: 1.5, unidad: 'KG', cantidadInventario: 1.5, unidadInventario: '' })).toBe('1.5 KG');
  });

  it('recordatorio y resumen', () => {
    expect(textoRecordatorio(0)).toBeNull();
    expect(textoRecordatorio(1)).toMatch(/^1 solicitud espera/);
    expect(resumenPendientes(0, 0)).toBe('Sin solicitudes por aprobar');
    expect(resumenPendientes(3, 1)).toBe('3 solicitudes por aprobar · 1 con más de 24 h');
  });

  it('la fecha de la solicitud no se corre de día por la zona horaria', () => {
    expect(fechaDeSolicitud('2026-10-01')).toBe('01/10/2026');
    expect(fechaDeSolicitud(null)).toBe('—');
  });

  it('lo que queda por decidir', () => {
    expect(pendientesDe([linea({ importe: 6.2 }), linea({ linea: 2, importe: 22.2 }), linea({ linea: 3, decision: 'aprobada', importe: 9 })])).toEqual({
      cantidad: 2,
      importe: 28.4,
    });
  });
});

describe('periodos del historial (días de Lima)', () => {
  // 10/10/2026 01:00 UTC = 09/10/2026 20:00 en Lima: el "hoy" es el 9.
  const ahora = new Date('2026-10-10T01:00:00Z');
  it('usa el día de Lima, no el UTC', () => {
    expect(rangoDePeriodo('7-dias', ahora)).toEqual({ desde: '2026-10-03', hasta: '2026-10-09' });
  });
  it('este mes y mes anterior', () => {
    expect(rangoDePeriodo('este-mes', ahora)).toEqual({ desde: '2026-10-01', hasta: '2026-10-09' });
    expect(rangoDePeriodo('mes-anterior', ahora)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
  });
  it('enero: el mes anterior es diciembre del año previo', () => {
    expect(rangoDePeriodo('mes-anterior', new Date('2026-01-15T15:00:00Z'))).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
  });
  it('los filtros vacíos no viajan', () => {
    expect(filtrosDeHistorial('todo', 'todas', '  ', ahora)).toEqual({});
    expect(filtrosDeHistorial('todo', 'rechazada', ' carhuaz ', ahora)).toEqual({ estado: 'rechazada', texto: 'carhuaz' });
  });
});

describe('almacenesDe', () => {
  it('únicos y ordenados por nombre', () => {
    const s = (almacenId: string, almacenNombre: string) => ({ almacenId, almacenNombre }) as SolicitudResumen;
    expect(almacenesDe([s('MD08_RAY', 'Market Raymondi'), s('AD02_CRH', 'Mayorista Carhuaz'), s('MD08_RAY', 'Market Raymondi')])).toEqual([
      { id: 'MD08_RAY', nombre: 'Market Raymondi' },
      { id: 'AD02_CRH', nombre: 'Mayorista Carhuaz' },
    ]);
  });
});

describe('filtro del historial (modal)', () => {
  it('cuenta solo lo que la persona cambió; "este mes" es el punto de partida', () => {
    expect(contarFiltrosHistorial(FILTRO_HISTORIAL_VACIO)).toBe(0);
    expect(contarFiltrosHistorial({ periodo: 'todo', estado: 'rechazada', almacen: 'AD02_CRH', texto: ' limpieza ' })).toBe(4);
    expect(contarFiltrosHistorial({ ...FILTRO_HISTORIAL_VACIO, texto: '   ' })).toBe(0);
  });

  it('el texto del pie siempre dice el periodo', () => {
    expect(textoFiltroHistorial(FILTRO_HISTORIAL_VACIO)).toBe('Este mes');
    expect(textoFiltroHistorial({ periodo: '7-dias', estado: 'error-registro', almacen: 'MD08_RAY', texto: 'kola' })).toBe(
      'Últimos 7 días · Con error · MD08_RAY · "kola"',
    );
  });

  it('mostrando N de M', () => {
    expect(textoMostrandoHistorial(3, 3)).toBe('Mostrando 3 solicitudes');
    expect(textoMostrandoHistorial(1, 3)).toBe('Mostrando 1 de 3 solicitudes');
    expect(textoMostrandoHistorial(1, 1)).toBe('Mostrando 1 solicitud');
  });

  it('las etiquetas de los selects van y vuelven; "Todas" no se ofrece como opción', () => {
    expect(etiquetasEstado()).toEqual(['Registradas', 'Rechazadas', 'Con error']);
    expect(estadoDeEtiqueta('Rechazadas')).toBe('rechazada');
    expect(estadoDeEtiqueta(null)).toBe('todas');
    expect(periodoDeEtiqueta('Mes anterior')).toBe('mes-anterior');
    expect(periodoDeEtiqueta(null)).toBe('este-mes');
    expect(etiquetasPeriodo()).toContain('Todo');
  });
});
