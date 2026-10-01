/**
 * Dominio puro de la pantalla de importar el Excel de ajustes de Dynamics
 * (contra backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts,
 * e39b370): textos de cada motivo, y la distinción NULL != 0 llevada a la
 * pantalla ("todavía no se importó" bloquea liquidar; "se importó y dio 0"
 * no bloquea nada).
 */
import { describe, expect, it } from 'vitest';
import {
  accionDeLinea,
  errorDeMotivoLinea,
  estadoNegativos,
  MOTIVO_LINEA_MAXIMO,
  resumenPreview,
  TEXTO_LINEAS_BLOQUEADAS,
  textoImportacionConfirmada,
  textoMotivoAdvertencia,
  textoMotivoRechazo,
  textoQueSeConfirma,
  textosAccionLinea,
  tituloPreviewFallido,
  totalLineasNoExcluidas,
  vistaImportar,
  type ImportacionVigente,
  type LineaAjusteNegativoValida,
  type MotivoAdvertenciaLinea,
  type MotivoRechazoLinea,
} from './ajustes-negativos';

describe('textoMotivoRechazo', () => {
  it('cubre los DOS motivos de rechazo del backend, cada uno con su propio texto', () => {
    const motivos: MotivoRechazoLinea[] = ['otra-tienda', 'datos-invalidos'];
    const textos = motivos.map(textoMotivoRechazo);
    expect(new Set(textos).size).toBe(2); // ninguno repetido
    for (const t of textos) expect(t.length).toBeGreaterThan(0);
  });

  it('otra-tienda menciona la tienda/almacén', () => {
    expect(textoMotivoRechazo('otra-tienda')).toMatch(/tienda|almac[ée]n/i);
  });

  it('datos-invalidos menciona que no se pudo leer/interpretar', () => {
    expect(textoMotivoRechazo('datos-invalidos')).toMatch(/no se p(u|o)d/i);
  });
});

describe('textoMotivoAdvertencia', () => {
  it('cubre las TRES advertencias del backend, cada una con su propio texto', () => {
    const motivos: MotivoAdvertenciaLinea[] = ['importe-no-coincide', 'fuera-de-periodo', 'responsable-no-empleado'];
    const textos = motivos.map(textoMotivoAdvertencia);
    expect(new Set(textos).size).toBe(3);
    for (const t of textos) expect(t.length).toBeGreaterThan(0);
  });

  it('importe-no-coincide menciona Cantidad y Precio', () => {
    expect(textoMotivoAdvertencia('importe-no-coincide')).toMatch(/cantidad/i);
  });

  it('fuera-de-periodo menciona el período/fecha', () => {
    expect(textoMotivoAdvertencia('fuera-de-periodo')).toMatch(/per[ií]odo|fecha/i);
  });

  it('responsable-no-empleado menciona "Empleado"', () => {
    expect(textoMotivoAdvertencia('responsable-no-empleado')).toMatch(/empleado/i);
  });
});

describe('estadoNegativos: NULL != 0, la regla completa', () => {
  it('null: "sin-importar", bloquea liquidar, sin monto', () => {
    const e = estadoNegativos(null);
    expect(e.estado).toBe('sin-importar');
    expect(e.bloqueaLiquidar).toBe(true);
    expect(e.monto).toBeNull();
  });

  it('0: "importado", NO bloquea, monto 0 explícito (no confundir con sin-importar)', () => {
    const e = estadoNegativos(0);
    expect(e.estado).toBe('importado');
    expect(e.bloqueaLiquidar).toBe(false);
    expect(e.monto).toBe(0);
  });

  it('380: "importado", NO bloquea, monto 380', () => {
    const e = estadoNegativos(380);
    expect(e.estado).toBe('importado');
    expect(e.bloqueaLiquidar).toBe(false);
    expect(e.monto).toBe(380);
  });

  it('el texto de "sin-importar" es DISTINTO del texto de "importado en 0" -- nunca el mismo mensaje para los dos', () => {
    expect(estadoNegativos(null).texto).not.toBe(estadoNegativos(0).texto);
  });

  it('el texto de "sin-importar" dice explícitamente que bloquea liquidar', () => {
    expect(estadoNegativos(null).texto).toMatch(/no se import|liquidar/i);
  });

  it('el texto de "importado en 0" dice que SÍ se importó (no que falta hacerlo)', () => {
    expect(estadoNegativos(0).texto).not.toMatch(/todav[ií]a no/i);
  });
});

describe('totalLineasNoExcluidas', () => {
  it('suma solo las NO excluidas', () => {
    const lineas = [
      { importe: 30, excluida: false },
      { importe: 15, excluida: true },
      { importe: 5, excluida: false },
    ];
    expect(totalLineasNoExcluidas(lineas)).toBe(35);
  });

  it('lista vacía da 0 explícito', () => {
    expect(totalLineasNoExcluidas([])).toBe(0);
  });

  it('todas excluidas da 0', () => {
    expect(totalLineasNoExcluidas([{ importe: 100, excluida: true }])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Las decisiones de la pantalla, las que antes vivían en el JSX (y en un Alert)
// ---------------------------------------------------------------------------

/** El mismo formato que `components/ui/formato.ts#formatoMoneda`, inyectado como en la pantalla. */
const soles = (n: number): string => `S/ ${n.toFixed(2)}`;

function valida(over: Partial<LineaAjusteNegativoValida> = {}): LineaAjusteNegativoValida {
  return {
    fila: 2,
    codigo: '100234',
    nombre2: 'ACEITE PRIMOR 1L',
    importe: 12.5,
    motivoAjuste: 'Merma',
    responsable: 'Empleado',
    advertencias: [],
    ...over,
  };
}

describe('accionDeLinea', () => {
  it('una línea que cuenta se puede EXCLUIR', () => {
    expect(accionDeLinea(false)).toBe('excluir');
  });

  it('una línea ya excluida se puede volver a INCLUIR', () => {
    expect(accionDeLinea(true)).toBe('incluir');
  });
});

describe('textosAccionLinea', () => {
  it('las dos acciones tienen etiqueta, título y placeholder propios -- nada compartido', () => {
    const ex = textosAccionLinea('excluir');
    const inc = textosAccionLinea('incluir');
    expect(ex.etiqueta).not.toBe(inc.etiqueta);
    expect(ex.titulo).not.toBe(inc.titulo);
    expect(ex.placeholder).not.toBe(inc.placeholder);
  });

  it('el título de excluir dice "excluir" y el de incluir dice "incluir"', () => {
    expect(textosAccionLinea('excluir').titulo).toMatch(/exclu/i);
    expect(textosAccionLinea('incluir').titulo).toMatch(/inclu/i);
  });

  it('ningún placeholder es un "Motivo…" genérico: los dos dicen QUÉ se justifica', () => {
    for (const accion of ['excluir', 'incluir'] as const) {
      expect(textosAccionLinea(accion).placeholder).toMatch(/por qu[eé]/i);
    }
  });
});

describe('errorDeMotivoLinea: el motivo es OBLIGATORIO (pedido de Gilmer)', () => {
  it('vacío da error, y el error DICE que queda registrado -- no es un "campo requerido"', () => {
    const e = errorDeMotivoLinea('excluir', '');
    expect(e).not.toBeNull();
    expect(e).toMatch(/registrad/i);
  });

  it('solo espacios cuenta como vacío: se valida contra el texto sin bordes, igual que el backend', () => {
    expect(errorDeMotivoLinea('excluir', '   \n  ')).not.toBeNull();
  });

  it('excluir e incluir dan mensajes DISTINTOS: no sacan ni devuelven lo mismo', () => {
    expect(errorDeMotivoLinea('excluir', '')).not.toBe(errorDeMotivoLinea('incluir', ''));
  });

  it('UN solo carácter ya sirve: el mínimo es el del servidor (min 1), no el de otra pantalla', () => {
    expect(errorDeMotivoLinea('excluir', 'x')).toBeNull();
  });

  it('un motivo corto pero real ("Duplicada") pasa: acá NO rige el mínimo de 6 del ajuste final', () => {
    expect(errorDeMotivoLinea('excluir', 'Duplicada')).toBeNull();
  });

  it(`pasarse de ${MOTIVO_LINEA_MAXIMO} caracteres da error ANTES de mandarlo, y dice cuántos lleva`, () => {
    const largo = 'a'.repeat(MOTIVO_LINEA_MAXIMO + 1);
    const e = errorDeMotivoLinea('incluir', largo);
    expect(e).not.toBeNull();
    expect(e).toContain(String(MOTIVO_LINEA_MAXIMO + 1));
  });

  it(`exactamente ${MOTIVO_LINEA_MAXIMO} caracteres pasa: el tope es el del backend, no uno más estricto`, () => {
    expect(errorDeMotivoLinea('incluir', 'a'.repeat(MOTIVO_LINEA_MAXIMO))).toBeNull();
  });
});

describe('TEXTO_LINEAS_BLOQUEADAS', () => {
  it('dice el HECHO (ya se liquidó) y no solo "no se puede"', () => {
    expect(TEXTO_LINEAS_BLOQUEADAS).toMatch(/liquid/i);
  });
});

describe('tituloPreviewFallido', () => {
  it('las dos fallas del archivo tienen titular propio: faltan columnas != no es un .xlsx', () => {
    expect(tituloPreviewFallido('columna-faltante')).not.toBe(tituloPreviewFallido('archivo-invalido'));
  });

  it('columna-faltante nombra las columnas', () => {
    expect(tituloPreviewFallido('columna-faltante')).toMatch(/columna/i);
  });
});

describe('resumenPreview', () => {
  it('cuenta válidas, rechazadas y el total tal como los trae el backend', () => {
    const r = resumenPreview({
      ok: true,
      validas: [valida(), valida({ fila: 3, importe: 7.5 })],
      rechazadas: [{ fila: 9, motivo: 'otra-tienda' }],
      totalImporte: 20,
    });
    expect(r.validas).toBe(2);
    expect(r.rechazadas).toBe(1);
    expect(r.totalImporte).toBe(20);
  });

  it('las ADVERTIDAS se cuentan aparte pero SIGUEN siendo válidas: no quedan afuera de la suma', () => {
    const r = resumenPreview({
      ok: true,
      validas: [valida(), valida({ fila: 3, advertencias: ['fuera-de-periodo'] })],
      rechazadas: [],
      totalImporte: 25,
    });
    expect(r.validas).toBe(2); // las dos suman
    expect(r.conAdvertencia).toBe(1); // una es dudosa, y se dice
  });

  it('una línea con DOS advertencias se cuenta una sola vez: son líneas, no avisos', () => {
    const r = resumenPreview({
      ok: true,
      validas: [valida({ advertencias: ['fuera-de-periodo', 'responsable-no-empleado'] })],
      rechazadas: [],
      totalImporte: 12.5,
    });
    expect(r.conAdvertencia).toBe(1);
  });

  it('un archivo válido SIN líneas útiles da ceros explícitos, no un resumen vacío', () => {
    const r = resumenPreview({ ok: true, validas: [], rechazadas: [], totalImporte: 0 });
    expect(r).toEqual({ validas: 0, rechazadas: 0, conAdvertencia: 0, totalImporte: 0 });
  });
});

describe('textoQueSeConfirma', () => {
  it('dice cuántas líneas y con qué monto: es la frase que el Auditor firma', () => {
    const texto = textoQueSeConfirma({ validas: 12, rechazadas: 0, conAdvertencia: 0, totalImporte: 380.5 }, soles);
    expect(texto).toContain('12 líneas');
    expect(texto).toContain('S/ 380.50');
  });

  it('en singular no dice "1 líneas"', () => {
    const texto = textoQueSeConfirma({ validas: 1, rechazadas: 0, conAdvertencia: 0, totalImporte: 12.5 }, soles);
    expect(texto).toContain('1 línea');
    expect(texto).not.toContain('1 líneas');
  });

  it('con rechazadas dice que quedan AFUERA -- nunca las omite en silencio', () => {
    const texto = textoQueSeConfirma({ validas: 5, rechazadas: 3, conAdvertencia: 0, totalImporte: 40 }, soles);
    expect(texto).toMatch(/afuera/i);
    expect(texto).toContain('3 líneas');
  });

  it('sin rechazadas NO menciona ninguna afuera: no se inventa un aviso que no aplica', () => {
    const texto = textoQueSeConfirma({ validas: 5, rechazadas: 0, conAdvertencia: 0, totalImporte: 40 }, soles);
    expect(texto).not.toMatch(/afuera/i);
  });

  it('un archivo válido con 0 líneas se puede confirmar igual, y la frase lo dice con su 0', () => {
    const texto = textoQueSeConfirma({ validas: 0, rechazadas: 0, conAdvertencia: 0, totalImporte: 0 }, soles);
    expect(texto).toContain('0 líneas');
    expect(texto).toContain('S/ 0.00');
  });
});

describe('textoImportacionConfirmada: el aviso que en el teléfono es un Alert', () => {
  it('nombra el archivo, las líneas y el monto -- las tres cosas, no dos', () => {
    const texto = textoImportacionConfirmada(
      { nombreArchivo: 'negativos-setiembre.xlsx', cantidadValidas: 12, montoNegativos: 380.5 },
      soles,
    );
    expect(texto).toContain('negativos-setiembre.xlsx');
    expect(texto).toContain('12 líneas');
    expect(texto).toContain('S/ 380.50');
  });

  it('en singular concuerda: "1 línea guardada", no "1 líneas guardadas"', () => {
    const texto = textoImportacionConfirmada({ nombreArchivo: 'a.xlsx', cantidadValidas: 1, montoNegativos: 10 }, soles);
    expect(texto).toContain('1 línea guardada');
    expect(texto).not.toContain('guardadas');
  });

  it('dice que ESE es ya el monto del inventario: el aviso confirma un hecho, no un envío', () => {
    const texto = textoImportacionConfirmada({ nombreArchivo: 'a.xlsx', cantidadValidas: 3, montoNegativos: 30 }, soles);
    expect(texto).toMatch(/monto de ajustes/i);
  });
});

describe('vistaImportar: importar por primera vez != reemplazar', () => {
  const vigente: ImportacionVigente = {
    id: 7,
    nombreArchivo: 'negativos-agosto.xlsx',
    importadoPor: { id: 3, nombre: 'Gilmer' },
    importadoEn: '2026-09-28T14:02:00.000Z',
  };

  it('sin importación: título y botón de IMPORTAR, y ninguna nota que reemplazar', () => {
    const v = vistaImportar(null);
    expect(v.estado).toBe('sin-importar');
    expect(v.boton).toMatch(/elegir archivo/i);
    expect(v.nota).toBeNull();
  });

  it('con importación vigente: el verbo cambia a REEMPLAZAR -- nadie cree que está agregando líneas', () => {
    const v = vistaImportar(vigente);
    expect(v.estado).toBe('vigente');
    expect(v.titulo).toMatch(/reemplazar/i);
  });

  it('la nota nombra el archivo que está vigente: se sabe qué se va a reemplazar antes de elegir otro', () => {
    expect(vistaImportar(vigente).nota).toContain('negativos-agosto.xlsx');
  });

  it('la nota dice que la anterior NO se borra: reemplazar no pierde el historial', () => {
    expect(vistaImportar(vigente).nota).toMatch(/no se borra/i);
  });

  it('los títulos de los dos estados son distintos: la misma tarjeta con dos lecturas', () => {
    expect(vistaImportar(null).titulo).not.toBe(vistaImportar(vigente).titulo);
  });
});
