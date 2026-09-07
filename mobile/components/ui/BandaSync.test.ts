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

import { resumenParaTablero, sincronizacionDeHojas } from './BandaSync';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import type { EstadoSync, HojaConteo } from '../../lib/dominio/tipos';

function cola(parcial: Partial<EstadoCola>): EstadoCola {
  return { pendientes: 0, ultimaSync: null, error: null, rechazo: null, rechazados: 0, sinRed: false, ...parcial };
}

function hojaConSync(sync: EstadoSync): HojaConteo {
  return { sync } as HojaConteo;
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

describe('resumenParaTablero — la banda de un dashboard (Inicio)', () => {
  it('todas las hojas sincronizadas: "ok", sin mencionar la cola global', () => {
    const resultado = resumenParaTablero([hojaConSync('sincronizado'), hojaConSync('sincronizado')]);
    expect(resultado.estado).toBe('ok');
    expect(resultado.mensaje).toBe('Sincronizado');
  });

  it('hojas sin sincronizar: cuenta cuántas, nunca el motivo puntual de una', () => {
    const resultado = resumenParaTablero([hojaConSync('sincronizado'), hojaConSync('error'), hojaConSync('local')]);
    expect(resultado.estado).toBe('pendiente');
    expect(resultado.mensaje).toContain('2');
    expect(resultado.mensaje).toContain('hojas sin sincronizar');
  });

  it('singular cuando es una sola hoja sin sincronizar', () => {
    const resultado = resumenParaTablero([hojaConSync('error')]);
    expect(resultado.mensaje).toContain('1 hoja sin sincronizar');
  });

  it('nunca devuelve el estado "error": una hoja rechazada de OTRA persona no debe verse en un tablero donde nadie puede actuar sobre ella', () => {
    // Es el caso que reportó el cliente: el Coordinador veía en su Inicio
    // "La hoja ya está finalizada: no se puede corregir el conteo." de un
    // conteo ajeno que quedó en la cola global. resumenParaTablero ni
    // siquiera recibe la cola -- solo puede devolver 'ok' o 'pendiente'.
    const resultado = resumenParaTablero([hojaConSync('error')]);
    expect(resultado.estado).not.toBe('error');
  });

  it('lista vacía (todavía no bajó ninguna hoja): "ok", no "pendiente"', () => {
    expect(resumenParaTablero([]).estado).toBe('ok');
  });
});
