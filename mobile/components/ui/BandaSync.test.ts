/**
 * `sincronizacionDeHojas` — la función pura que decide qué le dice la
 * banda de sync a quien está contando. `BandaSync.tsx` (el componente)
 * importa `react-native`/`lucide-react-native` directo, que no parsean
 * bajo vitest (sintaxis Flow) — se mockean con factory ANTES de importar,
 * mismo patrón que sincronizador.test.ts.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
}));
vi.mock('lucide-react-native', () => ({
  RefreshCw: 'RefreshCw',
  Wifi: 'Wifi',
  WifiOff: 'WifiOff',
}));

import { sincronizacionDeHojas } from './BandaSync';
import type { EstadoCola } from '../../lib/puertos/repositorios';

function cola(parcial: Partial<EstadoCola>): EstadoCola {
  return { pendientes: 0, ultimaSync: null, error: null, sinRed: false, ...parcial };
}

describe('sincronizacionDeHojas — sin conexión', () => {
  it('sinRed con conteos pendientes: banda "offline" con el mensaje que tranquiliza', () => {
    const resultado = sincronizacionDeHojas([], cola({ sinRed: true, pendientes: 2 }));
    expect(resultado.estado).toBe('offline');
    expect(resultado.mensaje).toContain('Sin conexión');
    expect(resultado.mensaje).toContain('guardados');
    expect(resultado.mensaje).toContain('2');
  });

  it('sinRed sin nada pendiente todavía: igual avisa que está offline, no dice "Sincronizado"', () => {
    const resultado = sincronizacionDeHojas([], cola({ sinRed: true, pendientes: 0 }));
    expect(resultado.estado).toBe('offline');
    expect(resultado.mensaje).toContain('Sin conexión');
  });

  it('sinRed gana sobre pendientes=0: nunca dice "ok" estando sin señal', () => {
    // Es el caso exacto que reportó el cliente: guardar un conteo no
    // dispara ninguna pasada de sincronización, así que sin este chequeo
    // `cola.pendientes` seguiría en 0 (nadie lo actualizó) y la banda
    // diría "Sincronizado" con la persona parada sin señal.
    const resultado = sincronizacionDeHojas([], cola({ sinRed: true, pendientes: 0 }));
    expect(resultado.estado).not.toBe('ok');
  });

  it('el error de la cola sigue ganando sobre sinRed: un rechazo real no se tapa con "sin conexión"', () => {
    const resultado = sincronizacionDeHojas([], cola({ sinRed: true, pendientes: 1, error: 'La hoja ya la finalizó otro colaborador.' }));
    expect(resultado.estado).toBe('error');
    expect(resultado.mensaje).toBe('La hoja ya la finalizó otro colaborador.');
  });

  it('con red y sin error: se comporta como antes (pendiente / ok)', () => {
    expect(sincronizacionDeHojas([], cola({ pendientes: 0 })).estado).toBe('ok');
    expect(sincronizacionDeHojas([], cola({ pendientes: 3 })).estado).toBe('pendiente');
  });
});
