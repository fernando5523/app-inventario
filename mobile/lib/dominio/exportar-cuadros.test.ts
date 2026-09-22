import { describe, expect, it } from 'vitest';

import {
  estadoExportacionCuadros,
  nombreCuadrosDeRespaldo,
  nombreDeContentDisposition,
  notaExportacionCuadros,
} from './exportar-cuadros';

describe('cuándo se puede bajar la planilla de cuadros', () => {
  /**
   * LA DIFERENCIA DELIBERADA con el export de diferencias: el panel MUESTRA los
   * cuadros con el conteo abierto, así que bloquear el archivo que trae esos
   * mismos números diría "podés mirarlo pero no bajarlo".
   */
  it('con el conteo abierto SE PUEDE, y la salvedad la dice la nota', () => {
    expect(estadoExportacionCuadros('en_curso', 7)).toEqual({ puedeExportar: true });
    expect(notaExportacionCuadros('en_curso')).toContain('sigue abierto');
  });

  it('con el conteo cerrado se puede y no hay nada que aclarar', () => {
    expect(estadoExportacionCuadros('conteo_cerrado', 7)).toEqual({ puedeExportar: true });
    expect(notaExportacionCuadros('conteo_cerrado')).toBeNull();
  });

  /**
   * CERO DIFERENCIAS NO BLOQUEA, al revés que el export de diferencias: ahí
   * saldría un .xlsx con solo encabezados, acá salen las cuatro hojas diciendo
   * "Sin ítems en este cuadro" -- una afirmación verdadera y útil.
   */
  it('un inventario que cuadró igual se puede bajar: el archivo lo dice', () => {
    expect(estadoExportacionCuadros('lacrado', 10)).toEqual({ puedeExportar: true });
  });

  /**
   * EL VACÍO LEÍDO COMO ÉXITO, que es el error más caro de esta app: sin un solo
   * ítem comparable las cuatro hojas saldrían vacías y el archivo afirmaría "no
   * falta nada" sin que nadie haya contado.
   */
  it('sin ningún ítem comparable NO se puede, y el motivo lo dice', () => {
    const r = estadoExportacionCuadros('en_curso', 0);
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) return;
    expect(r.motivo).toContain('no falta nada');
  });

  it('durante el ajuste final no se puede: los cuadros todavía se mueven', () => {
    const r = estadoExportacionCuadros('ajuste_auditor', 7);
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) return;
    expect(r.motivo).toContain('ajuste');
  });

  it('un inventario anulado nunca tuvo cuadros', () => {
    const r = estadoExportacionCuadros('anulado', 7);
    expect(r.puedeExportar).toBe(false);
    if (r.puedeExportar) return;
    expect(r.motivo).toContain('anuló');
  });

  /**
   * Cada motivo se destraba distinto, así que ninguno puede compartir texto con
   * otro: un solo mensaje para dos situaciones obliga a adivinar en cuál estás.
   */
  it('los tres motivos son textos distintos', () => {
    const motivos = (['ajuste_auditor', 'anulado'] as const).map((e) => {
      const r = estadoExportacionCuadros(e, 7);
      return r.puedeExportar ? '' : r.motivo;
    });
    const sinDatos = estadoExportacionCuadros('en_curso', 0);
    motivos.push(sinDatos.puedeExportar ? '' : sinDatos.motivo);
    expect(new Set(motivos).size).toBe(3);
  });

  /** El motivo se le muestra al Auditor: nada de endpoint, backend ni API. */
  it('ningún motivo habla de detalles técnicos', () => {
    for (const estado of ['ajuste_auditor', 'anulado'] as const) {
      const r = estadoExportacionCuadros(estado, 0);
      const texto = (r.puedeExportar ? '' : r.motivo).toLowerCase();
      for (const tecnico of ['endpoint', 'backend', 'api', 'servidor', 'http']) {
        expect(texto).not.toContain(tecnico);
      }
    }
  });
});

describe('el nombre que mandó el servidor', () => {
  /** El caso real: lo que manda historial.controller.ts#exportarCuadros. */
  it('lee el filename entre comillas del header real', () => {
    expect(
      nombreDeContentDisposition('attachment; filename="inventario-cuadros-market-bolivar-2026-07-inv45.xlsx"'),
    ).toBe('inventario-cuadros-market-bolivar-2026-07-inv45.xlsx');
  });

  it('lee el filename sin comillas', () => {
    expect(nombreDeContentDisposition('attachment; filename=cuadros.xlsx')).toBe('cuadros.xlsx');
  });

  /** `filename*` es el que conserva acentos, así que gana sobre el simple. */
  it('prefiere filename* sobre filename, y lo decodifica', () => {
    expect(
      nombreDeContentDisposition("attachment; filename=\"cuadros.xlsx\"; filename*=UTF-8''cuadros-bol%C3%ADvar.xlsx"),
    ).toBe('cuadros-bolívar.xlsx');
  });

  /** Un porcentaje roto no justifica tumbar una descarga que ya llegó. */
  it('con filename* mal codificado cae al filename simple', () => {
    expect(nombreDeContentDisposition("attachment; filename=\"bueno.xlsx\"; filename*=UTF-8''mal%ZZ.xlsx")).toBe(
      'bueno.xlsx',
    );
  });

  /**
   * El nombre se usa para CREAR un archivo en la caché: un separador de rutas
   * ahí escribiría fuera de la carpeta.
   */
  it('se queda con el último tramo de un nombre con rutas', () => {
    expect(nombreDeContentDisposition('attachment; filename="../../etc/cuadros.xlsx"')).toBe('cuadros.xlsx');
  });

  it('sin header, o sin nombre usable, devuelve null en vez de inventar uno', () => {
    expect(nombreDeContentDisposition(null)).toBeNull();
    expect(nombreDeContentDisposition(undefined)).toBeNull();
    expect(nombreDeContentDisposition('attachment')).toBeNull();
    expect(nombreDeContentDisposition('attachment; filename=""')).toBeNull();
    expect(nombreDeContentDisposition('attachment; filename=".."')).toBeNull();
  });

  /**
   * El de respaldo dice qué es y de qué inventario -- lo único que el teléfono
   * sabe con certeza. NO imita el patrón del cliente (sucursal y período): un
   * nombre a medias que parece del servidor es peor que uno visiblemente mínimo.
   */
  it('el nombre de respaldo identifica el inventario y no finge el patrón', () => {
    const respaldo = nombreCuadrosDeRespaldo(8060);
    expect(respaldo).toBe('inventario-cuadros-inv8060.xlsx');
    expect(respaldo).not.toContain('market');
  });
});
