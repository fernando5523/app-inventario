import { describe, expect, it } from 'vitest';
import { aplicarResultadoEnvio, claveDedup, estadoSyncDeHoja, ordenarCola, type ItemCola } from './sqlite-cola';

function item(parciales: Partial<ItemCola> = {}): ItemCola {
  return {
    id: 1,
    hojaId: 2,
    tipo: 'conteo',
    productoId: 51,
    creadoEn: '2026-09-01T10:00:00.000Z',
    intentos: 0,
    estado: 'pendiente',
    ...parciales,
  };
}

describe('claveDedup', () => {
  it('la misma hoja+tipo+producto da la misma clave', () => {
    expect(claveDedup({ hojaId: 2, tipo: 'conteo', productoId: 51 })).toBe(claveDedup({ hojaId: 2, tipo: 'conteo', productoId: 51 }));
  });

  it('distinto producto da distinta clave', () => {
    expect(claveDedup({ hojaId: 2, tipo: 'conteo', productoId: 51 })).not.toBe(claveDedup({ hojaId: 2, tipo: 'conteo', productoId: 52 }));
  });

  it('un finalizar y un conteo de la misma hoja NO comparten clave, aunque productoId sea 0 en ambos por casualidad', () => {
    expect(claveDedup({ hojaId: 2, tipo: 'finalizar', productoId: 0 })).not.toBe(claveDedup({ hojaId: 2, tipo: 'conteo', productoId: 0 }));
  });
});

describe('ordenarCola', () => {
  it('ordena por fecha de creación, más antiguo primero (FIFO)', () => {
    const a = item({ id: 1, creadoEn: '2026-09-01T10:00:02.000Z' });
    const b = item({ id: 2, creadoEn: '2026-09-01T10:00:00.000Z' });
    const c = item({ id: 3, creadoEn: '2026-09-01T10:00:01.000Z' });
    expect(ordenarCola([a, b, c]).map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it('con la misma fecha, desempata por id', () => {
    const a = item({ id: 5, creadoEn: '2026-09-01T10:00:00.000Z' });
    const b = item({ id: 2, creadoEn: '2026-09-01T10:00:00.000Z' });
    expect(ordenarCola([a, b]).map((i) => i.id)).toEqual([2, 5]);
  });

  it('no muta el array original', () => {
    const original = [item({ id: 2, creadoEn: '2026-09-01T10:00:02.000Z' }), item({ id: 1, creadoEn: '2026-09-01T10:00:01.000Z' })];
    const copia = [...original];
    ordenarCola(original);
    expect(original).toEqual(copia);
  });
});

describe('estadoSyncDeHoja', () => {
  it('sin items pendientes: sincronizado', () => {
    expect(estadoSyncDeHoja([])).toBe('sincronizado');
  });

  it('con items pendientes sin enviar todavía: local', () => {
    expect(estadoSyncDeHoja([item({ estado: 'pendiente' })])).toBe('local');
  });

  it('con un item enviándose: sincronizando', () => {
    expect(estadoSyncDeHoja([item({ estado: 'enviando' })])).toBe('sincronizando');
  });

  it('con un item en error: error, aunque haya otros pendientes o enviándose', () => {
    const items = [item({ id: 1, estado: 'pendiente' }), item({ id: 2, estado: 'enviando' }), item({ id: 3, estado: 'error' })];
    expect(estadoSyncDeHoja(items)).toBe('error');
  });

  it('items que fallaron por sin-red (aplicarResultadoEnvio los deja en pendiente): la hoja da "local", NUNCA "error"', () => {
    // Reproduce el hallazgo de min-4 desde el otro lado: lo que
    // `aplicarResultadoEnvio` produce para un fallo de red (estado
    // 'pendiente') tiene que verse acá como "todavía no salió", no como
    // "esto está roto".
    const dosConteosFallidosPorRed = [
      item({ id: 1, productoId: 60, estado: 'pendiente', intentos: 1 }),
      item({ id: 2, productoId: 61, estado: 'pendiente', intentos: 1 }),
    ];
    expect(estadoSyncDeHoja(dosConteosFallidosPorRed)).toBe('local');
  });
});

describe('aplicarResultadoEnvio', () => {
  it('éxito: el item sale de la cola (null)', () => {
    expect(aplicarResultadoEnvio(item(), { ok: true })).toBeNull();
  });

  it('rechazado por el servidor: queda en error, nunca desaparece en silencio', () => {
    const resultado = aplicarResultadoEnvio(item({ intentos: 0 }), { ok: false, motivo: 'rechazado' });
    expect(resultado).not.toBeNull();
    expect(resultado?.estado).toBe('error');
    expect(resultado?.intentos).toBe(1);
  });

  it('sin red: queda PENDIENTE, nunca error -- un fallo de red no es un rechazo del servidor', () => {
    // Hallazgo de min-4 (2026-09-05): con esto en 'error', estadoDeLaCola
    // contaba el item como rechazo y la banda decía "revisá la conexión o
    // pedí ayuda" a alguien que YA SABE que está sin red y solo necesita
    // saber que su conteo está a salvo. Un fallo de red se reintenta solo
    // en el próximo disparo (sincronizador.ts) -- no hace falta que nadie
    // "pida ayuda" para que vuelva la WiFi.
    const resultado = aplicarResultadoEnvio(item({ intentos: 2 }), { ok: false, motivo: 'sin-red' });
    expect(resultado?.estado).toBe('pendiente');
    expect(resultado?.intentos).toBe(3); // sigue contando intentos, solo no se marca como rechazo.
  });

  it('no muta el item original', () => {
    const original = item({ intentos: 0, estado: 'pendiente' });
    aplicarResultadoEnvio(original, { ok: false, motivo: 'rechazado' });
    expect(original.estado).toBe('pendiente');
    expect(original.intentos).toBe(0);
  });

  it('rechazado con mensaje del servidor: la razón es ESE mensaje, no un genérico', () => {
    const resultado = aplicarResultadoEnvio(item(), {
      ok: false,
      motivo: 'rechazado',
      mensaje: 'La hoja ya está finalizada: no se puede corregir el conteo.',
    });
    expect(resultado?.razon).toBe('La hoja ya está finalizada: no se puede corregir el conteo.');
  });

  it('rechazado SIN mensaje del servidor: cae al fallback fijo, nunca un texto inventado', () => {
    const resultado = aplicarResultadoEnvio(item(), { ok: false, motivo: 'rechazado' });
    expect(resultado?.razon).toBe('Rechazado por el servidor.');
  });

  it('sin-red: razon queda null -- no hay "razón del servidor" que guardar', () => {
    const resultado = aplicarResultadoEnvio(item(), { ok: false, motivo: 'sin-red' });
    expect(resultado?.razon).toBeNull();
  });
});
