import { describe, expect, it } from 'vitest';
import { estadoExportacion, nombreArchivoConsolidado, nombreArchivoDiferencias } from './exportar-diferencias';
import type { EstadoInventario } from '../puertos/repositorios';

describe('estadoExportacion: cuándo se puede exportar, y si no, POR QUÉ', () => {
  it('cerrado y con diferencias: se puede exportar', () => {
    expect(estadoExportacion('conteo_cerrado', 12)).toEqual({ puedeExportar: true });
  });

  it.each<EstadoInventario>(['conteo_cerrado', 'liquidado', 'lacrado'])(
    'estado %s con diferencias: se puede exportar en cualquier punto posterior al cierre',
    (estado) => {
      expect(estadoExportacion(estado, 1)).toEqual({ puedeExportar: true });
    },
  );

  it('EN CURSO: no se puede, y el motivo dice que se destraba al cerrar el ciclo', () => {
    // El hueco que trabó la verificación del 2026-09-08: la sección
    // desaparecía entera y el Auditor no veía ni el botón ni una explicación.
    const r = estadoExportacion('en_curso', 0);
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) throw new Error('inalcanzable');
    expect(r.motivo).toContain('conteo sigue abierto');
    expect(r.motivo).toContain('cuando esté cerrado');
  });

  it('EN CURSO manda sobre el conteo de diferencias: aunque llegaran filas, todavía no cerró', () => {
    // Defensa contra un estado imposible: si alguna vez el backend mandara
    // diferencias de un inventario abierto, el motivo correcto sigue siendo
    // "no cerró", no "cuadró".
    const r = estadoExportacion('en_curso', 5);
    expect(r.puedeExportar).toBe(false);
  });

  it('CERRADO SIN DIFERENCIAS: no se puede, y el motivo dice que cuadró -- no suena a error', () => {
    // El botón habría generado un .xlsx con solo encabezados. Un archivo
    // vacío por WhatsApp es peor que no tener botón: quien lo recibe no sabe
    // si el inventario cuadró o si la exportación falló.
    const r = estadoExportacion('conteo_cerrado', 0);
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) throw new Error('inalcanzable');
    expect(r.motivo).toContain('cuadró contra el ERP');
    expect(r.motivo).toContain('no hay diferencias que exportar');
  });

  it('ANULADO: motivo propio -- nunca cerró, así que decir "cuadró" sería afirmar un resultado que no existe', () => {
    const r = estadoExportacion('anulado', 0);
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) throw new Error('inalcanzable');
    expect(r.motivo).toContain('se anuló');
    expect(r.motivo).not.toContain('cuadró');
  });

  it('los tres motivos son DISTINTOS entre sí: es la regla, no se cae en uno genérico', () => {
    const enCurso = estadoExportacion('en_curso', 0);
    const cuadro = estadoExportacion('conteo_cerrado', 0);
    const anulado = estadoExportacion('anulado', 0);
    const motivos = [enCurso, cuadro, anulado].map((r) => (r.puedeExportar ? '' : r.motivo));
    expect(new Set(motivos).size).toBe(3);
  });
});

describe('nombreArchivoDiferencias: identifica tienda + período + inventario, sin espacios ni acentos', () => {
  it('caso normal', () => {
    expect(nombreArchivoDiferencias('Market Bolívar', 2026, 9, 30)).toBe('diferencias-market-bolivar-2026-09-inv30.xlsx');
  });

  it('mes de un dígito queda con cero adelante', () => {
    expect(nombreArchivoDiferencias('Market Carhuaz', 2026, 3, 12)).toBe('diferencias-market-carhuaz-2026-03-inv12.xlsx');
  });

  it('sin tildes ni eñes en el resultado, aunque el nombre las tenga', () => {
    const nombre = nombreArchivoDiferencias('Cañón Ñuñoa Álamos', 2026, 12, 1);
    expect(nombre).not.toMatch(/[áéíóúñÁÉÍÓÚÑ]/);
  });

  it('sin espacios en el resultado', () => {
    expect(nombreArchivoDiferencias('Market Bolívar', 2026, 9, 30)).not.toContain(' ');
  });

  it('sucursal vacía o solo símbolos no deja un nombre roto', () => {
    expect(nombreArchivoDiferencias('---', 2026, 9, 30)).toBe('diferencias-sucursal-2026-09-inv30.xlsx');
  });
});

describe('nombreArchivoConsolidado: identifica el período, sin atarse a una sola tienda', () => {
  it('caso normal', () => {
    expect(nombreArchivoConsolidado(2026, 9)).toBe('diferencias-consolidado-2026-09.xlsx');
  });

  it('mes de un dígito con cero adelante', () => {
    expect(nombreArchivoConsolidado(2026, 3)).toBe('diferencias-consolidado-2026-03.xlsx');
  });
});
